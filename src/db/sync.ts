import { db } from './index';
import { firestore, sanitizeForFirestore } from './firebase';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  runTransaction,
  increment,
} from 'firebase/firestore';
import {
  Item,
  Shop,
  User,
  Sale,
  SaleLineItem,
  SalePayment,
  StockMovement,
  SyncQueueItem,
  Customer,
  AuditLog,
} from '../types';
import {
  applyStockChangeTx,
  assertWholeNumber,
  newId,
  pendingDeltaByItem,
  StockError,
} from './stock';

export interface RecordSaleParams {
  shopId: string;
  sellerId: string;
  sellerName: string;
  deviceCode: string;
  invoicePrefix: string;
  allowNegativeStock?: boolean;
  customerName?: string;
  customerPhone?: string;
  lines: SaleLineItem[];
  subtotal: number;
  discountTotal?: number;
  tax?: number;
  total: number;
  payments?: SalePayment[];
  notes?: string;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MAX_ATTEMPTS = 8;
const backoffMs = (attempts: number) => Math.min(5 * 60_000, 2_000 * 2 ** attempts);

// Generate offline-safe collision-free invoice number: <prefix>-<deviceCode>-<seq>
export async function generateNextInvoiceNumber(prefix: string, deviceCode: string): Promise<string> {
  const deviceKey = `shopledger_seq_${deviceCode}`;
  let seq = typeof localStorage !== 'undefined' ? parseInt(localStorage.getItem(deviceKey) || '0', 10) : 0;
  if (isNaN(seq) || seq < 1) {
    const existingSales = await db.sales
      .filter((s) => s.deviceCode === deviceCode)
      .toArray();
    seq = existingSales.length;
  }
  seq += 1;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(deviceKey, seq.toString());
  }

  const paddedSeq = seq.toString().padStart(4, '0');
  return `${prefix}-${deviceCode}-${paddedSeq}`;
}

async function pushStockMovement(m: StockMovement): Promise<void> {
  const movRef = doc(firestore, 'stockMovements', m.id);
  const itemRef = doc(firestore, 'items', m.itemId);
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(movRef);
    if (snap.exists()) return; // already applied -> idempotent retry
    tx.set(movRef, sanitizeForFirestore({ ...m, syncedAt: Date.now() }));

    const itemSnap = await tx.get(itemRef);
    if (itemSnap.exists()) {
      const data = itemSnap.data() || {};
      const currentCloudQty = Number(data.quantity) || 0;
      const targetQty = Math.max(0, currentCloudQty + m.qtyChange);
      const existingRecent: string[] = Array.isArray(data.recentMovementIds) ? data.recentMovementIds : [];
      const updatedRecent = [m.id, ...existingRecent.filter((id) => id !== m.id)].slice(0, 30);
      tx.set(
        itemRef,
        {
          quantity: targetQty,
          updatedAt: Date.now(),
          lastMovementId: m.id,
          recentMovementIds: updatedRecent,
        },
        { merge: true }
      );
    } else {
      // Document didn't exist in Firestore yet: fetch item from local DB
      const localItem = await db.items.get(m.itemId);
      if (localItem) {
        tx.set(
          itemRef,
          sanitizeForFirestore({
            ...localItem,
            quantity: Math.max(0, m.newQty),
            lastMovementId: m.id,
            recentMovementIds: [m.id],
            updatedAt: Date.now(),
          })
        );
      }
    }
  });
}

/** Pushes item and retains/updates full metadata; preserves cloud stock quantity unless explicitly seeding. */
export async function pushItem(item: Item, seedQuantity = false): Promise<void> {
  const ref = doc(firestore, 'items', item.id);
  const clean = sanitizeForFirestore(item) as Item;
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      if (seedQuantity) {
        tx.set(ref, clean, { merge: true });
      } else {
        const existingData = snap.data();
        const { quantity, ...metadataWithoutQty } = clean;
        tx.set(
          ref,
          {
            ...metadataWithoutQty,
            quantity: Number(existingData?.quantity) ?? clean.quantity,
          },
          { merge: true }
        );
      }
    } else {
      tx.set(ref, clean);
    }
  });
}

