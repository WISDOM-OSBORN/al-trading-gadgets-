/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SyncProvider } from './context/SyncContext';
import { ThemeProvider } from './context/ThemeContext';
import { Header } from './components/common/Header';
import { BottomNav, ScreenId } from './components/common/BottomNav';
import { OfflineBanner } from './components/common/OfflineBanner';

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
  const { currentUser, isLoading, isLocked } = useAuth();
  const [currentScreen, setCurrentScreen] = useState<ScreenId>('sell');

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-400">Loading ShopLedger...</p>
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col antialiased">
      {/* Offline Toast Banner & Indicator */}
      <OfflineBanner />

      {/* Top Header */}
      <Header />

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
