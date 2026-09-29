import { db } from './index';
import { firestore } from './firebase';
import { doc, setDoc } from 'firebase/firestore';
import {
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
  });

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

    // 1. Restore stock
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
      status: navigator.onLine ? 'synced' : 'pending',
      createdAt: now,
    });
  });

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
        await setDoc(doc(firestore, 'sales', item.payload.id), item.payload, { merge: true });
        await db.sales.update(item.payload.id, { syncedAt: Date.now() });
      } else if (item.entity === 'item' && item.payload?.id) {
        await setDoc(doc(firestore, 'items', item.payload.id), item.payload, { merge: true });
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