async function dispatchQueueItem(q: SyncQueueItem): Promise<void> {
  const p = q.payload;
  switch (q.entity) {
    case 'stockMovement':
      return pushStockMovement(p as StockMovement);
    case 'item':
      if (q.action === 'delete') {
        return deleteDoc(doc(firestore, 'items', p.id));
      }
      return pushItem(p as Item);
    case 'sale':
      await setDoc(doc(firestore, 'sales', p.id), sanitizeForFirestore(p), { merge: true });
      await db.sales.update(p.id, { syncedAt: Date.now() });
      return;
    case 'withdrawal':
      return setDoc(doc(firestore, 'withdrawals', p.id), sanitizeForFirestore(p), { merge: true });
    case 'import':
      return setDoc(doc(firestore, 'imports', p.id), sanitizeForFirestore(p), { merge: true });
    case 'customer':
      return setDoc(doc(firestore, 'customers', p.id), sanitizeForFirestore(p), { merge: true });
    case 'customerPayment':
      return setDoc(doc(firestore, 'customerPayments', p.id), sanitizeForFirestore(p), { merge: true });
    case 'auditLog':
      return setDoc(doc(firestore, 'auditLogs', p.id), sanitizeForFirestore(p), { merge: true });
    default:
      throw new Error(`No sync handler for entity "${(q as any).entity}"`);
  }
}

let running = false;

export async function processSyncQueue(): Promise<{ synced: number; remaining: number }> {
  const countOpen = () =>
    db.syncQueue.where('status').anyOf('pending', 'failed', 'syncing').count();

  if (running || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return { synced: 0, remaining: await countOpen() };
  }
  running = true;
  let synced = 0;
  try {
    // Recover rows left in 'syncing' by a closed tab / crash.
    await db.syncQueue.where('status').equals('syncing').modify({ status: 'pending' });

    const now = Date.now();
    const due = (await db.syncQueue.where('status').anyOf('pending', 'failed').sortBy('createdAt'))
      .filter((q) => q.attempts < MAX_ATTEMPTS && (q.nextRetryAt ?? 0) <= now)
      .slice(0, 50);

    for (const q of due) {
      try {
        await db.syncQueue.update(q.id, { status: 'syncing' });
        await dispatchQueueItem(q);
        await db.syncQueue.update(q.id, { status: 'synced' });
        synced++;
      } catch (err: any) {
        const attempts = q.attempts + 1;
        await db.syncQueue.update(q.id, {
          status: 'failed',
          attempts,
          lastError: err instanceof Error ? err.message : 'Sync error',
          nextRetryAt: Date.now() + backoffMs(attempts),
        });
      }
    }

    // Our own writes change cloud quantities; re-merge so local = cloud + still-pending deltas.
    if (synced > 0) {
      const shop = await db.shops.toCollection().first();
      if (shop) await pullInventoryFromFirestore(shop.id);
    }
  } finally {
    running = false;
  }
  return { synced, remaining: await countOpen() };
}

/** Call after every local mutation, on app start, on the 'online' event and on a 30s interval. */
export function scheduleSync(): void {
  const run = () => void processSyncQueue().catch(() => {});
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    void navigator.locks.request('shopledger-sync', { ifAvailable: true }, async (lock) => {
      if (lock) await processSyncQueue().catch(() => {});
    });
  } else {
    run();
  }
}

