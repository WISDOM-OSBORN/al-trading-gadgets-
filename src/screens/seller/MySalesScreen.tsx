import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Sale } from '../../types';
import { db } from '../../db';
import { voidSale } from '../../db/sync';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  Receipt,
  Search,
  CheckCircle2,
  Calendar,
  Boxes,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';

export const MySalesScreen: React.FC = () => {
  const { currentUser, currentShop } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [timeFilter, setTimeFilter] = useState<'today' | 'week'>('today');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'voided'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Void modal state
  const [voidingSale, setVoidingSale] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isSubmittingVoid, setIsSubmittingVoid] = useState(false);

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
    const handleUpdate = () => {
      loadSales();
    };
    window.addEventListener('shopledger_sales_updated', handleUpdate);
    window.addEventListener('shopledger_inventory_updated', handleUpdate);
    return () => {
      window.removeEventListener('shopledger_sales_updated', handleUpdate);
      window.removeEventListener('shopledger_inventory_updated', handleUpdate);
    };
  }, [currentUser, currentShop, timeFilter]);

  // Execute Void Sale from seller side
  const handleExecuteVoid = async () => {
    if (!voidingSale || !voidReason.trim() || !currentUser) return;
    try {
      setIsSubmittingVoid(true);
      await voidSale(voidingSale.id, voidReason.trim(), currentUser.uid, currentUser.name);
      setVoidingSale(null);
      setVoidReason('');
      await loadSales();
    } catch (err: any) {
      alert(`Failed to void sale: ${err.message}`);
    } finally {
      setIsSubmittingVoid(false);
    }
  };

  const filteredSales = sales.filter((sale) => {
    if (statusFilter === 'completed' && sale.status === 'voided') return false;
    if (statusFilter === 'voided' && sale.status !== 'voided') return false;

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
  const voidedCount = sales.filter((s) => s.status === 'voided').length;

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
            {voidedCount > 0 && (
              <span className="text-[10px] text-rose-200 block font-semibold">
                {voidedCount} voided ({voidedCount} restocked)
              </span>
            )}
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

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-2.5 sm:p-3 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
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

        {/* Status Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 text-xs">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 rounded-full font-semibold shrink-0 cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            All Sales ({sales.length})
          </button>
          <button
            onClick={() => setStatusFilter('completed')}
            className={`px-3 py-1 rounded-full font-semibold shrink-0 cursor-pointer ${
              statusFilter === 'completed'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
            }`}
          >
            Active ({totalCompletedCount})
          </button>
          <button
            onClick={() => setStatusFilter('voided')}
            className={`px-3 py-1 rounded-full font-semibold shrink-0 cursor-pointer ${
              statusFilter === 'voided'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
            }`}
          >
            Voided ({voidedCount})
          </button>
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
            No sales recorded matching your filters.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredSales.map((sale) => {
              const isVoided = sale.status === 'voided';

              return (
                <div
                  key={sale.id}
                  className="py-3 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                        {sale.invoiceNo}
                      </span>
                      <span className="text-[11px] text-slate-500 font-medium">
                        Time: {sale.exactTimeSold || formatDateTime(sale.createdAtClient)}
                      </span>
                      {isVoided ? (
                        <span className="px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                          VOIDED
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Recorded
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200 break-words mt-1 leading-snug">
                      {sale.lines.map((l) => `${l.qty}x ${l.name}`).join(', ')}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Sold by: {sale.sellerName} &bull; Device: {sale.deviceCode}
                    </p>
                    {isVoided && sale.voidReason && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 italic mt-1 font-medium">
                        Void Reason: "{sale.voidReason}" (Stock restored to ledger)
                        {sale.voidedBy ? ` • Voided by: ${sale.voidedBy}` : ''}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                    <div className="text-left sm:text-right">
                      <p
                        className={`font-black text-xs sm:text-sm ${
                          isVoided ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {formatCurrency(sale.total, currentShop?.currency)}
                      </p>
                      <span className="text-[10px] text-slate-400">
                        {sale.syncedAt ? 'Synced' : 'Saved offline'}
                      </span>
                    </div>

                    {!isVoided && (
                      <button
                        type="button"
                        onClick={() => {
                          setVoidingSale(sale);
                          setVoidReason('');
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 flex items-center gap-1 cursor-pointer"
                        title="Void sale and return stock"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Void</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Void Sale Modal for Seller */}
      {voidingSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 text-rose-600 mb-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Void Invoice {voidingSale.invoiceNo}
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
              Voiding this sale will restore{' '}
              <strong className="text-slate-900 dark:text-white">
                {voidingSale.lines.reduce((s, l) => s + l.qty, 0)} item(s)
              </strong>{' '}
              back into the shop inventory ledger. Both seller and owner screens will reflect this immediately.
            </p>

            <div className="mb-3 space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                Common reasons:
              </span>
              <div className="flex flex-wrap gap-1">
                {['Customer returned item', 'Wrong item/qty entered', 'Transaction cancelled'].map(
                  (chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setVoidReason(chip)}
                      className={`text-[10px] px-2 py-0.5 rounded-md border cursor-pointer transition ${
                        voidReason === chip
                          ? 'bg-rose-600 text-white border-rose-600 font-semibold'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {chip}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="space-y-1.5 mb-4">
              <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Reason for Voiding:
              </label>
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Why is this sale being voided?"
                rows={2}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setVoidingSale(null);
                  setVoidReason('');
                }}
                disabled={isSubmittingVoid}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteVoid}
                disabled={isSubmittingVoid || !voidReason.trim()}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer transition flex items-center gap-1.5 shadow-sm"
              >
                {isSubmittingVoid ? 'Restoring Stock...' : 'Confirm Void & Restock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
