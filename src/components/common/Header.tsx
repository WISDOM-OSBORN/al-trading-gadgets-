import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSync } from '../../context/SyncContext';
import { useTheme } from '../../context/ThemeContext';
import { Lock, LogOut, ChevronDown, RefreshCw, Sun, Moon } from 'lucide-react';

export const Header: React.FC = () => {
  const { currentUser, lockScreen, logout, switchUser } = useAuth();
  const { isOnline, isSyncing, pendingSyncCount, triggerSync } = useSync();
  const { isDark, toggleTheme } = useTheme();
  const [showMenu, setShowMenu] = useState(false);

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 px-3 py-2 transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Left: Minimal Brand */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-slate-900 dark:text-white tracking-tight">
            ShopLedger
          </span>
          <span
            className={`w-2 h-2 rounded-full ${
              isOnline ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            title={isOnline ? 'Connected to Cloud Firestore' : 'Offline mode'}
          />
        </div>

        {/* Right: Minimal Sync, Theme Toggle & Account */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Subtle sync trigger if pending */}
          {pendingSyncCount > 0 && (
            <button
              onClick={triggerSync}
              disabled={isSyncing}
              className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1 hover:underline cursor-pointer px-1"
              title="Sync pending records"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{pendingSyncCount}</span>
            </button>
          )}

          {/* 1-Tap Theme Toggle: Crisp Sun / Moon */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle theme"
          >
            {isDark ? (
              <Sun className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-700" />
            )}
          </button>

          {/* User pill */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition cursor-pointer"
            >
              <span className="capitalize">{currentUser?.name?.split(' ')[0] || 'User'}</span>
              <span className="text-[10px] uppercase font-bold text-slate-400">
                ({currentUser?.role})
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {/* Clean Dropdown */}
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 mt-1.5 w-48 rounded-xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-800 p-1.5 z-50 text-xs animate-in fade-in">
                  <div className="px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800 mb-1">
                    <p className="font-semibold text-slate-900 dark:text-white truncate">
                      {currentUser?.name}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">{currentUser?.email}</p>
                  </div>

                  <button
                    onClick={() => {
                      switchUser('user-owner-01');
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                  >
                    Owner View
                  </button>

                  <button
                    onClick={() => {
                      switchUser('user-seller-01');
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                  >
                    Seller View
                  </button>

                  <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

                  {/* Toggle Theme in menu */}
                  <button
                    onClick={() => {
                      toggleTheme();
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-slate-600 dark:text-slate-300"
                  >
                    <span className="flex items-center gap-1.5">
                      {isDark ? <Sun className="w-3 h-3 text-amber-400" /> : <Moon className="w-3 h-3" />}
                      <span>{isDark ? 'Light Theme' : 'Dark Theme'}</span>
                    </span>
                  </button>

                  {/* Lock Screen */}
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      lockScreen();
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
                  >
                    <Lock className="w-3 h-3 text-amber-500" />
                    <span>Lock Screen</span>
                  </button>

                  {/* Logout */}
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      logout();
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-1.5 text-rose-600"
                  >
                    <LogOut className="w-3 h-3" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