// Atomically record a sale
export async function recordSale(params: RecordSaleParams): Promise<Sale> {
  const { shopId, sellerId, sellerName, deviceCode, invoicePrefix, customerName, customerPhone, notes } = params;
  if (!params.lines || !params.lines.length) throw new StockError('Sale has no items.');

  // 1. Never trust client math or quantities.
  const lines: SaleLineItem[] = params.lines.map((l) => {
    assertWholeNumber(l.qty, `Quantity for "${l.name}"`);
    if (l.qty < 1) throw new StockError(`Quantity for "${l.name}" must be at least 1.`);
    const unitPrice = Number(l.unitPrice);
    const discount = Number(l.discount) || 0;
    if (!(unitPrice >= 0) || discount < 0) throw new StockError('Invalid price or discount.');
    const lineTotal = round2(l.qty * unitPrice - discount);
    if (lineTotal < 0) throw new StockError('Discount cannot exceed the line amount.');
    return { ...l, unitPrice, discount, lineTotal };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const discountTotal = round2(lines.reduce((s, l) => s + l.discount, 0));
  const tax = round2(params.tax ?? 0);
  const total = round2(subtotal - discountTotal + tax);
  const payments = params.payments ?? [{ method: 'Cash' as const, amount: total }];
  if (Math.abs(round2(payments.reduce((s, p) => s + p.amount, 0)) - total) > 0.005) {
    throw new StockError('Payments do not add up to the sale total.');
  }

  const saleId = newId('sale');
  const now = Date.now();
  const invoiceNo = await generateNextInvoiceNumber(invoicePrefix || 'INV', deviceCode || 'D01');

  const sale: Sale = {
    id: saleId,
    invoiceNo,
    shopId,
    sellerId,
    sellerName,
    customerName: customerName?.trim() || undefined,
    customerPhone: customerPhone?.trim() || undefined,
    lines,
    subtotal,
    discountTotal,
    tax,
    total,
    payments,
    status: 'completed',
    createdAtClient: now,
    exactTimeSold: new Date(now).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }),
    syncedAt: null,
    deviceCode,
    notes,
  };

  await db.transaction('rw',
    [db.shops, db.items, db.sales, db.stockMovements, db.customers, db.auditLogs, db.syncQueue],
    async () => {
      // Settings come from the DB, not from the caller.
      const shop = await db.shops.get(shopId);
      const allowNegative = shop?.settings?.allowNegativeStock === true;
      const allowOverride = shop?.settings?.allowPriceOverride !== false;

      let lastRemaining: number | undefined;
      for (const l of lines) {
        const item = await db.items.get(l.itemId);
        if (!item) throw new StockError(`Item "${l.name}" (SKU: ${l.sku}) not found.`);
        if (!allowOverride && l.unitPrice !== item.sellingPrice) {
          throw new StockError(`Price override is not allowed for "${item.name}".`);
        }
        const mv = await applyStockChangeTx({
          shopId,
          itemId: l.itemId,
          delta: -l.qty,
          type: 'sale',
          reason: `Sale ${invoiceNo}`,
          refId: saleId,
          userId: sellerId,
          userName: sellerName,
          allowNegative,
          now,
        });
        lastRemaining = mv.newQty;
      }
      if (lines.length === 1) sale.remainingStockAfterSale = lastRemaining;

      // Handle Credit balance if applicable
      const creditPayment = payments?.find((p) => p.method === 'Credit');
      if (creditPayment && creditPayment.amount > 0) {
        const cName = customerName?.trim() || 'Unknown Customer';
        const cPhone = customerPhone?.trim() || '';

        let customer = await db.customers
          .filter((c) => (cPhone && c.phone === cPhone) || c.name.toLowerCase() === cName.toLowerCase())
          .first();

        if (customer) {
          await db.customers.update(customer.id, {
            balanceOwed: (customer.balanceOwed || 0) + creditPayment.amount,
            updatedAt: now,
          });
          sale.customerId = customer.id;
        } else {
          const newCustomerId = newId('cust');
          const newCust: Customer = {
            id: newCustomerId,
            shopId,
            name: cName,
            phone: cPhone,
            balanceOwed: creditPayment.amount,
            createdAt: now,
            updatedAt: now,
          };
          await db.customers.add(newCust);
          sale.customerId = newCustomerId;
        }
      }

      await db.sales.add(sale);
      await db.auditLogs.add({
        id: newId('audit'),
        shopId,
        action: 'sale_created',
        entity: 'sales',
        entityId: saleId,
        userId: sellerId,
        userName: sellerName,
        meta: { invoiceNo, total, itemsCount: lines.length, isOffline: !navigator.onLine },
        createdAt: now,
      });
      await db.syncQueue.add({
        id: newId('sync'),
        entity: 'sale',
        action: 'create',
        payload: sale,
        attempts: 0,
        status: 'pending',
        createdAt: now,
      });
    });

  scheduleSync();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shopledger_sales_updated'));
    window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
  }
  return sale;
}

