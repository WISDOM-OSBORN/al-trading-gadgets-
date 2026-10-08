import { db } from './index';
import { firestore, sanitizeForFirestore } from './firebase';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  collection,
  query,
  where,
  onSnapshot,
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

export interface RecordSaleParams {
  shopId: string;
  sellerId: string;
  sellerName: string;
  deviceCode: string;
  invoicePrefix: string;
  allowNegativeStock: boolean;
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

// Generate offline-safe collision-free invoice number: <prefix>-<deviceCode>-<seq>
export async function generateNextInvoiceNumber(prefix: string, deviceCode: string): Promise<string> {
  const deviceKey = `shopledger_seq_${deviceCode}`;
  let seq = parseInt(localStorage.getItem(deviceKey) || '0', 10);
  if (isNaN(seq) || seq < 1) {
    // Find highest invoice in database for this deviceCode
    const existingSales = await db.sales
      .filter((s) => s.deviceCode === deviceCode)
      .toArray();
    seq = existingSales.length;
  }
  seq += 1;
  localStorage.setItem(deviceKey, seq.toString());

  const paddedSeq = seq.toString().padStart(4, '0');
  return `${prefix}-${deviceCode}-${paddedSeq}`;
}

// Atomically record a sale
export async function recordSale(params: RecordSaleParams): Promise<Sale> {
  const {
    shopId,
    sellerId,
    sellerName,
    deviceCode,
    invoicePrefix,
    allowNegativeStock,
    customerName,
    customerPhone,
    lines,
    subtotal,
    discountTotal,
    tax,
    total,
    payments,
    notes,
  } = params;

  const saleId = `sale-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const invoiceNo = await generateNextInvoiceNumber(invoicePrefix || 'INV', deviceCode || 'D01');
  const now = Date.now();
  const exactTimeSold = new Date(now).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const newSale: Sale = {
    id: saleId,
    invoiceNo,
    shopId,
    sellerId,
    sellerName,
    customerName: customerName?.trim() || undefined,
    customerPhone: customerPhone?.trim() || undefined,
    lines,
    subtotal: subtotal || total,
    discountTotal: discountTotal || 0,
    tax: tax || 0,
    total,
    payments: payments || [{ method: 'Cash', amount: total }],
    status: 'completed',
    createdAtClient: now,
    exactTimeSold,
    syncedAt: navigator.onLine ? now : null,
    deviceCode,
    notes,
  };

  await db.transaction('rw', [
    db.items,
    db.sales,
    db.stockMovements,
    db.customers,
    db.auditLogs,
    db.syncQueue,
  ], async () => {
    // 1. Validate & Decrement stock
    for (const line of lines) {
      const item = await db.items.get(line.itemId);
      if (!item) {
        throw new Error(`Item ${line.name} (SKU: ${line.sku}) not found.`);
      }

      if (!allowNegativeStock && item.quantity < line.qty) {
        throw new Error(
          `Insufficient stock for "${item.name}". In stock: ${item.quantity}, requested: ${line.qty}.`
        );
      }

      const prevQty = item.quantity;
      const newQty = prevQty - line.qty;
      newSale.remainingStockAfterSale = newQty;

      await db.items.update(item.id, {
        quantity: newQty,
        updatedAt: now,
      });

      // Record stock movement
      const movement: StockMovement = {
        id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        shopId,
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku,
        type: 'sale',
        qtyChange: -line.qty,
        previousQty: prevQty,
        newQty: newQty,
        reason: `Sale ${invoiceNo}`,
        refId: saleId,
        userId: sellerId,
        userName: sellerName,
        createdAt: now,
      };
      await db.stockMovements.add(movement);
    }

    // 2. Handle Credit balance if applicable
    const creditPayment = payments?.find((p) => p.method === 'Credit');
    if (creditPayment && creditPayment.amount > 0) {
      const cName = customerName?.trim() || 'Unknown Customer';
      const cPhone = customerPhone?.trim() || '';

      // Check if customer already exists by phone or name
      let customer = await db.customers
        .filter((c) => (cPhone && c.phone === cPhone) || c.name.toLowerCase() === cName.toLowerCase())
        .first();

      if (customer) {
        await db.customers.update(customer.id, {
          balanceOwed: (customer.balanceOwed || 0) + creditPayment.amount,
          updatedAt: now,
        });
        newSale.customerId = customer.id;
      } else {
        const newCustomerId = `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
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
        newSale.customerId = newCustomerId;
      }
    }

    // 3. Save Sale
    await db.sales.add(newSale);

    // 4. Audit Log
    const audit: AuditLog = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      shopId,
      action: 'sale_created',
      entity: 'sales',
      entityId: saleId,
      userId: sellerId,
      userName: sellerName,
      meta: {
        invoiceNo,
        total,
        itemsCount: lines.length,
        isOffline: !navigator.onLine,
      },
      createdAt: now,
    };
    await db.auditLogs.add(audit);

    // 5. Add to Sync Queue
    const syncItem: SyncQueueItem = {
      id: `sync-${saleId}`,
      entity: 'sale',
      action: 'create',
      payload: newSale,
      attempts: 0,
      status: navigator.onLine ? 'synced' : 'pending',
      createdAt: now,
    };
    await db.syncQueue.add(syncItem);

    // Enqueue updated item quantities to syncQueue for robust offline/online parity
    for (const line of lines) {
      const item = await db.items.get(line.itemId);
      if (item) {
        await db.syncQueue.add({
          id: `sync-item-${item.id}-${now}`,
          entity: 'item',
          action: 'update',
          payload: item,
          attempts: 0,
          status: navigator.onLine ? 'synced' : 'pending',
          createdAt: now,
        });
      }
    }
  });

  // 6. Direct real-time write to Firestore if online
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await setDoc(doc(firestore, 'sales', newSale.id), sanitizeForFirestore(newSale), { merge: true });
      await db.sales.update(newSale.id, { syncedAt: now });

      // Update full item records with updated quantities in Firestore
      for (const line of lines) {
        const currentItem = await db.items.get(line.itemId);
        if (currentItem) {
          await setDoc(
            doc(firestore, 'items', line.itemId),
            sanitizeForFirestore(currentItem),
            { merge: true }
          );
        }
      }
    } catch (fErr) {
      console.warn('Direct Firestore sale write scheduled to retry:', fErr);
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shopledger_sales_updated'));
    window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
  }

  return newSale;
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
    if (!sale) throw new Error('Sale not found.');
    if (sale.status === 'voided') throw new Error('Sale is already voided.');

    // 1. Restore stock in local ledger
    for (const line of sale.lines) {
      const item = await db.items.get(line.itemId);
      if (item) {
        const prevQty = item.quantity;
        const newQty = prevQty + line.qty;

        await db.items.update(item.id, {
          quantity: newQty,
          updatedAt: now,
        });

        const movement: StockMovement = {
          id: `mov-void-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          shopId: sale.shopId,
          itemId: item.id,
          itemName: item.name,
          itemSku: item.sku,
          type: 'return',
          qtyChange: line.qty,
          previousQty: prevQty,
          newQty: newQty,
          reason: `Void sale ${sale.invoiceNo}: ${voidReason}`,
          refId: sale.id,
          userId,
          userName,
          createdAt: now,
        };
        await db.stockMovements.add(movement);

        // Queue item stock restoration for sync
        await db.syncQueue.add({
          id: `sync-item-void-${item.id}-${now}`,
          entity: 'item',
          action: 'update',
          payload: { ...item, quantity: newQty, updatedAt: now },
          attempts: 0,
          status: navigator.onLine ? 'synced' : 'pending',
          createdAt: now,
        });
      }
    }

    // 2. Reverse customer credit balance if sale had credit
    const creditPayment = sale.payments.find((p) => p.method === 'Credit');
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

    // 3. Mark sale as voided
    await db.sales.update(saleId, {
      status: 'voided',
      voidReason,
      voidedAt: now,
      voidedBy: userName,
    });

    // 4. Audit Log
    const audit: AuditLog = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      shopId: sale.shopId,
      action: 'sale_voided',
      entity: 'sales',
      entityId: saleId,
      userId,
      userName,
      meta: {
        invoiceNo: sale.invoiceNo,
        amount: sale.total,
        reason: voidReason,
      },
      createdAt: now,
    };
    await db.auditLogs.add(audit);

    // 5. Add void sync
    const syncItem: SyncQueueItem = {
      id: `sync-void-${saleId}-${now}`,
      entity: 'sale',
      action: 'update',
      payload: { id: saleId, status: 'voided', voidReason, voidedAt: now, voidedBy: userName },
      attempts: 0,
      status: navigator.onLine ? 'synced' : 'pending',
      createdAt: now,
    };
    await db.syncQueue.add(syncItem);
  });

  // Direct live Firestore write if online: immediately updates Firestore sales & items docs
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      const sale = await db.sales.get(saleId);
      if (sale) {
        await setDoc(
          doc(firestore, 'sales', saleId),
          { status: 'voided', voidReason, voidedAt: now, voidedBy: userName },
          { merge: true }
        );
        for (const line of sale.lines) {
          const currentItem = await db.items.get(line.itemId);
          if (currentItem) {
            await setDoc(
              doc(firestore, 'items', line.itemId),
              sanitizeForFirestore(currentItem),
              { merge: true }
            );
          }
        }
      }
    } catch (fErr) {
      console.warn('Direct Firestore void write notice:', fErr);
    }
  }

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
  const now = Date.now();

  let finalQty = 0;
  await db.transaction('rw', [db.items, db.stockMovements, db.auditLogs, db.syncQueue], async () => {
    const item = await db.items.get(itemId);
    if (!item) throw new Error('Item not found.');

    const prevQty = item.quantity;
    finalQty = prevQty + qtyChange;

    await db.items.update(itemId, {
      quantity: finalQty,
      updatedAt: now,
    });

    const movement: StockMovement = {
      id: `mov-adj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      shopId,
      itemId,
      itemName: item.name,
      itemSku: item.sku,
      type: reasonType === 'restock' ? 'restock' : 'adjustment',
      qtyChange,
      previousQty: prevQty,
      newQty: finalQty,
      reason: `${reasonType.toUpperCase()}: ${notes}`,
      userId,
      userName,
      createdAt: now,
    };
    await db.stockMovements.add(movement);

    await db.auditLogs.add({
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      shopId,
      action: 'stock_adjusted',
      entity: 'items',
      entityId: itemId,
      userId,
      userName,
      meta: {
        sku: item.sku,
        name: item.name,
        qtyChange,
        previousQty: prevQty,
        newQty: finalQty,
        reason: `${reasonType}: ${notes}`,
      },
      createdAt: now,
    });

    await db.syncQueue.add({
      id: `sync-adj-${itemId}-${now}`,
      entity: 'item',
      action: 'update',
      payload: { id: itemId, quantity: finalQty },
      attempts: 0,
      status: 'pending',
      createdAt: now,
    });
  });

  // Direct live Firestore write if online
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await setDoc(
        doc(firestore, 'items', itemId),
        { quantity: finalQty, updatedAt: now },
        { merge: true }
      );
    } catch (fErr) {
      console.warn('Direct Firestore stock adjust write notice:', fErr);
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
  }

  return finalQty;
}

