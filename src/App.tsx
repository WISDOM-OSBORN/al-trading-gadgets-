/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SyncProvider } from './context/SyncContext';
import { ThemeProvider } from './context/ThemeContext';
import { Header } from './components/common/Header';
import { BottomNav, ScreenId } from './components/common/BottomNav';
import { OfflineBanner } from './components/common/OfflineBanner';
import { Clock } from 'lucide-react';

// Screens
import { SellScreen } from './screens/seller/SellScreen';
import { MySalesScreen } from './screens/seller/MySalesScreen';
import { StockLookupScreen } from './screens/seller/StockLookupScreen';
import { DashboardScreen } from './screens/owner/DashboardScreen';
import { SalesHistoryScreen } from './screens/owner/SalesHistoryScreen';
import { InventoryScreen } from './screens/owner/InventoryScreen';
import { ImportWizardScreen } from './screens/owner/ImportWizardScreen';
import { CustomersScreen } from './screens/owner/CustomersScreen';
import { ReportsScreen } from './screens/owner/ReportsScreen';
import { SettingsScreen } from './screens/owner/SettingsScreen';
import { AuditLogScreen } from './screens/owner/AuditLogScreen';
import { LockScreen } from './screens/auth/LockScreen';
import { LoginScreen } from './screens/auth/LoginScreen';

function MainApp() {
  const { currentUser, currentShop, isLoading, isLocked } = useAuth();
  const [currentScreen, setCurrentScreen] = useState<ScreenId>(() => {
    return currentUser?.role === 'owner' ? 'dashboard' : 'sell';
  });
  const [dismissedClosingDate, setDismissedClosingDate] = useState<string | null>(null);

  // When owner logs in, they land on Dashboard first, not Sell
  const prevUserKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentUser) {
      const userKey = `${currentUser.uid}_${currentUser.role}`;
      if (userKey !== prevUserKeyRef.current) {
        prevUserKeyRef.current = userKey;
        setCurrentScreen(currentUser.role === 'owner' ? 'dashboard' : 'sell');
      }
    } else {
      prevUserKeyRef.current = null;
    }
  }, [currentUser]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-400">Loading AL-Q ELECTRICALS...</p>
        </div>
      </div>
    );
  }

  // Not signed in
  if (!currentUser) {
    return <LoginScreen />;
  }

  // Counter Screen Locked (Idle lock / Manual lock)
  if (isLocked) {
    return <LockScreen />;
  }

  // Enforce Role-Based Access Control (RBAC): Sellers cannot access Owner screens
  const isOwner = currentUser.role === 'owner';
  let activeScreen = currentScreen;
  if (!isOwner && !['sell', 'my-sales', 'stock-lookup'].includes(currentScreen)) {
    activeScreen = 'sell';
  }

  // Check if store closing time has been reached
  const todayStr = new Date().toISOString().slice(0, 10);
  const closingTime = currentShop?.settings?.closingTime || '20:00';
  const [closeHour, closeMinute] = closingTime.split(':').map((v) => parseInt(v, 10) || 0);
  const now = new Date();
  const isPastClosing =
    now.getHours() > closeHour ||
    (now.getHours() === closeHour && now.getMinutes() >= closeMinute);

  const showClosingAlert =
    isOwner &&
    isPastClosing &&
    currentShop?.settings?.autoDispatchReport !== false &&
    dismissedClosingDate !== todayStr;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col antialiased">
      {/* Offline Toast Banner & Indicator */}
      <OfflineBanner />

      {/* End-of-Day Closing Banner Notification */}
      {showClosingAlert && (
        <div className="bg-indigo-600 text-white px-3 py-2 text-xs font-semibold flex items-center justify-between gap-2 shadow-sm animate-in slide-in-from-top">
          <div className="flex items-center gap-2 min-w-0">
            <Clock className="w-4 h-4 shrink-0" />
            <span className="truncate">
              Shop Closing Time reached ({closingTime} GMT)! Review & dispatch today's sales statement.
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setCurrentScreen('reports')}
              className="px-2.5 py-1 rounded-lg bg-white text-indigo-950 text-[11px] font-bold hover:bg-indigo-50 cursor-pointer shadow-xs"
            >
              Dispatch PDF / WhatsApp
            </button>
            <button
              onClick={() => setDismissedClosingDate(todayStr)}
              className="p-1 rounded-lg hover:bg-indigo-700/60 cursor-pointer text-white"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Top Header */}
      <Header onNavigate={(screen) => setCurrentScreen(screen)} />

      {/* Main Content Area */}
      <main className="flex-1 w-full overflow-x-hidden">
        {activeScreen === 'sell' && <SellScreen />}
        {activeScreen === 'my-sales' && <MySalesScreen />}
        {activeScreen === 'stock-lookup' && <StockLookupScreen />}

        {/* Owner-Only Routes */}
        {isOwner && activeScreen === 'dashboard' && (
          <DashboardScreen onNavigate={(screen) => setCurrentScreen(screen)} />
        )}
        {isOwner && activeScreen === 'inventory' && (
          <InventoryScreen onOpenImport={() => setCurrentScreen('import-wizard')} />
        )}
        {isOwner && activeScreen === 'import-wizard' && (
          <ImportWizardScreen onBack={() => setCurrentScreen('inventory')} />
        )}
        {isOwner && activeScreen === 'sales-history' && <SalesHistoryScreen />}
        {isOwner && activeScreen === 'reports' && <ReportsScreen />}
        {isOwner && activeScreen === 'customers' && <CustomersScreen />}
        {isOwner && activeScreen === 'settings' && (
          <SettingsScreen onOpenAuditLog={() => setCurrentScreen('audit-log')} />
        )}
        {isOwner && activeScreen === 'audit-log' && (
          <AuditLogScreen onBack={() => setCurrentScreen('settings')} />
        )}
      </main>

      {/* Bottom Thumb Navigation Bar */}
      <BottomNav
        currentScreen={activeScreen}
        onNavigate={(screen) => setCurrentScreen(screen)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SyncProvider>
          <MainApp />
        </SyncProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