// Void a sale with stock restoration and audit log
export async function voidSale(
  saleId: string,
  voidReason: string,
  userId: string,
  userName: string
): Promise<void> {
  const now = Date.now();

  await db.transaction('rw', [
    db.sales,
    db.items,
    db.stockMovements,
    db.customers,
    db.auditLogs,
    db.syncQueue,
  ], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) throw new StockError('Sale not found.');
    if (sale.status === 'voided') throw new StockError('Sale is already voided.');

    for (const line of sale.lines) {
      if (!(await db.items.get(line.itemId))) continue; // item was deleted: nothing to restore
      await applyStockChangeTx({
        shopId: sale.shopId,
        itemId: line.itemId,
        delta: line.qty,
        type: 'return',
        reason: `Void sale ${sale.invoiceNo}: ${voidReason}`,
        refId: sale.id,
        userId,
        userName,
        now,
      });
    }

    // Reverse customer credit balance if sale had credit
    const creditPayment = sale.payments?.find((p) => p.method === 'Credit');
    if (creditPayment && creditPayment.amount > 0 && sale.customerId) {
      const customer = await db.customers.get(sale.customerId);
      if (customer) {
        const newBalance = Math.max(0, (customer.balanceOwed || 0) - creditPayment.amount);
        await db.customers.update(customer.id, {
          balanceOwed: newBalance,
          updatedAt: now,
        });
      }
    }

    await db.sales.update(saleId, {
      status: 'voided',
      voidReason,
      voidedAt: now,
      voidedBy: userName,
    });

    await db.auditLogs.add({
      id: newId('audit'),
      shopId: sale.shopId,
      action: 'sale_voided',
      entity: 'sales',
      entityId: saleId,
      userId,
      userName,
      meta: { invoiceNo: sale.invoiceNo, amount: sale.total, reason: voidReason },
      createdAt: now,
    });

    await db.syncQueue.add({
      id: newId('sync'),
      entity: 'sale',
      action: 'update',
      payload: { id: saleId, status: 'voided', voidReason, voidedAt: now, voidedBy: userName, updatedAt: now },
      attempts: 0,
      status: 'pending',
      createdAt: now,
    });
  });

  scheduleSync();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shopledger_sales_updated'));
    window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
  }
}

// Adjust stock with reason
export async function adjustStock(params: {
  shopId: string;
  itemId: string;
  qtyChange: number;
  reasonType: 'restock' | 'damage' | 'theft' | 'correction' | 'adjustment';
  notes: string;
  userId: string;
  userName: string;
}): Promise<number> {
  const { shopId, itemId, qtyChange, reasonType, notes, userId, userName } = params;
  let finalQty = 0;

  await db.transaction('rw', [db.items, db.stockMovements, db.auditLogs, db.syncQueue], async () => {
    const mv = await applyStockChangeTx({
      shopId,
      itemId,
      delta: qtyChange,
      type: reasonType === 'restock' ? 'restock' : 'adjustment',
      reason: `${reasonType.toUpperCase()}: ${notes}`,
      userId,
      userName,
    });
    finalQty = mv.newQty;
    await db.auditLogs.add({
      id: newId('audit'),
      shopId,
      action: 'stock_adjusted',
      entity: 'items',
      entityId: itemId,
      userId,
      userName,
      meta: { qtyChange, previousQty: mv.previousQty, newQty: mv.newQty, reason: `${reasonType}: ${notes}` },
      createdAt: mv.createdAt,
    });
  });

  scheduleSync();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
  }
  return finalQty;
}

