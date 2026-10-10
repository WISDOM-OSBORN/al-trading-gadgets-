// src/db/__tests__/stock.test.ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../firebase', () => ({ firestore: {}, sanitizeForFirestore: (x: unknown) => x }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(), setDoc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), deleteDoc: vi.fn(),
  writeBatch: vi.fn(), collection: vi.fn(), query: vi.fn(), where: vi.fn(),
  onSnapshot: vi.fn(), runTransaction: vi.fn(), increment: (n: number) => ({ __inc: n }),
  deleteField: vi.fn(),
}));

import { db } from '../index';
import { recordSale, voidSale, adjustStock } from '../sync';
import { pendingDeltaByItem } from '../stock';

const base = { id: 'i1', shopId: 's1', sku: 'A1', name: 'Bulb', category: 'x', brand: '',
  costPrice: 5, sellingPrice: 10, quantity: 10, reorderLevel: 2, archived: false, createdAt: 1, updatedAt: 1 };
const sale = (qty: number, itemId = 'i1') => ({
  shopId: 's1', sellerId: 'u1', sellerName: 'U', deviceCode: 'D01', invoicePrefix: 'INV',
  lines: [{ itemId, name: 'Bulb', sku: 'A1', qty, unitPrice: 10, costPriceAtSale: 5, discount: 0, lineTotal: 0 }],
  subtotal: 0, total: 0,
});

beforeEach(async () => {
  await Promise.all([db.items, db.sales, db.stockMovements, db.syncQueue, db.auditLogs, db.shops].map((t) => t.clear()));
  await db.shops.add({ id: 's1', name: 'S', currency: 'GHS', currencySymbol: 'GH₵', phone: '', address: '', taxRate: 0, createdAt: 1,
    settings: { allowPriceOverride: true, allowNegativeStock: false, invoicePrefix: 'INV', receiptFooter: '', lowStockThresholdDefault: 5, taxRatePercent: 0 } });
  await db.items.add({ ...base });
});

describe('quantity logic', () => {
  it('sale decrements stock, writes one ledger row and one pending queue row', async () => {
    await recordSale(sale(3));
    expect((await db.items.get('i1'))!.quantity).toBe(7);
    expect(await db.stockMovements.count()).toBe(1);
    const q = await db.syncQueue.where('entity').equals('stockMovement').toArray();
    expect(q).toHaveLength(1);
    expect(q[0].status).toBe('pending');
  });

  it('recomputes totals and ignores the caller-supplied total', async () => {
    const s = await recordSale(sale(2));
    expect(s.total).toBe(20);
  });

  it('rejects oversell and leaves NO partial writes', async () => {
    await expect(recordSale(sale(11))).rejects.toThrow(/Insufficient stock/);
    expect((await db.items.get('i1'))!.quantity).toBe(10);
    expect(await db.stockMovements.count()).toBe(0);
    expect(await db.sales.count()).toBe(0);
  });

  it('rejects negative, zero and fractional quantities', async () => {
    for (const q of [-1, 0, 1.5, NaN]) await expect(recordSale(sale(q))).rejects.toThrow();
    expect((await db.items.get('i1'))!.quantity).toBe(10);
  });

  it('same item on two lines is validated against fresh stock each time', async () => {
    const s = sale(6);
    s.lines.push({ ...s.lines[0] });
    await expect(recordSale(s)).rejects.toThrow(/Insufficient stock/);
    expect((await db.items.get('i1'))!.quantity).toBe(10);
  });

  it('void restores stock exactly once', async () => {
    const s = await recordSale(sale(4));
    await voidSale(s.id, 'mistake', 'u1', 'U');
    expect((await db.items.get('i1'))!.quantity).toBe(10);
    await expect(voidSale(s.id, 'again', 'u1', 'U')).rejects.toThrow(/already voided/i);
    expect((await db.items.get('i1'))!.quantity).toBe(10);
  });

  it('adjustStock cannot take stock below zero', async () => {
    await expect(adjustStock({ shopId: 's1', itemId: 'i1', qtyChange: -11, reasonType: 'damage', notes: '', userId: 'u', userName: 'U' }))
      .rejects.toThrow(/Insufficient stock/);
  });

  it('pendingDeltaByItem sums only unsynced movements', async () => {
    await recordSale(sale(3));
    await adjustStock({ shopId: 's1', itemId: 'i1', qtyChange: 5, reasonType: 'restock', notes: '', userId: 'u', userName: 'U' });
    expect((await pendingDeltaByItem()).get('i1')).toBe(2);
    const first = (await db.syncQueue.toArray())[0];
    await db.syncQueue.update(first.id, { status: 'synced' });
    expect((await pendingDeltaByItem()).get('i1')).toBeDefined();
  });
});
