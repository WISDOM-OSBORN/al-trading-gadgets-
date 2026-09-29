import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AuditLog } from '../../types';
import { db } from '../../db';
import { formatDateTime } from '../../utils/formatters';
import { History, ArrowLeft, Search, ShieldCheck } from 'lucide-react';

export const AuditLogScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { currentShop } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  useEffect(() => {
    async function fetchLogs() {
      if (!currentShop) return;
      const all = await db.auditLogs
        .where('shopId')
        .equals(currentShop.id)
        .reverse()
        .toArray();
      setLogs(all);
    }
    fetchLogs();
  }, [currentShop]);

  const filteredLogs = logs.filter((log) => {
    if (actionFilter !== 'all' && log.action !== actionFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      log.action.toLowerCase().includes(q) ||
      log.userName.toLowerCase().includes(q) ||
      (log.meta && JSON.stringify(log.meta).toLowerCase().includes(q))
    );
  });

  return (
    <div className="pb-24 pt-1 max-w-4xl mx-auto px-2 sm:px-4 space-y-3">
      {/* Top Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 text-slate-600 dark:text-slate-300"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="font-bold text-base sm:text-lg text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              <span>Immutable Store Audit Ledger</span>
            </h1>
            <p className="text-xs text-slate-500">
              Audit trail of every sale, void, price override, stock adjustment, and import.
            </p>
          </div>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search audit trail by cashier name, SKU, or invoice..."
            className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto text-xs scrollbar-none">
          {['all', 'sale_created', 'sale_voided', 'stock_adjusted', 'inventory_imported', 'day_closed'].map(
            (act) => (
              <button
                key={act}
                onClick={() => setActionFilter(act)}
                className={`px-3 py-1 rounded-full font-medium whitespace-nowrap cursor-pointer ${
                  actionFilter === act
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                {act.replace('_', ' ').toUpperCase()}
              </button>
            )
          )}
        </div>
      </div>

      {/* Audit Logs List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs divide-y divide-slate-100 dark:divide-slate-800">
        {filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No audit logs found for the selected filter.
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="p-3 sm:p-4 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      log.action === 'sale_voided'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                        : log.action === 'sale_created'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : log.action === 'stock_adjusted'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                    }`}
                  >
                    {log.action.replace('_', ' ')}
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {log.userName}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">
                  {formatDateTime(log.createdAt)}
                </span>
              </div>

              {log.meta && (
                <div className="mt-1.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  {Object.entries(log.meta).map(([key, val]) => (
                    <div key={key}>
                      <span className="text-slate-400">{key}:</span> {String(val)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
