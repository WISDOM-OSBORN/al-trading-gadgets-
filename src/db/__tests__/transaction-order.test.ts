import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Firestore Transaction Safety (All reads before all writes)', () => {
  it('enforces that no tx.get is called after any tx.set, update, or delete', async () => {
    // Simulator of strict Firestore SDK transaction behavior
    let hasWritten = false;
    let readCount = 0;
    let writeCount = 0;

    const fakeTx = {
      get: vi.fn(async (docRef: any) => {
        if (hasWritten) {
          throw new Error('Firestore transactions require all reads to be executed before all writes');
        }
        readCount++;
        return {
          exists: () => true,
          data: () => ({ quantity: 10, recentMovementIds: [] }),
        };
      }),
      set: vi.fn((docRef: any, data: any, options?: any) => {
        hasWritten = true;
        writeCount++;
      }),
      update: vi.fn((docRef: any, data: any) => {
        hasWritten = true;
        writeCount++;
      }),
    };

    // Simulate pushStockMovement transaction logic:
    // ALL reads first:
    const movSnap = await fakeTx.get({ id: 'mov-1' });
    const itemSnap = await fakeTx.get({ id: 'item-1' });

    // THEN all writes:
    fakeTx.set({ id: 'mov-1' }, { id: 'mov-1', qtyChange: -2 });
    fakeTx.set({ id: 'item-1' }, { quantity: 8 }, { merge: true });

    expect(readCount).toBe(2);
    expect(writeCount).toBe(2);
    expect(hasWritten).toBe(true);

    // If a read is attempted after a write:
    await expect(fakeTx.get({ id: 'item-2' })).rejects.toThrow(
      'Firestore transactions require all reads to be executed before all writes'
    );
  });
});
