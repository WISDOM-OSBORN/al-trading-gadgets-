import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import {
  processSyncQueue,
  syncAllInventoryToFirestore,
  pullInventoryFromFirestore,
  subscribeToCloudInventory,
} from '../db/sync';

interface SyncContextType {
  isOnline: boolean;
  isSyncing: boolean;
  pendingSyncCount: number;
  lastSyncedTime: number | null;
  syncBannerMessage: string | null;
  triggerSync: () => Promise<void>;
  syncFullInventory: () => Promise<void>;
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
  const [lastSyncedTime, setLastSyncedTime] = useState<number | null>(Date.now());
  const [syncBannerMessage, setSyncBannerMessage] = useState<string | null>(null);

  const effectiveOnline = browserOnline && !isSimulatedOffline;

  // Update pending count
  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await db.syncQueue.where('status').equals('pending').count();
      setPendingSyncCount(count);
    } catch {
      // Ignore during initial db bootstrap
    }
  }, []);

  const triggerSync = useCallback(async () => {
    if (!effectiveOnline || isSyncing) return;

    try {
      setIsSyncing(true);
      const pendingCount = await db.syncQueue.where('status').equals('pending').count();
      if (pendingCount > 0) {
        setSyncBannerMessage(`Syncing ${pendingCount} pending change${pendingCount > 1 ? 's' : ''}...`);
      }

      // 1. Process pending local queue (send sales, edits, voids)
      const result = await processSyncQueue();

      // 2. Pull latest Cloud Firestore inventory so all devices match
      const shop = await db.shops.toCollection().first();
      let pulledCount = 0;
      if (shop) {
        const pullRes = await pullInventoryFromFirestore(shop.id);
        pulledCount = pullRes.pulled;
      }

      if (result.synced > 0 || pulledCount > 0) {
        const parts: string[] = [];
        if (result.synced > 0) parts.push(`${result.synced} change${result.synced > 1 ? 's' : ''} saved`);
        if (pulledCount > 0) parts.push(`${pulledCount} items synced`);
        setSyncBannerMessage(`Cloud synced (${parts.join(', ')})`);
        setLastSyncedTime(Date.now());
        setTimeout(() => setSyncBannerMessage(null), 3000);
      } else {
        setSyncBannerMessage(null);
      }

      await refreshPendingCount();
    } catch (err: any) {
      console.warn('Sync notice (offline/retry):', err?.message || err);
      setSyncBannerMessage('Offline Mode — will retry sync when reconnected');
      setTimeout(() => setSyncBannerMessage(null), 3000);
    } finally {
      setIsSyncing(false);
    }
  }, [effectiveOnline, isSyncing, refreshPendingCount]);

  // Explicit full catalog sync (called on demand from settings or imports)
  const syncFullInventory = useCallback(async () => {
    if (!effectiveOnline || isSyncing) return;
    try {
      setIsSyncing(true);
      setSyncBannerMessage('Reconciling full inventory catalog with cloud...');
      const shop = await db.shops.toCollection().first();
      if (shop) {
        await syncAllInventoryToFirestore(shop.id, true);
        await pullInventoryFromFirestore(shop.id);
      }
      await processSyncQueue();
      setSyncBannerMessage('Full inventory catalog synchronized across all devices.');
      setLastSyncedTime(Date.now());
      setTimeout(() => setSyncBannerMessage(null), 3500);
      await refreshPendingCount();
    } catch (err: any) {
      console.warn('Full sync notice:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [effectiveOnline, isSyncing, refreshPendingCount]);

  // Real-time listener for Cloud Firestore inventory updates
  useEffect(() => {
    let unsub: (() => void) | undefined;
    async function initListener() {
      const shop = await db.shops.toCollection().first();
      if (shop && effectiveOnline) {
        // Initial non-blocking pull
        pullInventoryFromFirestore(shop.id).catch(() => {});
        // Real-time Firestore subscription
        unsub = subscribeToCloudInventory(shop.id);
      }
    }
    initListener();

    return () => {
      unsub?.();
    };
  }, [effectiveOnline]);

  // Online / offline event listeners
  useEffect(() => {
    const handleOnline = () => {
      setBrowserOnline(true);
    };

    const handleOffline = () => {
      setBrowserOnline(false);
      setSyncBannerMessage('Offline Mode — sales will save locally and sync when reconnected.');
      setTimeout(() => setSyncBannerMessage(null), 4000);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check
    refreshPendingCount();

    // Polling interval for pending queue & auto-sync
    const interval = setInterval(() => {
      refreshPendingCount();
      if (effectiveOnline) {
        triggerSync();
      }
    }, 15000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [effectiveOnline, triggerSync, refreshPendingCount]);

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
        lastSyncedTime,
        syncBannerMessage,
        triggerSync,
        syncFullInventory,
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