// Bulk sync all shop items and import records to Firestore
export async function syncAllInventoryToFirestore(
  shopId: string,
  _replaceCatalog = false
): Promise<{ count: number; error?: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { count: 0, error: 'Device is offline' };
  }

  try {
    const allItems = await db.items.where('shopId').equals(shopId).toArray();
    for (const it of allItems) {
      await pushItem(it, _replaceCatalog);
    }

    try {
      const shopRef = doc(firestore, 'shops', shopId || 'shop-electrical-01');
      await setDoc(shopRef, { lastInventoryUpdated: Date.now() }, { merge: true });
    } catch {}

    const allImports = await db.imports.where('shopId').equals(shopId).toArray();
    for (const imp of allImports) {
      await setDoc(doc(firestore, 'imports', imp.id), sanitizeForFirestore(imp), { merge: true });
    }

    const allWithdrawals = await db.withdrawals.where('shopId').equals(shopId).toArray();
    for (const w of allWithdrawals) {
      await setDoc(doc(firestore, 'withdrawals', w.id), sanitizeForFirestore(w), { merge: true });
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
    }

    return { count: allItems.length };
  } catch (err: any) {
    console.warn('Firestore sync notice (offline mode active):', err?.message || err);
    return { count: 0, error: err?.message || 'Sync error' };
  }
}

// Pull latest inventory from Cloud Firestore into local Dexie
export async function pullInventoryFromFirestore(shopId: string): Promise<{ pulled: number; removed: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { pulled: 0, removed: 0 };
  }

  try {
    const targetShopId = shopId || 'shop-electrical-01';
    const itemsCol = collection(firestore, 'items');
    const snap = await getDocs(query(itemsCol, where('shopId', '==', targetShopId)));

    if (snap.empty) {
      // Cloud has no items yet: populate Firestore from local catalog so cloud has correct stock
      const localCount = await db.items.where('shopId').equals(targetShopId).count();
      if (localCount > 0) {
        await syncAllInventoryToFirestore(targetShopId, false);
      }
      return { pulled: 0, removed: 0 };
    }

    const openQueue = await db.syncQueue
      .where('entity')
      .equals('stockMovement')
      .filter((q) => q.status !== 'synced')
      .toArray();

    const cloudItems: Item[] = [];

    for (const d of snap.docs) {
      const data = d.data() as Item & { isDeleted?: boolean };
      if (data?.isDeleted) {
        await db.items.delete(d.id);
        continue;
      }
      if (data && data.name) {
        const cloudQuantity = Number(data.quantity) || 0;

        // Skip pending local movements already accounted for by the cloud
        const recentApplied = new Set<string>();
        if (data.lastMovementId) recentApplied.add(data.lastMovementId);
        if (Array.isArray(data.recentMovementIds)) {
          for (const movId of data.recentMovementIds) {
            if (movId) recentApplied.add(movId);
          }
        }

        let pendingDelta = 0;
        for (const q of openQueue) {
          const m = q.payload as StockMovement;
          if (m && m.itemId === d.id && !recentApplied.has(m.id)) {
            pendingDelta += m.qtyChange;
          }
        }

        const finalQuantity = Math.max(0, cloudQuantity + pendingDelta);

        cloudItems.push({
          ...data,
          id: d.id,
          shopId: data.shopId || targetShopId,
          costPrice: Number(data.costPrice) || 0,
          sellingPrice: Number(data.sellingPrice) || 0,
          quantity: finalQuantity,
          archived: Boolean(data.archived),
          updatedAt: Number(data.updatedAt) || Date.now(),
        });
      }
    }

    if (cloudItems.length > 0) {
      await db.items.bulkPut(cloudItems);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
    }

    return { pulled: cloudItems.length, removed: 0 };
  } catch (err) {
    console.warn('Pull inventory notice (offline fallback active):', err);
    return { pulled: 0, removed: 0 };
  }
}

