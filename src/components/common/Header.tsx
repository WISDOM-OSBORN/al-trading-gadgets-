import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSync } from '../../context/SyncContext';
import { useTheme } from '../../context/ThemeContext';
import { db } from '../../db';
import { User } from '../../types';
import { ScreenId } from './BottomNav';
import { Lock, LogOut, ChevronDown, RefreshCw, Sun, Moon, Users, Check } from 'lucide-react';

interface HeaderProps {
  onNavigate?: (screen: ScreenId) => void;
}

export const Header: React.FC<HeaderProps> = ({ onNavigate }) => {
  const { currentUser, currentShop, lockScreen, logout, switchUser } = useAuth();
  const { isOnline, isSyncing, triggerSync } = useSync();
  const { isDark, toggleTheme } = useTheme();
  const [showMenu, setShowMenu] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const isOwner = currentUser?.role === 'owner';

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const users = await db.users.toArray();
        const activeUsers = users.filter((u) => u.active !== false);
        setAllUsers(activeUsers);
      } catch {}
    };
    loadUsers();
    window.addEventListener('shopledger_users_updated', loadUsers);
    return () => window.removeEventListener('shopledger_users_updated', loadUsers);
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 px-3 py-2 transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Left: Minimal Brand */}
        <div
          onClick={() => onNavigate?.(isOwner ? 'dashboard' : 'sell')}
          className="flex items-center gap-2 cursor-pointer select-none group"
          title={isOwner ? 'Go to Owner Dashboard' : 'Go to Sell Screen'}
        >
          <span className="font-black text-sm text-slate-900 dark:text-white tracking-tight group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
            {currentShop?.name || 'AL-Q ELECTRICALS'}
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
          {/* Top Cloud Sync Status & Manual Trigger - Pure Moving Icon without Box or Bar */}
          <button
            onClick={triggerSync}
            disabled={isSyncing}
            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition cursor-pointer flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            title={isSyncing ? 'Syncing with cloud...' : 'Sync (Tap to refresh)'}
            aria-label="Cloud sync"
          >
            <RefreshCw className={`w-4 h-4 transition-transform duration-700 ${isSyncing ? 'animate-spin text-emerald-500' : ''}`} />
          </button>

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

          {/* User pill: show ONLY the user's first name, not the word 'seller' */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 transition cursor-pointer shadow-2xs"
            >
              <span className="capitalize">
                {currentUser?.name?.trim().split(' ')[0] || 'User'}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {/* Clean Dropdown */}
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 mt-1.5 w-64 rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-800 p-2 z-50 text-xs animate-in fade-in">
                  {/* Active Logged In Account Details */}
                  <div className="p-2.5 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-xl mb-1.5 border border-emerald-100 dark:border-emerald-900/60">
                    <div className="flex items-center justify-between gap-1.5">
                      <p className="font-bold text-xs text-slate-900 dark:text-white truncate">
                        {currentUser?.name}
                      </p>
                      <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-200/80 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300 shrink-0">
                        {currentUser?.role === 'owner' ? 'Owner' : 'Staff'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate mt-0.5">
                      {currentUser?.email}
                    </p>
                    {currentUser?.deviceCode && (
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
                        Terminal: {currentUser.deviceCode} (Active)
                      </p>
                    )}
                  </div>

                  {/* All Shop Accounts & Staff - visible on any logged in account */}
                  {allUsers.length > 1 && (
                    <div className="mb-2">
                      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          <span>All Shop Accounts</span>
                        </span>
                        <span className="text-[9px] font-mono">{allUsers.length}</span>
                      </div>
                      <div className="max-h-36 overflow-y-auto space-y-1 pr-0.5">
                        {allUsers.map((u) => {
                          const isCurrent = u.uid === currentUser?.uid;
                          return (
                            <div
                              key={u.uid}
                              onClick={() => {
                                if (!isCurrent) {
                                  switchUser(u.uid);
                                  setShowMenu(false);
                                }
                              }}
                              className={`p-1.5 rounded-lg flex items-center justify-between transition cursor-pointer text-[11px] ${
                                isCurrent
                                  ? 'bg-slate-100 dark:bg-slate-800 font-semibold text-slate-900 dark:text-white'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-300'
                              }`}
                              title={isCurrent ? 'Currently active account' : `Switch to ${u.name}`}
                            >
                              <div className="min-w-0 pr-1">
                                <p className="truncate font-medium">{u.name}</p>
                                <p className="text-[10px] text-slate-400 truncate">{u.email}</p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                  {u.role === 'owner' ? 'Owner' : u.deviceCode || 'Staff'}
                                </span>
                                {isCurrent && <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Toggle Theme in menu */}
                  <button
                    onClick={() => {
                      toggleTheme();
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-slate-700 dark:text-slate-300 font-medium cursor-pointer transition"
                  >
                    <span className="flex items-center gap-2">
                      {isDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />}
                      <span>{isDark ? 'Light Theme' : 'Dark Theme'}</span>
                    </span>
                  </button>

                  {/* Lock Screen */}
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      lockScreen();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium cursor-pointer transition"
                  >
                    <Lock className="w-3.5 h-3.5 text-amber-500" />
                    <span>Lock Screen</span>
                  </button>

                  <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

                  {/* Logout */}
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      logout();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2 text-rose-600 dark:text-rose-400 font-semibold cursor-pointer transition"
                  >
                    <LogOut className="w-3.5 h-3.5" />
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
