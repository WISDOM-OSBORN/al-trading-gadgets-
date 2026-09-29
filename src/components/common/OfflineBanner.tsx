import React from 'react';
import { useSync } from '../../context/SyncContext';
import { Wifi, WifiOff, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

export const OfflineBanner: React.FC = () => {
  const {
    isOnline,
    isSyncing,
    pendingSyncCount,
    syncBannerMessage,
    triggerSync,
    simulateOfflineToggle,
    isSimulatedOffline,
  } = useSync();

  return (
    <>
      {/* Toast Notification for Sync Events */}
      {syncBannerMessage && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-slate-900/95 text-white shadow-xl text-xs font-medium flex items-center gap-2 border border-slate-700 backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200">
          {syncBannerMessage.includes('All synced') ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          ) : syncBannerMessage.includes('Offline') ? (
            <WifiOff className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isSyncing ? 'animate-spin' : ''}`} />
          )}
          <span>{syncBannerMessage}</span>
        </div>
      )}

      {/* Floating Offline Pill if offline */}
      {!isOnline && (
        <div className="fixed bottom-20 left-4 z-40 flex items-center gap-2 rounded-full bg-amber-600/95 text-white px-3 py-1.5 text-xs font-semibold shadow-lg backdrop-blur-sm animate-pulse">
          <WifiOff className="w-3.5 h-3.5" />
          <span>Offline ({pendingSyncCount} pending)</span>
        </div>
      )}
    </>
  );
};

export const SyncStatusPill: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const {
    isOnline,
    isSyncing,
    pendingSyncCount,
    triggerSync,
    simulateOfflineToggle,
    isSimulatedOffline,
  } = useSync();

  return (
    <div className="flex items-center gap-1.5">
      {/* Connectivity badge */}
      <button
        onClick={simulateOfflineToggle}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
          isOnline
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
            : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800'
        }`}
        title={`Click to simulate ${isOnline ? 'Offline' : 'Online'} mode`}
      >
        {isOnline ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <Wifi className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            {!compact && <span className="text-[11px]">Online</span>}
          </>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
            <WifiOff className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            {!compact && <span className="text-[11px]">{isSimulatedOffline ? 'Sim Offline' : 'Offline'}</span>}
          </>
        )}
      </button>

      {/* Pending sync counter & button */}
      {pendingSyncCount > 0 && (
        <button
          onClick={triggerSync}
          disabled={!isOnline || isSyncing}
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 text-xs font-medium cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 transition disabled:opacity-60"
          title={`${pendingSyncCount} sales queued for sync. Click to sync now.`}
        >
          <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
          <span className="text-[11px]">{pendingSyncCount} pending</span>
        </button>
      )}
    </div>
  );
};