// Background Sync Queue Processor
export async function processSyncQueue(): Promise<{ synced: number; remaining: number }> {
  if (!navigator.onLine) {
    const count = await db.syncQueue.where('status').equals('pending').count();
    return { synced: 0, remaining: count };
  }

  const pendingItems = await db.syncQueue
    .where('status')
    .equals('pending')
    .limit(50)
    .toArray();

  if (pendingItems.length === 0) {
    return { synced: 0, remaining: 0 };
  }

  let syncedCount = 0;
  for (const item of pendingItems) {
    try {
      await db.syncQueue.update(item.id, { status: 'syncing' });

      // Sync to live Firestore database
      if (item.entity === 'sale' && item.payload?.id) {
        await setDoc(doc(firestore, 'sales', item.payload.id), sanitizeForFirestore(item.payload), { merge: true });
        await db.sales.update(item.payload.id, { syncedAt: Date.now() });
      } else if (item.entity === 'item' && item.payload?.id) {
        if (item.action === 'delete') {
          await deleteDoc(doc(firestore, 'items', item.payload.id));
        } else {
          await setDoc(doc(firestore, 'items', item.payload.id), sanitizeForFirestore(item.payload), { merge: true });
        }
      } else if (item.entity === 'withdrawal' && item.payload?.id) {
        await setDoc(doc(firestore, 'withdrawals', item.payload.id), sanitizeForFirestore(item.payload), { merge: true });
      } else if (item.entity === 'import' && item.payload?.id) {
        await setDoc(doc(firestore, 'imports', item.payload.id), sanitizeForFirestore(item.payload), { merge: true });
      }

      await db.syncQueue.update(item.id, {
        status: 'synced',
        attempts: item.attempts + 1,
      });
      syncedCount++;
    } catch (err: any) {
      await db.syncQueue.update(item.id, {
        status: 'failed',
        attempts: item.attempts + 1,
        lastError: err?.message || 'Sync error',
      });
    }
  }

  const remaining = await db.syncQueue.where('status').equals('pending').count();
  return { synced: syncedCount, remaining };
}

