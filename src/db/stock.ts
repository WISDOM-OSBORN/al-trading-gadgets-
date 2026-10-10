import { db } from './index';
import type { StockMovement, StockMovementType } from '../types';

export class StockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockError';
  }
}

export const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

export function assertWholeNumber(n: unknown, label: string): asserts n is number {
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new StockError(`${label} must be a whole number.`);
  }
}

export interface StockChangeInput {
  shopId: string;
  itemId: string;
  /** Signed delta. Sale = -qty, restock = +qty, void/return = +qty, withdrawal = -qty. */
  delta: number;
  type: StockMovementType;
  reason: string;
  refId?: string;
  userId: string;
  userName: string;
  allowNegative?: boolean;
  now?: number;
}

/**
 * THE ONLY function allowed to change Item.quantity.
 * Must run inside a Dexie 'rw' transaction that includes: items, stockMovements, syncQueue.
 * Reads the CURRENT quantity inside the transaction (never trusts UI state),
 * validates, applies the delta, writes the ledger row and enqueues a delta for the cloud.
 */
export async function applyStockChangeTx(input: StockChangeInput): Promise<StockMovement> {
  assertWholeNumber(input.delta, 'Quantity change');
  if (input.delta === 0) throw new StockError('Quantity change cannot be zero.');

  const item = await db.items.get(input.itemId);
  if (!item) throw new StockError('Item not found.');

  const prevQty = Number(item.quantity) || 0;
  const newQty = prevQty + input.delta;
  if (newQty < 0 && !input.allowNegative) {
    throw new StockError(
      `Insufficient stock for "${item.name}". In stock: ${prevQty}, requested: ${Math.abs(input.delta)}.`
    );
  }

  const now = input.now ?? Date.now();
  await db.items.update(item.id, { quantity: newQty, updatedAt: now });

  const movement: StockMovement = {
    id: newId('mov'),
    shopId: input.shopId,
    itemId: item.id,
    itemName: item.name,
    itemSku: item.sku,
    type: input.type,
    qtyChange: input.delta,
    previousQty: prevQty,
    newQty,
    reason: input.reason,
    refId: input.refId,
    userId: input.userId,
    userName: input.userName,
    createdAt: now,
  };
  await db.stockMovements.add(movement);

  // Always 'pending'. Only the queue processor may mark it 'synced', after the cloud confirms.
  await db.syncQueue.add({
    id: newId('sync'),
    entity: 'stockMovement',
    action: 'create',
    payload: movement,
    attempts: 0,
    status: 'pending',
    createdAt: now,
  });

  return movement;
}

/** Sum of not-yet-confirmed local deltas per item. Used when merging cloud quantities. */
export async function pendingDeltaByItem(): Promise<Map<string, number>> {
  const open = await db.syncQueue
    .where('entity')
    .equals('stockMovement')
    .filter((q) => q.status !== 'synced')
    .toArray();
  const map = new Map<string, number>();
  for (const q of open) {
    const m = q.payload as StockMovement;
    map.set(m.itemId, (map.get(m.itemId) || 0) + m.qtyChange);
  }
  return map;
}
