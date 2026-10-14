import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import { SEED_SHOP_ID } from '../db/seedData';
import {
  processSyncQueue,
  syncAllInventoryToFirestore,
  pullInventoryFromFirestore,
  subscribeToCloudInventory,
  subscribeToCloudSales,
  pullSalesFromFirestore,
  scheduleSync,
  retryFailedSync,
  requeueStuckStockMovements,
} from '../db/sync';

interface SyncContextType {
  isOnline: boolean;
  isSyncing: boolean;
  pendingSyncCount: number;
  failedSyncCount: number;
  lastSyncedTime: number | null;
  syncBannerMessage: string | null;
  triggerSync: () => Promise<void>;
  syncFullInventory: () => Promise<void>;
  retryFailedSyncAction: () => Promise<void>;
  simulateOfflineToggle: () => void;
  isSimulatedOffline: boolean;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [browserOnline, setBrowserOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSimulatedOffline, setIsSimulatedOffline] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [failedSyncCount, setFailedSyncCount] = useState(0);
  const [lastSyncedTime, setLastSyncedTime] = useState<number | null>(Date.now());
  const [syncBannerMessage, setSyncBannerMessage] = useState<string | null>(null);

  const effectiveOnline = browserOnline && !isSimulatedOffline;

  // Update pending and failed counts (Change 4)
  const refreshPendingCount = useCallback(async () => {
    try {
      const openCount = await db.syncQueue
        .where('status')
        .anyOf('pending', 'failed', 'syncing')
        .count();
      setPendingSyncCount(openCount);

      const failedCount = await db.syncQueue
        .where('status')
        .equals('failed')
        .count();
      setFailedSyncCount(failedCount);
    } catch {
      // Ignore during initial db bootstrap
    }
  }, []);

  const triggerSync = useCallback(async () => {
    if (!effectiveOnline || isSyncing) return;

    try {
      setIsSyncing(true);

      // 1. Process pending local queue (send sales, edits, voids)
      await processSyncQueue();

      // 2. Pull latest Cloud Firestore inventory & sales so all devices match
      const shop = await db.shops.toCollection().first();
      const shopId = shop?.id || SEED_SHOP_ID;
      await pullInventoryFromFirestore(shopId);
      await pullSalesFromFirestore(shopId);

      setLastSyncedTime(Date.now());
      await refreshPendingCount();
    } catch (err: any) {
      console.warn('Sync notice (offline/retry):', err?.message || err);
    } finally {
      setIsSyncing(false);
    }
  }, [effectiveOnline, isSyncing, refreshPendingCount]);

  // Explicit retry of failed items (Change 4)
  const retryFailedSyncAction = useCallback(async () => {
    if (!effectiveOnline || isSyncing) return;
    try {
      setIsSyncing(true);
      await retryFailedSync();
      await refreshPendingCount();
    } catch (err: any) {
      console.warn('Retry failed sync notice:', err?.message || err);
    } finally {
      setIsSyncing(false);
    }
  }, [effectiveOnline, isSyncing, refreshPendingCount]);

  // Explicit full catalog sync (called on demand from settings or imports)
  const syncFullInventory = useCallback(async () => {
    if (!effectiveOnline || isSyncing) return;
    try {
      setIsSyncing(true);
      const shop = await db.shops.toCollection().first();
      const shopId = shop?.id || SEED_SHOP_ID;
      await syncAllInventoryToFirestore(shopId, true);
      await pullInventoryFromFirestore(shopId);
      await pullSalesFromFirestore(shopId);
      await processSyncQueue();
      setLastSyncedTime(Date.now());
      await refreshPendingCount();
    } catch (err: any) {
      console.warn('Full sync notice:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [effectiveOnline, isSyncing, refreshPendingCount]);

  // Real-time listener for Cloud Firestore inventory & sales updates
  useEffect(() => {
    let unsubInventory: (() => void) | undefined;
    let unsubSales: (() => void) | undefined;

    async function initListener() {
      const shop = await db.shops.toCollection().first();
      const shopId = shop?.id || SEED_SHOP_ID;
      if (effectiveOnline) {
        // Initial non-blocking pull
        pullInventoryFromFirestore(shopId).catch(() => {});
        pullSalesFromFirestore(shopId).catch(() => {});

        // Real-time Firestore subscriptions across devices
        unsubInventory = subscribeToCloudInventory(shopId);
        unsubSales = subscribeToCloudSales(shopId);
      }
    }
    initListener();

    return () => {
      unsubInventory?.();
      unsubSales?.();
    };
  }, [effectiveOnline]);

  // Online / offline event listeners and sync scheduling
  useEffect(() => {
    scheduleSync();

    const handleOnline = () => {
      setBrowserOnline(true);
      scheduleSync();
    };

    const handleOffline = () => {
      setBrowserOnline(false);
      setSyncBannerMessage('Offline Mode — sales will save locally and sync when reconnected.');
      setTimeout(() => setSyncBannerMessage(null), 4000);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Requeue any stock movements stuck in failed/pending status from previous sessions
    const hasRequeuedV2 = typeof localStorage !== 'undefined' && localStorage.getItem('shopledger_requeue_v2');
    if (!hasRequeuedV2) {
      requeueStuckStockMovements().then((cnt) => {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('shopledger_requeue_v2', 'true');
        }
        if (cnt > 0) {
          scheduleSync();
          refreshPendingCount();
        }
      }).catch(() => {});
    }

    // Initial check
    refreshPendingCount();

    // 30s interval for background retry only (Change 7: no redundant full pulls every 30s)
    const interval = setInterval(() => {
      refreshPendingCount();
      if (effectiveOnline) {
        scheduleSync();
      }
    }, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [effectiveOnline, refreshPendingCount]);

  // When reconnecting online, automatically trigger queue sync
  useEffect(() => {
    if (effectiveOnline) {
      triggerSync();
    }
  }, [effectiveOnline, triggerSync]);

  const simulateOfflineToggle = () => {
    setIsSimulatedOffline((prev) => !prev);
  };

  return (
    <SyncContext.Provider
      value={{
        isOnline: effectiveOnline,
        isSyncing,
        pendingSyncCount,
        failedSyncCount,
        lastSyncedTime,
        syncBannerMessage,
        triggerSync,
        syncFullInventory,
        retryFailedSyncAction,
        simulateOfflineToggle,
        isSimulatedOffline,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
};

export const useSync = () => {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used within a SyncProvider');
  return context;
};
