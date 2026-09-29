import React from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  ShoppingCart,
  Receipt,
  Boxes,
  LayoutDashboard,
  FileSpreadsheet,
  Settings,
  Users,
  History,
} from 'lucide-react';

export type ScreenId =
  | 'sell'
  | 'my-sales'
  | 'stock-lookup'
  | 'dashboard'
  | 'sales-history'
  | 'inventory'
  | 'import-wizard'
  | 'customers'
  | 'reports'
  | 'settings'
  | 'audit-log';

interface BottomNavProps {
  currentScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  cartCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentScreen,
  onNavigate,
  cartCount = 0,
}) => {
  const { currentUser } = useAuth();
  const isOwner = currentUser?.role === 'owner';

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-900/95 border-t border-slate-200 dark:border-slate-800 backdrop-blur-md safe-area-bottom shadow-lg">
      <div className="max-w-md md:max-w-4xl mx-auto flex items-stretch justify-around px-1 py-1">
        {isOwner ? (
          // Owner Navigation (5 items)
          <>
            <button
              onClick={() => onNavigate('dashboard')}
              className={`flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition active:scale-95 cursor-pointer ${
                currentScreen === 'dashboard'
                  ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <LayoutDashboard className="w-5 h-5" />
              <span className="text-[10px] tracking-tight">Dashboard</span>
            </button>

            <button
              onClick={() => onNavigate('sell')}
              className={`flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition active:scale-95 cursor-pointer relative ${
                currentScreen === 'sell'
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <ShoppingCart className="w-5 h-5" />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-2 w-4 h-4 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] tracking-tight">Sell</span>
            </button>

            <button
              onClick={() => onNavigate('inventory')}
              className={`flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition active:scale-95 cursor-pointer ${
                currentScreen === 'inventory' || currentScreen === 'import-wizard'
                  ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Boxes className="w-5 h-5" />
              <span className="text-[10px] tracking-tight">Inventory</span>
            </button>

            <button
              onClick={() => onNavigate('sales-history')}
              className={`flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition active:scale-95 cursor-pointer ${
                currentScreen === 'sales-history'
                  ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Receipt className="w-5 h-5" />
              <span className="text-[10px] tracking-tight">Sales</span>
            </button>

            <button
              onClick={() => onNavigate('reports')}
              className={`flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition active:scale-95 cursor-pointer ${
                currentScreen === 'reports' || currentScreen === 'customers' || currentScreen === 'audit-log'
                  ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <FileSpreadsheet className="w-5 h-5" />
              <span className="text-[10px] tracking-tight">Reports</span>
            </button>

            <button
              onClick={() => onNavigate('settings')}
              className={`flex-1 min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition active:scale-95 cursor-pointer ${
                currentScreen === 'settings'
                  ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Settings className="w-5 h-5" />
              <span className="text-[10px] tracking-tight">Settings</span>
            </button>
          </>
        ) : (
          // Seller Navigation (Strict 3 Tabs as defined in PRD Section 13)
          <>
            <button
              onClick={() => onNavigate('sell')}
              className={`flex-1 min-h-[50px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition active:scale-95 cursor-pointer relative ${
                currentScreen === 'sell'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <div className="relative">
                <ShoppingCart className="w-5 h-5" />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-2 w-4 h-4 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </div>
              <span className="text-xs tracking-tight">Sell Counter</span>
            </button>

            <button
              onClick={() => onNavigate('my-sales')}
              className={`flex-1 min-h-[50px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition active:scale-95 cursor-pointer ${
                currentScreen === 'my-sales'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <Receipt className="w-5 h-5" />
              <span className="text-xs tracking-tight">My Sales</span>
            </button>

            <button
              onClick={() => onNavigate('stock-lookup')}
              className={`flex-1 min-h-[50px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition active:scale-95 cursor-pointer ${
                currentScreen === 'stock-lookup'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <Boxes className="w-5 h-5" />
              <span className="text-xs tracking-tight">Stock Lookup</span>
            </button>
          </>
        )}
      </div>
    </nav>
  );
};