// Real-time listener for Firestore items
export function subscribeToCloudInventory(shopId: string, onChange?: () => void): () => void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return () => {};
  }

  try {
    const targetShopId = shopId || 'shop-electrical-01';
    const q = query(collection(firestore, 'items'), where('shopId', '==', targetShopId));
    const unsub = onSnapshot(
      q,
      async (snap) => {
        try {
          if (snap.empty) return;

          const openQueue = await db.syncQueue
            .where('entity')
            .equals('stockMovement')
            .filter((q) => q.status !== 'synced')
            .toArray();

          const cloudItems: Item[] = [];

          for (const d of snap.docs) {
            const data = d.data() as Item & { isDeleted?: boolean };
            if (data?.isDeleted) {
              await db.items.delete(d.id);
              continue;
            }
            if (data && data.name) {
              const cloudQuantity = Number(data.quantity) || 0;

              const recentApplied = new Set<string>();
              if (data.lastMovementId) recentApplied.add(data.lastMovementId);
              if (Array.isArray(data.recentMovementIds)) {
                for (const movId of data.recentMovementIds) {
                  if (movId) recentApplied.add(movId);
                }
              }

              let pendingDelta = 0;
              for (const q of openQueue) {
                const m = q.payload as StockMovement;
                if (m && m.itemId === d.id && !recentApplied.has(m.id)) {
                  pendingDelta += m.qtyChange;
                }
              }

              const finalQuantity = Math.max(0, cloudQuantity + pendingDelta);

              cloudItems.push({
                ...data,
                id: d.id,
                shopId: data.shopId || targetShopId,
                costPrice: Number(data.costPrice) || 0,
                sellingPrice: Number(data.sellingPrice) || 0,
                quantity: finalQuantity,
                archived: Boolean(data.archived),
                updatedAt: Number(data.updatedAt) || Date.now(),
              });
            }
          }

          if (cloudItems.length > 0) {
            await db.items.bulkPut(cloudItems);
          }

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
          }
          onChange?.();
        } catch (inner) {
          console.warn('Real-time inventory sync processing error:', inner);
        }
      },
      (error) => {
        console.warn('Real-time inventory listener notice:', error);
      }
    );
    return unsub;
  } catch {
    return () => {};
  }
}

// Real-time listener for Firestore sales
export function subscribeToCloudSales(shopId?: string, onChange?: (sales: Sale[]) => void): () => void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return () => {};
  }

  try {
    const salesCol = collection(firestore, 'sales');
    const unsub = onSnapshot(
      salesCol,
      async (snap) => {
        try {
          const cloudSales: Sale[] = [];
          for (const d of snap.docs) {
            const data = d.data() as Sale;
            if (data && data.lines) {
              const saleId = d.id;
              const cloudSale: Sale = {
                ...data,
                id: saleId,
                shopId: data.shopId || shopId || 'shop-electrical-01',
                subtotal: Number(data.subtotal) || Number(data.total) || 0,
                total: Number(data.total) || 0,
                status: data.status || 'completed',
                voidReason: data.voidReason,
                voidedAt: data.voidedAt,
                voidedBy: data.voidedBy,
                createdAtClient: Number(data.createdAtClient) || Date.now(),
              };
              cloudSales.push(cloudSale);
              await db.sales.put(cloudSale);
            }
          }

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('shopledger_sales_updated'));
          }
          onChange?.(cloudSales);
        } catch (err) {
          console.warn('Real-time sales sync processing notice:', err);
        }
      },
      (err) => console.warn('Sales listener notice:', err)
    );
    return unsub;
  } catch {
    return () => {};
  }
}

// Pull sales from Firestore on initial load or manual refresh
export async function pullSalesFromFirestore(shopId?: string): Promise<{ pulled: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { pulled: 0 };
  }

  try {
    const salesCol = collection(firestore, 'sales');
    const snap = await getDocs(salesCol);
    const cloudSales: Sale[] = [];

    for (const d of snap.docs) {
      const data = d.data() as Sale;
      if (data && data.lines) {
        const saleId = d.id;
        const cloudSale: Sale = {
          ...data,
          id: saleId,
          shopId: data.shopId || shopId || 'shop-electrical-01',
          subtotal: Number(data.subtotal) || Number(data.total) || 0,
          total: Number(data.total) || 0,
          status: data.status || 'completed',
          voidReason: data.voidReason,
          voidedAt: data.voidedAt,
          voidedBy: data.voidedBy,
          createdAtClient: Number(data.createdAtClient) || Date.now(),
        };
        cloudSales.push(cloudSale);
        await db.sales.put(cloudSale);
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('shopledger_sales_updated'));
    }

    return { pulled: cloudSales.length };
  } catch (err) {
    console.warn('Pull sales error (offline):', err);
    return { pulled: 0 };
  }
}

