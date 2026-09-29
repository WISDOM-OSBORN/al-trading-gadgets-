import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Item } from '../../types';
import { db } from '../../db';
import { formatCurrency } from '../../utils/formatters';
import { Search, Boxes, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

export const StockLookupScreen: React.FC = () => {
  const { currentShop } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');

  useEffect(() => {
    async function fetchItems() {
      if (!currentShop) return;
      const all = await db.items.where('shopId').equals(currentShop.id).toArray();
      setItems(all.filter((i) => !i.archived));
    }
    fetchItems();
  }, [currentShop]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.barcode && item.barcode.toLowerCase().includes(q)) ||
        item.brand.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (stockFilter === 'out') return item.quantity <= 0;
      if (stockFilter === 'low') return item.quantity > 0 && item.quantity <= item.reorderLevel;
      return true;
    });
  }, [items, searchQuery, stockFilter]);

  return (
    <div className="pb-24 pt-1 max-w-4xl mx-auto px-2 sm:px-4">
      {/* Top Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs mb-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Boxes className="w-5 h-5 text-emerald-600" />
          <span>Stock Level Lookup</span>
          <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
            Read-Only
          </span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Quickly check gadget quantities, selling prices, and reorder levels.
        </p>

        {/* Search */}
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by gadget name, SKU, brand, or barcode..."
            className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
          />
        </div>

        {/* Filter Badges */}
        <div className="flex gap-2 mt-2.5">
          <button
            onClick={() => setStockFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition cursor-pointer ${
              stockFilter === 'all'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            All Items ({items.length})
          </button>
          <button
            onClick={() => setStockFilter('low')}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition cursor-pointer ${
              stockFilter === 'low'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
            }`}
          >
            Low Stock ({items.filter((i) => i.quantity > 0 && i.quantity <= i.reorderLevel).length})
          </button>
          <button
            onClick={() => setStockFilter('out')}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition cursor-pointer ${
              stockFilter === 'out'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
            }`}
          >
            Out of Stock ({items.filter((i) => i.quantity <= 0).length})
          </button>
        </div>
      </div>

      {/* Stock Cards / List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              No electrical gadgets match your query.
            </div>
          ) : (
            filtered.map((item) => {
              const isOut = item.quantity <= 0;
              const isLow = !isOut && item.quantity <= item.reorderLevel;

              return (
                <div key={item.id} className="py-3 px-2 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                      {item.name}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      SKU: <span className="font-mono text-slate-700 dark:text-slate-300">{item.sku}</span> &bull; {item.category}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Retail: {formatCurrency(item.sellingPrice, currentShop?.currency)} &bull; Reorder trigger: {item.reorderLevel} units
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="flex items-center justify-end gap-1.5">
                      {isOut ? (
                        <span className="px-2 py-1 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5" />
                          0 In Stock
                        </span>
                      ) : isLow ? (
                        <span className="px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-xs font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {item.quantity} In Stock
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 text-xs font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {item.quantity} In Stock
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
