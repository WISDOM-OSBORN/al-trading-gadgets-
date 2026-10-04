import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSync } from '../../context/SyncContext';
import { Sale, Item, Customer } from '../../types';
import { db } from '../../db';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  DollarSign,
  TrendingUp,
  ShoppingBag,
  Percent,
  AlertTriangle,
  Users,
  CreditCard,
  Boxes,
  ArrowUpRight,
  RefreshCw,
  Plus,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

export const DashboardScreen: React.FC<{ onNavigate?: (screen: any) => void }> = ({
  onNavigate,
}) => {
  const { currentShop } = useAuth();
  const { lastSyncedTime, triggerSync, isSyncing } = useSync();

  const [dateRange, setDateRange] = useState<'today' | '7days' | '30days'>('7days');
  const [sales, setSales] = useState<Sale[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Restock modal state
  const [restockItem, setRestockItem] = useState<Item | null>(null);
  const [restockAmount, setRestockAmount] = useState<number | ''>(10);
  const [isRestocking, setIsRestocking] = useState(false);

  const loadData = async () => {
    if (!currentShop) return;
    const [allSales, allItems, allCust] = await Promise.all([
      db.sales.where('shopId').equals(currentShop.id).toArray(),
      db.items.where('shopId').equals(currentShop.id).toArray(),
      db.customers.where('shopId').equals(currentShop.id).toArray(),
    ]);

    setSales(allSales);
    setItems(allItems.filter((i) => !i.archived));
    setCustomers(allCust);
  };

  useEffect(() => {
    loadData();
  }, [currentShop]);

  // Date filtering
  const filteredSales = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let cutoff = startOfToday;

    if (dateRange === '7days') {
      cutoff = startOfToday - 7 * 24 * 60 * 60 * 1000;
    } else if (dateRange === '30days') {
      cutoff = startOfToday - 30 * 24 * 60 * 60 * 1000;
    }

    return sales.filter((s) => s.status !== 'voided' && s.createdAtClient >= cutoff);
  }, [sales, dateRange]);

  // KPI Calculations
  const totalRevenue = useMemo(() => {
    return filteredSales.reduce((sum, s) => sum + s.total, 0);
  }, [filteredSales]);

  const totalCost = useMemo(() => {
    return filteredSales.reduce((sum, s) => {
      const saleCost = s.lines.reduce((lSum, l) => lSum + l.qty * (l.costPriceAtSale || 0), 0);
      return sum + saleCost;
    }, 0);
  }, [filteredSales]);

  const grossProfit = totalRevenue - totalCost;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const salesCount = filteredSales.length;
  const avgSaleValue = salesCount > 0 ? totalRevenue / salesCount : 0;

  // Inventory value
  const inventoryCostValue = useMemo(() => {
    return items.reduce((sum, i) => sum + Math.max(0, i.quantity) * i.costPrice, 0);
  }, [items]);

  const inventoryRetailValue = useMemo(() => {
    return items.reduce((sum, i) => sum + Math.max(0, i.quantity) * i.sellingPrice, 0);
  }, [items]);

  // Outstanding customer credit
  const outstandingCredit = useMemo(() => {
    return customers.reduce((sum, c) => sum + (c.balanceOwed || 0), 0);
  }, [customers]);

  // Low stock & out of stock items
  const lowStockItems = useMemo(() => {
    return items
      .filter((i) => i.quantity <= i.reorderLevel)
      .sort((a, b) => a.quantity - b.quantity);
  }, [items]);

  // Top selling items
  const topSellingItems = useMemo(() => {
    const itemMap = new Map<string, { name: string; sku: string; qty: number; revenue: number }>();
    filteredSales.forEach((s) => {
      s.lines.forEach((l) => {
        const curr = itemMap.get(l.itemId) || {
          name: l.name,
          sku: l.sku,
          qty: 0,
          revenue: 0,
        };
        curr.qty += l.qty;
        curr.revenue += l.lineTotal;
        itemMap.set(l.itemId, curr);
      });
    });
    return Array.from(itemMap.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [filteredSales]);

  // Sales by payment method
  const salesByPayment = useMemo(() => {
    const map = new Map<string, number>();
    filteredSales.forEach((s) => {
      s.payments.forEach((p) => {
        map.set(p.method, (map.get(p.method) || 0) + p.amount);
      });
    });
    return Array.from(map.entries()).map(([method, amount]) => ({ method, amount }));
  }, [filteredSales]);

  // Sales by seller
  const salesBySeller = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    filteredSales.forEach((s) => {
      const seller = s.sellerName || 'Unknown';
      const curr = map.get(seller) || { count: 0, total: 0 };
      curr.count += 1;
      curr.total += s.total;
      map.set(seller, curr);
    });
    return Array.from(map.entries()).map(([seller, data]) => ({ seller, ...data }));
  }, [filteredSales]);

  // Trend chart data (Daily aggregations)
  const chartData = useMemo(() => {
    const dayMap = new Map<string, { date: string; revenue: number; profit: number }>();
    const days = dateRange === 'today' ? 1 : dateRange === '7days' ? 7 : 30;

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dayMap.set(key, { date: key, revenue: 0, profit: 0 });
    }

    filteredSales.forEach((s) => {
      const key = new Date(s.createdAtClient).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      if (dayMap.has(key)) {
        const item = dayMap.get(key)!;
        item.revenue += s.total;
        const cost = s.lines.reduce((c, l) => c + l.qty * (l.costPriceAtSale || 0), 0);
        item.profit += s.total - cost;
      }
    });

    return Array.from(dayMap.values());
  }, [filteredSales, dateRange]);

  // Handle Restock action directly from dashboard
  const handleRestock = async () => {
    if (!restockItem || !currentShop) return;
    const numRestock = typeof restockAmount === 'number' ? restockAmount : parseInt(restockAmount, 10) || 0;
    if (numRestock <= 0) return;

    try {
      setIsRestocking(true);
      const newQty = restockItem.quantity + numRestock;
      await db.items.update(restockItem.id, {
        quantity: newQty,
        updatedAt: Date.now(),
      });
      await db.stockMovements.add({
        id: `mov-restock-${Date.now()}`,
        shopId: currentShop.id,
        itemId: restockItem.id,
        itemName: restockItem.name,
        itemSku: restockItem.sku,
        type: 'restock',
        qtyChange: numRestock,
        previousQty: restockItem.quantity,
        newQty,
        reason: 'Dashboard Quick Restock',
        userId: 'owner',
        userName: 'Alex Rivera (Owner)',
        createdAt: Date.now(),
      });
      setRestockItem(null);
      await loadData();
    } finally {
      setIsRestocking(false);
    }
  };

  return (
    <div className="pb-24 pt-1 max-w-7xl mx-auto px-2 sm:px-4 space-y-3 sm:space-y-4">
      {/* Top Header: Shop Status & Date Filter */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>Owner Executive Dashboard</span>
          </h1>
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
            <span>Last updated: {lastSyncedTime ? formatDateTime(lastSyncedTime) : 'Just now'}</span>
            <button
              onClick={triggerSync}
              disabled={isSyncing}
              className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline inline-flex items-center gap-0.5 cursor-pointer"
            >
              <RefreshCw className={`w-2.5 h-2.5 ${isSyncing ? 'animate-spin' : ''}`} />
              Sync
            </button>
          </p>
        </div>

        {/* Date Filter Tabs */}
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl self-start sm:self-auto">
          <button
            onClick={() => setDateRange('today')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              dateRange === 'today'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setDateRange('7days')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              dateRange === '7days'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            7 Days
          </button>
          <button
            onClick={() => setDateRange('30days')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              dateRange === '30days'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            30 Days
          </button>
        </div>
      </div>

      {/* KPI Cards Grid (4 Cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {/* Revenue */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Gross Revenue</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <p className="text-lg sm:text-xl font-black text-slate-900 dark:text-white mt-1.5">
            {formatCurrency(totalRevenue, currentShop?.currency)}
          </p>
          <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-0.5 mt-0.5">
            <ArrowUpRight className="w-3 h-3" /> Realized Sales
          </span>
        </div>

        {/* Gross Profit */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Gross Profit</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <p className="text-lg sm:text-xl font-black text-slate-900 dark:text-white mt-1.5">
            {formatCurrency(grossProfit, currentShop?.currency)}
          </p>
          <span className="text-[10px] text-indigo-600 font-semibold mt-0.5 block">
            {grossMargin.toFixed(1)}% gross margin
          </span>
        </div>

        {/* Number of Sales */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Sales Count</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <p className="text-lg sm:text-xl font-black text-slate-900 dark:text-white mt-1.5">
            {salesCount}
          </p>
          <span className="text-[10px] text-slate-500 font-medium mt-0.5 block">
            Completed Invoices
          </span>
        </div>

        {/* Average Sale Value */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Avg Sale Value</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center">
              <Percent className="w-4 h-4" />
            </div>
          </div>
          <p className="text-lg sm:text-xl font-black text-slate-900 dark:text-white mt-1.5">
            {formatCurrency(avgSaleValue, currentShop?.currency)}
          </p>
          <span className="text-[10px] text-slate-500 font-medium mt-0.5 block">
            Per transaction basket
          </span>
        </div>
      </div>

      {/* Sales Trend Chart (One clean chart, Recharts) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3.5 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
              Sales & Gross Profit Trend
            </h2>
            <p className="text-[10px] text-slate-500">Daily business trajectory</p>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Revenue
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> Profit
            </span>
          </div>
        </div>

        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorProf" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#1e293b',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '11px',
                }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="#10b981"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorRev)"
              />
              <Area
                type="monotone"
                dataKey="profit"
                name="Profit"
                stroke="#6366f1"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorProf)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row: Low Stock Alerts & Quick Restock */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Low Stock List (Col 1-7) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" />
              <h3 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                Low & Out of Stock Alerts ({lowStockItems.length})
              </h3>
            </div>
            {onNavigate && (
              <button
                onClick={() => onNavigate('inventory')}
                className="text-[11px] text-indigo-600 font-semibold hover:underline cursor-pointer"
              >
                View all inventory
              </button>
            )}
          </div>

          {lowStockItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              All electrical gadgets are adequately stocked above reorder thresholds!
            </div>
          ) : (
            <div className="space-y-2 max-h-[260px] overflow-y-auto">
              {lowStockItems.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white break-words leading-snug">
                      {item.name}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      SKU: <span className="font-mono">{item.sku}</span> &bull; Reorder trigger: {item.reorderLevel}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                        item.quantity <= 0
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                      }`}
                    >
                      {item.quantity} in stock
                    </span>
                    <button
                      onClick={() => {
                        setRestockItem(item);
                        setRestockAmount(10);
                      }}
                      className="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 transition cursor-pointer flex items-center gap-0.5 shadow-xs"
                      title="Quick Restock"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Restock</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Selling Gadgets (Col 8-12) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white mb-2.5">
            Top-Selling Gadgets
          </h3>
          {topSellingItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No gadget sales recorded for this period yet.
            </div>
          ) : (
            <div className="space-y-2">
              {topSellingItems.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-none"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="font-semibold text-slate-900 dark:text-white break-words leading-tight">
                      {idx + 1}. {item.name}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">SKU: <span className="font-mono">{item.sku}</span></p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-slate-900 dark:text-white">
                      {item.qty} units
                    </p>
                    <p className="text-[10px] text-emerald-600 font-medium">
                      {formatCurrency(item.revenue, currentShop?.currency)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row: Sales Breakdown by Seller & Stock Assets */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Stock Ledger Overview */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center gap-1.5 mb-2 text-slate-500">
            <Boxes className="w-3.5 h-3.5 text-emerald-500" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-500">
              Inventory Ledger
            </span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-slate-600 dark:text-slate-400 font-medium">Gadgets Cataloged</span>
              <span className="font-bold text-slate-900 dark:text-white">{items.length} items</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-600 dark:text-slate-400 font-medium">Total Units in Stock</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {items.reduce((s, i) => s + Math.max(0, i.quantity), 0)} units
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-600 dark:text-slate-400 font-medium">Low Stock Alerts</span>
              <span className="font-bold text-amber-600 dark:text-amber-400">
                {lowStockItems.length} alerts
              </span>
            </div>
          </div>
        </div>

        {/* Sales by Staff / Seller */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center gap-1.5 mb-2 text-slate-500">
            <Users className="w-3.5 h-3.5 text-indigo-500" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-500">
              Sales by Cashier / Manager
            </span>
          </div>
          <div className="space-y-1.5">
            {salesBySeller.map((s, idx) => (
              <div key={idx} className="flex justify-between text-xs py-0.5">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  {s.seller} ({s.count})
                </span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {formatCurrency(s.total, currentShop?.currency)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Inventory Value */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center gap-1.5 mb-1 text-slate-500">
            <DollarSign className="w-3.5 h-3.5 text-purple-500" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-500">
              Shop Stock Valuation
            </span>
          </div>
          <div className="text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Stock at Cost:</span>
              <span className="font-bold text-slate-900 dark:text-white">
                {formatCurrency(inventoryCostValue, currentShop?.currency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Stock at Retail:</span>
              <span className="font-bold text-slate-900 dark:text-white">
                {formatCurrency(inventoryRetailValue, currentShop?.currency)}
              </span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300">
              <span>Potential Margin:</span>
              <span className="font-bold text-emerald-600">
                {formatCurrency(inventoryRetailValue - inventoryCostValue, currentShop?.currency)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Restock Modal */}
      {restockItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Restock Item: {restockItem.name}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Current Stock: <span className="font-bold">{restockItem.quantity}</span> units
            </p>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Units to add to inventory:
              </label>
              <input
                type="number"
                min="0"
                value={restockAmount}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setRestockAmount('');
                  } else {
                    const p = parseInt(val, 10);
                    setRestockAmount(isNaN(p) ? '' : p);
                  }
                }}
                placeholder="0"
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
              />
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setRestockItem(null)}
                className="flex-1 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleRestock}
                disabled={isRestocking}
                className="flex-1 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 transition"
              >
                {isRestocking
                  ? 'Restocking...'
                  : `Add +${typeof restockAmount === 'number' ? restockAmount : parseInt(restockAmount, 10) || 0} Units`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