// Bulk sync all shop items and import records to Firestore (with optional catalog reconciliation)
export async function syncAllInventoryToFirestore(
  shopId: string,
  replaceCatalog = false
): Promise<{ count: number; error?: string }> {
  if (!navigator.onLine) {
    return { count: 0, error: 'Device is offline' };
  }

  try {
    const allItems = await db.items.where('shopId').equals(shopId).toArray();
    const localItemIds = new Set(allItems.map((i) => i.id));

    // If replaceCatalog is true (e.g. after CSV import or manual sync), prune any old items from Firestore
    if (replaceCatalog) {
      try {
        const snap = await getDocs(collection(firestore, 'items'));
        for (const docSnap of snap.docs) {
          if (!localItemIds.has(docSnap.id)) {
            await deleteDoc(docSnap.ref);
          }
        }
      } catch (err) {
        console.warn('Notice pruning old Firestore items:', err);
      }
    }

    if (allItems.length > 0) {
      const batchSize = 400;
      for (let i = 0; i < allItems.length; i += batchSize) {
        const chunk = allItems.slice(i, i + batchSize);
        const batch = writeBatch(firestore);
        for (const it of chunk) {
          batch.set(doc(firestore, 'items', it.id), sanitizeForFirestore(it), { merge: true });
        }
        await batch.commit();
      }
    }

    // Touch shop doc in Firestore so other devices detect the new catalog update
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

    // 1. Check shop document for cloud purge commands
    try {
      const shopSnap = await getDoc(doc(firestore, 'shops', targetShopId));
      if (shopSnap.exists()) {
        const shopData = shopSnap.data();
        const cloudPurgedAt = shopData?.lastInventoryPurgedAt || 0;
        const localPurgedAt = parseInt(localStorage.getItem('shopledger_last_purged_at') || '0', 10);
        if (cloudPurgedAt > localPurgedAt) {
          // Cloud purge was performed by owner! Clear local dummy/stale records
          await db.items.clear();
          await db.sales.clear();
          await db.stockMovements.clear();
          await db.imports.clear();
          localStorage.setItem('shopledger_last_purged_at', cloudPurgedAt.toString());
        }
      }
    } catch (checkErr) {
      console.warn('Could not check purge status:', checkErr);
    }

    // 2. Fetch all items from Firestore
    const itemsCol = collection(firestore, 'items');
    let snap = await getDocs(query(itemsCol, where('shopId', '==', targetShopId)));
    if (snap.empty) {
      snap = await getDocs(itemsCol);
    }

    if (snap.empty) {
      const locCount = await db.items.count();
      if (locCount > 0) {
        await db.items.clear();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
        }
      }
      return { pulled: 0, removed: locCount };
    }

    const cloudItems: Item[] = [];
    const cloudItemIds = new Set<string>();

    for (const d of snap.docs) {
      const data = d.data() as Item;
      if (data && data.name) {
        const itemObj: Item = {
          ...data,
          id: d.id,
          shopId: data.shopId || targetShopId,
          costPrice: Number(data.costPrice) || 0,
          sellingPrice: Number(data.sellingPrice) || 0,
          quantity: Number(data.quantity) || 0,
          archived: Boolean(data.archived),
        };
        cloudItems.push(itemObj);
        cloudItemIds.add(d.id);
      }
    }

    if (cloudItems.length > 0) {
      await db.items.bulkPut(cloudItems);
    }

    // 3. Remove local items that were deleted in Cloud Firestore
    let removedCount = 0;
    const localItems = await db.items.toArray();
    for (const loc of localItems) {
      if (!cloudItemIds.has(loc.id)) {
        await db.items.delete(loc.id);
        removedCount++;
      }
    }

    // Notify UI components
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
    }

    return { pulled: cloudItems.length, removed: removedCount };
  } catch (err) {
    console.warn('Pull inventory notice (offline fallback active):', err);
    return { pulled: 0, removed: 0 };
  }
}