// Save or update an item across Dexie and Cloud Firestore
export async function saveItemAcrossDevices(item: Item): Promise<void> {
  const now = Date.now();
  const cleanItem: Item = {
    ...item,
    updatedAt: now,
  };
  await db.items.put(cleanItem);

  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await pushItem(cleanItem, false);
    } catch (err) {
      console.warn('Immediate Firestore item save failed, queued for sync:', err);
      await db.syncQueue.add({
        id: `sync-item-${cleanItem.id}-${now}`,
        entity: 'item',
        action: 'update',
        payload: cleanItem,
        attempts: 0,
        status: 'pending',
        createdAt: now,
      });
    }
  } else {
    await db.syncQueue.add({
      id: `sync-item-${cleanItem.id}-${now}`,
      entity: 'item',
      action: 'update',
      payload: cleanItem,
      attempts: 0,
      status: 'pending',
      createdAt: now,
    });
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
  }
}

// Delete an item across Dexie and Cloud Firestore
export async function deleteItemAcrossDevices(
  shopId: string,
  itemId: string,
  userId: string,
  userName: string
): Promise<void> {
  const now = Date.now();
  const existing = await db.items.get(itemId);
  await db.items.delete(itemId);

  await db.auditLogs.add({
    id: `audit-${now}-${Math.random().toString(36).substring(2, 7)}`,
    shopId,
    action: 'item_deleted',
    entity: 'items',
    entityId: itemId,
    userId,
    userName,
    meta: { name: existing?.name || itemId, sku: existing?.sku },
    createdAt: now,
  });

  if (navigator.onLine) {
    try {
      await deleteDoc(doc(firestore, 'items', itemId));
    } catch (err) {
      console.warn('Immediate Firestore delete failed, queued for sync:', err);
      await db.syncQueue.add({
        id: `sync-del-item-${itemId}-${now}`,
        entity: 'item',
        action: 'delete',
        payload: { id: itemId },
        attempts: 0,
        status: 'pending',
        createdAt: now,
      });
    }
  } else {
    await db.syncQueue.add({
      id: `sync-del-item-${itemId}-${now}`,
      entity: 'item',
      action: 'delete',
      payload: { id: itemId },
      attempts: 0,
      status: 'pending',
      createdAt: now,
    });
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
  }
}

// Pull latest shop settings & profile from Firestore
export async function pullShopFromFirestore(shopId: string): Promise<Shop | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return null;
  }
  try {
    const targetShopId = shopId || 'shop-electrical-01';
    const snap = await getDoc(doc(firestore, 'shops', targetShopId));
    if (snap.exists()) {
      const data = snap.data();
      const local = await db.shops.get(targetShopId);
      const mergedShop: Shop = {
        id: targetShopId,
        name: data.name || local?.name || 'AL-Q ELECTRICALS',
        currency: data.currency || local?.currency || 'GHS',
        currencySymbol: data.currencySymbol || local?.currencySymbol || 'GH₵',
        phone: data.phone || local?.phone || '+233 24 123 4567',
        address: data.address || local?.address || 'Accra, Ghana',
        taxRate: typeof data.taxRate === 'number' ? data.taxRate : (local?.taxRate ?? 0),
        settings: {
          ...(local?.settings || {}),
          ...(data.settings || {}),
        },
        createdAt: data.createdAt || local?.createdAt || Date.now(),
      };
      await db.shops.put(mergedShop);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('shopledger_shop_updated', { detail: mergedShop }));
      }
      return mergedShop;
    }
  } catch (err) {
    console.warn('Pull shop notice (offline):', err);
  }
  return null;
}

