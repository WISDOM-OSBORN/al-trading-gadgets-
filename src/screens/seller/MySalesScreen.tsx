import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Sale } from '../../types';
import { db } from '../../db';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  Receipt,
  Search,
  CheckCircle2,
  Calendar,
  Boxes,
} from 'lucide-react';

export const MySalesScreen: React.FC = () => {
  const { currentUser, currentShop } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [timeFilter, setTimeFilter] = useState<'today' | 'week'>('today');
  const [searchQuery, setSearchQuery] = useState('');

  const loadSales = async () => {
    if (!currentUser || !currentShop) return;

    const allSales = await db.sales
      .where('shopId')
      .equals(currentShop.id)
      .reverse()
      .toArray();

    // Filter by seller
    const mySales = allSales.filter((s) => s.sellerId === currentUser.uid);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

    const filtered = mySales.filter((s) => {
      if (timeFilter === 'today') return s.createdAtClient >= startOfToday;
      return s.createdAtClient >= startOfWeek;
    });

    setSales(filtered);
  };

  useEffect(() => {
    loadSales();
  }, [currentUser, currentShop, timeFilter]);

  const filteredSales = sales.filter((sale) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      sale.invoiceNo.toLowerCase().includes(q) ||
      (sale.customerName && sale.customerName.toLowerCase().includes(q)) ||
      sale.lines.some((l) => l.name.toLowerCase().includes(q))
    );
  });

  const totalRevenue = sales.reduce(
    (sum, s) => (s.status !== 'voided' ? sum + s.total : sum),
    0
  );
  const totalCompletedCount = sales.filter((s) => s.status !== 'voided').length;

  return (
    <div className="pb-24 pt-1 max-w-4xl mx-auto px-2 sm:px-4 space-y-3">
      {/* Metrics Banner */}
      <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-emerald-100 font-medium">
              {currentUser?.name?.trim().split(' ')[0] || 'My'}'s Sales Total ({timeFilter === 'today' ? 'Today' : 'Past 7 Days'})
            </p>
            <h2 className="text-2xl font-black mt-0.5">
              {formatCurrency(totalRevenue, currentShop?.currency)}
            </h2>
          </div>
          <div className="text-right">
            <span className="text-xs text-emerald-100">Completed Sales</span>
            <p className="text-xl font-bold">{totalCompletedCount}</p>
          </div>
        </div>

        {/* Tab switch: Today vs This Week */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setTimeFilter('today')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              timeFilter === 'today'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'bg-emerald-700/60 text-emerald-100 hover:bg-emerald-700'
            }`}
          >
            Today's Counter Sales
          </button>
          <button
            onClick={() => setTimeFilter('week')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              timeFilter === 'week'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'bg-emerald-700/60 text-emerald-100 hover:bg-emerald-700'
            }`}
          >
            Past 7 Days
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-2.5 sm:p-3 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sales by invoice # or gadget name..."
            className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs sm:text-sm border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
          />
        </div>
      </div>

      {/* Sales Ledger List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Recorded Sales Ledger ({filteredSales.length})
          </span>
          <span className="text-xs text-slate-400">Timestamped records</span>
        </div>

        {filteredSales.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            No sales recorded in this period.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredSales.map((sale) => (
              <div
                key={sale.id}
                className="py-3 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl transition flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                      {sale.invoiceNo}
                    </span>
                    <span className="text-[11px] text-slate-500 font-medium">
                      Time: {sale.exactTimeSold || formatDateTime(sale.createdAtClient)}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate mt-0.5">
                    {sale.lines.map((l) => `${l.qty}x ${l.name}`).join(', ')}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Sold by: {sale.sellerName} &bull; Device: {sale.deviceCode}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-black text-xs sm:text-sm text-slate-900 dark:text-white">
                    {formatCurrency(sale.total, currentShop?.currency)}
                  </p>
                  <span className="text-[10px] text-slate-400">
                    {sale.syncedAt ? 'Synced' : 'Saved offline'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
