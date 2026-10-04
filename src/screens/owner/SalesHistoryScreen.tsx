import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Sale } from '../../types';
import { db } from '../../db';
import { voidSale } from '../../db/sync';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  Receipt,
  Search,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';

export const SalesHistoryScreen: React.FC = () => {
  const { currentShop, currentUser } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'voided'>('all');

  // Void modal state
  const [voidingSale, setVoidingSale] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isSubmittingVoid, setIsSubmittingVoid] = useState(false);

  const loadSales = async () => {
    if (!currentShop) return;
    const all = await db.sales
      .where('shopId')
      .equals(currentShop.id)
      .reverse()
      .toArray();
    setSales(all);
  };

  useEffect(() => {
    loadSales();
  }, [currentShop]);

  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        sale.invoiceNo.toLowerCase().includes(q) ||
        (sale.customerName && sale.customerName.toLowerCase().includes(q)) ||
        sale.lines.some((l) => l.name.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      if (statusFilter !== 'all' && sale.status !== statusFilter) return false;

      return true;
    });
  }, [sales, searchQuery, statusFilter]);

  // Execute Void: Restores items to stock ledger
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

  return (
    <div className="pb-24 pt-1 max-w-7xl mx-auto px-2 sm:px-4 space-y-3">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Receipt className="w-5 h-5 text-indigo-600" />
            <span>Sales & Inventory Deductions Ledger</span>
          </h1>
          <p className="text-xs text-slate-500">
            Historical log of all recorded sales, allocated invoice numbers, timestamps, and stock decrements.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by invoice number (e.g. INV-D01-0001) or gadget name..."
            className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 scrollbar-none text-xs">
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
            Active ({sales.filter((s) => s.status === 'completed').length})
          </button>
          <button
            onClick={() => setStatusFilter('voided')}
            className={`px-3 py-1 rounded-full font-semibold shrink-0 cursor-pointer ${
              statusFilter === 'voided'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
            }`}
          >
            Voided ({sales.filter((s) => s.status === 'voided').length})
          </button>
        </div>
      </div>

      {/* Sales List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs divide-y divide-slate-100 dark:divide-slate-800">
        {filteredSales.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No sales recorded matching your filters.
          </div>
        ) : (
          filteredSales.map((sale) => {
            const isVoided = sale.status === 'voided';

            return (
              <div
                key={sale.id}
                className="p-3 sm:p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-sm text-slate-900 dark:text-white">
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

                  <p className="text-xs text-slate-700 dark:text-slate-200 font-medium break-words mt-1 leading-snug">
                    {sale.lines.map((l) => `${l.qty}x ${l.name}`).join(', ')}
                  </p>

                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Cashier / Staff: {sale.sellerName} &bull; Device: {sale.deviceCode}
                  </p>

                  {isVoided && sale.voidReason && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400 italic mt-1">
                      Void Reason: "{sale.voidReason}" (Stock restored to ledger)
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                  <div className="text-left sm:text-right">
                    <p
                      className={`font-black text-sm sm:text-base ${
                        isVoided
                          ? 'text-slate-400 line-through'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {formatCurrency(sale.total, currentShop?.currency)}
                    </p>
                    <span className="text-[10px] text-slate-400">
                      {sale.syncedAt ? 'Synced' : 'Saved offline'}
                    </span>
                  </div>

                  {!isVoided && currentUser?.role === 'owner' && (
                    <button
                      onClick={() => {
                        setVoidingSale(sale);
                        setVoidReason('');
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 flex items-center gap-1 cursor-pointer"
                      title="Void Sale and Restore Stock to Inventory"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Void & Restock</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Void Sale Modal with Reason Input */}
      {voidingSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 text-rose-600 mb-2">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Void Invoice {voidingSale.invoiceNo}
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Voiding will restore {voidingSale.lines.reduce((s, l) => s + l.qty, 0)} items back to the shop's inventory ledger.
            </p>

            <div className="mt-3">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Reason for Void *
              </label>
              <textarea
                rows={3}
                required
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Sale entered in error / returned by customer"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setVoidingSale(null)}
                className="flex-1 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteVoid}
                disabled={!voidReason.trim() || isSubmittingVoid}
                className="flex-1 py-2 text-xs font-bold rounded-xl bg-rose-600 text-white shadow-sm hover:bg-rose-700 transition disabled:opacity-50"
              >
                {isSubmittingVoid ? 'Voiding...' : 'Confirm Void & Restock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