// Real-time listener for shop profile and settings across all devices
export function subscribeToCloudShop(shopId: string, onChange?: (shop: Shop) => void): () => void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return () => {};
  }
  try {
    const targetShopId = shopId || 'shop-electrical-01';
    const unsub = onSnapshot(
      doc(firestore, 'shops', targetShopId),
      async (snap) => {
        try {
          if (!snap.exists()) return;
          const data = snap.data();
          const local = await db.shops.get(targetShopId);
          const mergedShop: Shop = {
            id: targetShopId,
            name: data.name || local?.name || 'AL-Q ELECTRICALS',
            currency: data.currency || local?.currency || 'GHS',
            currencySymbol: data.currencySymbol || local?.currencySymbol || 'GH₵',
            phone: data.phone || local?.phone || '+233 24 123 4567',
            address: data.address || local?.address || 'Accra, Ghana',
            taxRate: typeof data.taxRate === 'number' ? data.taxRate : (local?.taxRate ?? 0),
            settings: {
              ...(local?.settings || {}),
              ...(data.settings || {}),
            },
            createdAt: data.createdAt || local?.createdAt || Date.now(),
          };
          await db.shops.put(mergedShop);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('shopledger_shop_updated', { detail: mergedShop }));
          }
          onChange?.(mergedShop);
        } catch (inner) {
          console.warn('Shop real-time update error:', inner);
        }
      },
      (err) => console.warn('Shop listener notice:', err)
    );
    return unsub;
  } catch {
    return () => {};
  }
}

// Real-time listener for staff accounts so accounts created by admin appear immediately on all devices
export function subscribeToCloudUsers(onChange?: (users: User[]) => void): () => void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return () => {};
  }
  try {
    const unsub = onSnapshot(
      collection(firestore, 'users'),
      async (snap) => {
        try {
          const blockedEmails = [
            'gha@gmail.com',
            'owner@shopledger.app',
            'alex.rivera@shopledger.app',
          ];
          const cloudUsers: User[] = [];
          const cloudIds = new Set<string>();

          for (const d of snap.docs) {
            const data = d.data() as User;
            const emailLower = (data?.email || '').toLowerCase().trim();
            if (emailLower && !blockedEmails.includes(emailLower)) {
              const u: User = {
                uid: d.id,
                shopId: data.shopId || 'shop-electrical-01',
                name: data.name || emailLower.split('@')[0],
                email: data.email,
                role: data.role || (emailLower === 'rajifarrid@gmail.com' || emailLower === 'wisdomosborn65@gmail.com' ? 'owner' : 'seller'),
                active: data.active !== false,
                deviceCode: data.deviceCode || (emailLower === 'abuyahwisdomosborn@gmail.com' ? 'D02' : 'D01'),
                pinHash: data.pinHash || '1234',
                createdAt: data.createdAt || Date.now(),
              };
              cloudUsers.push(u);
              cloudIds.add(d.id);
            }
          }

          if (cloudUsers.length > 0) {
            await db.users.bulkPut(cloudUsers);
          }

          // Protect designated accounts from deletion during Firestore diffing
          const isProtectedAccount = (em?: string) => {
            const l = (em || '').toLowerCase().trim();
            return (
              l === 'rajifarrid@gmail.com' ||
              l === 'wisdomosborn65@gmail.com' ||
              l === 'abuyahwisdomosborn@gmail.com'
            );
          };

          // Remove any local non-owner user deleted from Firestore
          const localUsers = await db.users.toArray();
          for (const loc of localUsers) {
            if (!isProtectedAccount(loc.email) && !cloudIds.has(loc.uid)) {
              await db.users.delete(loc.uid);
            }
          }

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('shopledger_users_updated'));
          }
          onChange?.(cloudUsers);
        } catch (inner) {
          console.warn('Real-time users sync error:', inner);
        }
      },
      (err) => console.warn('Users listener notice:', err)
    );
    return unsub;
  } catch {
    return () => {};
  }
}