// Real-time listener for Firestore items so all connected seller devices update immediately
export function subscribeToCloudInventory(shopId: string, onChange?: () => void): () => void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return () => {};
  }

  try {
    const targetShopId = shopId || 'shop-electrical-01';
    const itemsCol = collection(firestore, 'items');
    const unsub = onSnapshot(
      itemsCol,
      async (snap) => {
        try {
          if (snap.empty) {
            await db.items.clear();
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
            }
            onChange?.();
            return;
          }

          const cloudItems: Item[] = [];
          const cloudIds = new Set<string>();
          for (const d of snap.docs) {
            const data = d.data() as Item;
            if (data && data.name) {
              cloudItems.push({
                ...data,
                id: d.id,
                shopId: data.shopId || targetShopId,
                costPrice: Number(data.costPrice) || 0,
                sellingPrice: Number(data.sellingPrice) || 0,
                quantity: Number(data.quantity) || 0,
                archived: Boolean(data.archived),
              });
              cloudIds.add(d.id);
            } else if (data && data.quantity !== undefined) {
              const existing = await db.items.get(d.id);
              if (existing) {
                await db.items.update(d.id, {
                  quantity: Number(data.quantity) || 0,
                  updatedAt: Date.now(),
                });
              }
              cloudIds.add(d.id);
            }
          }

          if (cloudItems.length > 0) {
            await db.items.bulkPut(cloudItems);
          }

          // Clean local items not in cloud only if cloud has verified catalog items
          if (cloudIds.size > 0) {
            const localItems = await db.items.toArray();
            for (const loc of localItems) {
              if (!cloudIds.has(loc.id)) {
                await db.items.delete(loc.id);
              }
            }
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

// Real-time listener for Firestore sales so transactions & void status reflect across all devices simultaneously
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
              cloudSales.push({
                ...data,
                id: d.id,
                shopId: data.shopId || shopId || 'shop-electrical-01',
                subtotal: Number(data.subtotal) || Number(data.total) || 0,
                total: Number(data.total) || 0,
                status: data.status || 'completed',
                voidReason: data.voidReason,
                voidedAt: data.voidedAt,
                voidedBy: data.voidedBy,
                createdAtClient: Number(data.createdAtClient) || Date.now(),
              });
            }
          }

          if (cloudSales.length > 0) {
            // Check if any sale is newly marked as voided compared to local state, restore stock locally if needed
            for (const cs of cloudSales) {
              if (cs.status === 'voided') {
                const localSale = await db.sales.get(cs.id);
                // If local sale was completed and has now been voided from owner or seller on another device
                if (localSale && localSale.status === 'completed') {
                  for (const line of cs.lines) {
                    const localItem = await db.items.get(line.itemId);
                    if (localItem) {
                      await db.items.update(line.itemId, {
                        quantity: localItem.quantity + line.qty,
                        updatedAt: Date.now(),
                      });
                    }
                  }
                }
              }
            }

            await db.sales.bulkPut(cloudSales);
          }

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('shopledger_sales_updated'));
            window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
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
        cloudSales.push({
          ...data,
          id: d.id,
          shopId: data.shopId || shopId || 'shop-electrical-01',
          subtotal: Number(data.subtotal) || Number(data.total) || 0,
          total: Number(data.total) || 0,
          status: data.status || 'completed',
          voidReason: data.voidReason,
          voidedAt: data.voidedAt,
          voidedBy: data.voidedBy,
          createdAtClient: Number(data.createdAtClient) || Date.now(),
        });
      }
    }

    if (cloudSales.length > 0) {
      // Check if any pulled sale is voided where local was completed
      for (const cs of cloudSales) {
        if (cs.status === 'voided') {
          const localSale = await db.sales.get(cs.id);
          if (localSale && localSale.status === 'completed') {
            for (const line of cs.lines) {
              const localItem = await db.items.get(line.itemId);
              if (localItem) {
                await db.items.update(line.itemId, {
                  quantity: localItem.quantity + line.qty,
                  updatedAt: Date.now(),
                });
              }
            }
          }
        }
      }

      await db.sales.bulkPut(cloudSales);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('shopledger_sales_updated'));
      window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
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

  if (navigator.onLine) {
    try {
      await setDoc(doc(firestore, 'items', cleanItem.id), sanitizeForFirestore(cleanItem), { merge: true });
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
                role: data.role || (emailLower === 'rajifarrid@gmail.com' ? 'owner' : 'seller'),
                active: data.active !== false,
                deviceCode: data.deviceCode || 'D01',
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

          // Remove any local non-owner user deleted from Firestore
          const localUsers = await db.users.toArray();
          for (const loc of localUsers) {
            if (loc.email?.toLowerCase() !== 'rajifarrid@gmail.com' && !cloudIds.has(loc.uid)) {
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
