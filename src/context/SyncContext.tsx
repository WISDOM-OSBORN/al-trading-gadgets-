import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { db } from '../db';
import { processSyncQueue, syncAllInventoryToFirestore } from '../db/sync';

interface SyncContextType {
  isOnline: boolean;
  isSyncing: boolean;
  pendingSyncCount: number;
  lastSyncedTime: number | null;
  syncBannerMessage: string | null;
  triggerSync: () => Promise<void>;
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

      const result = await processSyncQueue();

      // Ensure all inventory items, imports, and withdrawals are synced to Cloud Firestore
      const shop = await db.shops.toCollection().first();
      if (shop) {
        await syncAllInventoryToFirestore(shop.id);
      }

      if (result.synced > 0) {
        setSyncBannerMessage(`All synced (${result.synced} item${result.synced > 1 ? 's' : ''})`);
        setLastSyncedTime(Date.now());
        setTimeout(() => setSyncBannerMessage(null), 3500);
      } else {
        setSyncBannerMessage(null);
      }

      await refreshPendingCount();
    } catch (err: any) {
      console.warn('Sync notice (offline/retry):', err?.message || err);
      setSyncBannerMessage('Offline Mode — will retry sync when reconnected');
      setTimeout(() => setSyncBannerMessage(null), 4000);
    } finally {
      setIsSyncing(false);
    }
  }, [effectiveOnline, isSyncing, refreshPendingCount]);

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
