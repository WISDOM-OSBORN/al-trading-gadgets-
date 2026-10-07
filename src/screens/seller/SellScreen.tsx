import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Item, Sale } from '../../types';
import { db } from '../../db';
import { recordSale } from '../../db/sync';
import { formatCurrency, formatTime, formatDateTime } from '../../utils/formatters';
import {
  Search,
  Plus,
  Minus,
  CheckCircle2,
  AlertTriangle,
  History,
  Zap,
  Boxes,
  Sparkles,
  X,
} from 'lucide-react';

export const SellScreen: React.FC = () => {
  const { currentUser, currentShop } = useAuth();

  // Search & Catalog
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Active Sale Form State
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [sellQuantity, setSellQuantity] = useState<number | ''>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Recent Recorded Sale Notification (with system invoice #, time, remaining stock)
  const [lastRecordedSale, setLastRecordedSale] = useState<{
    invoiceNo: string;
    time: string;
    itemName: string;
    quantitySold: number;
    amount: number;
    remainingStock: number;
  } | null>(null);

  // Recent recorded sales today for immediate ledger viewing
  const [recentSales, setRecentSales] = useState<Sale[]>([]);

  // Load items from local Dexie database
  const loadItems = async () => {
    if (!currentShop) return;
    const all = await db.items.where('shopId').equals(currentShop.id).toArray();
    const active = all.filter((i) => !i.archived);
    setItems(active);

    // Also load recent sales
    const sales = await db.sales
      .where('shopId')
      .equals(currentShop.id)
      .reverse()
      .limit(6)
      .toArray();
    setRecentSales(sales);
  };

  useEffect(() => {
    loadItems();
    const handleUpdate = () => {
      loadItems();
    };
    window.addEventListener('shopledger_inventory_updated', handleUpdate);
    return () => {
      window.removeEventListener('shopledger_inventory_updated', handleUpdate);
    };
  }, [currentShop]);

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Filtered items based on search query
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.barcode && item.barcode.toLowerCase().includes(q)) ||
        item.brand.toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery]);

  // Handle selecting an item to sell - pops out the number of items box immediately!
  const handleSelectItem = (item: Item) => {
    if (selectedItem?.id === item.id) {
      // Toggle off if clicked again
      setSelectedItem(null);
      return;
    }
    setSelectedItem(item);
    setSellQuantity(1);
    setErrorMessage(null);
  };

  // Adjust quantity
  const handleQtyChange = (qty: number | '') => {
    if (qty === '') {
      setSellQuantity('');
      return;
    }
    const validQty = Math.max(0, qty);
    setSellQuantity(validQty);
  };

  // Record Sale: Allocates system invoice #, decrements ledger, records exact time in Firestore
  const handleRecordSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !currentUser || !currentShop) return;
    const numQty = typeof sellQuantity === 'number' ? sellQuantity : parseInt(sellQuantity, 10) || 0;
    if (numQty <= 0) {
      setErrorMessage('Quantity must be at least 1.');
      return;
    }

    const calculatedTotal = Number((numQty * selectedItem.sellingPrice).toFixed(2));

    if (!currentShop.settings.allowNegativeStock && selectedItem.quantity < numQty) {
      setErrorMessage(
        `Insufficient stock for "${selectedItem.name}". Only ${selectedItem.quantity} left in stock.`
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const saleRecord = await recordSale({
        shopId: currentShop.id,
        sellerId: currentUser.uid,
        sellerName: currentUser.name,
        deviceCode: currentUser.deviceCode || 'D01',
        invoicePrefix: currentShop.settings.invoicePrefix || 'INV',
        allowNegativeStock: currentShop.settings.allowNegativeStock,
        lines: [
          {
            itemId: selectedItem.id,
            name: selectedItem.name,
            sku: selectedItem.sku,
            qty: numQty,
            unitPrice: selectedItem.sellingPrice,
            costPriceAtSale: selectedItem.costPrice,
            discount: 0,
            lineTotal: calculatedTotal,
          },
        ],
        subtotal: calculatedTotal,
        total: calculatedTotal,
      });

      const remaining = selectedItem.quantity - numQty;

      const timeString = new Date(saleRecord.createdAtClient).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      // Set prominent success confirmation
      setLastRecordedSale({
        invoiceNo: saleRecord.invoiceNo,
        time: timeString,
        itemName: selectedItem.name,
        quantitySold: numQty,
        amount: calculatedTotal,
        remainingStock: remaining,
      });

      // Reset selection and close the popout box
      setSelectedItem(null);
      setSellQuantity(1);

      // Refresh items list to reflect deducted stock
      await loadItems();

      // Refocus search bar for next customer sale
      searchInputRef.current?.focus();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to record sale.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="pb-24 pt-1 max-w-7xl mx-auto px-2 sm:px-4 space-y-3">
      {/* Top Banner: Last Recorded Sale Confirmation */}
      {lastRecordedSale && (
        <div className="bg-emerald-600 text-white rounded-2xl p-3.5 shadow-md flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-sm tracking-wide bg-emerald-700/70 px-2 py-0.5 rounded-md">
                  {lastRecordedSale.invoiceNo}
                </span>
                <span className="text-xs text-emerald-100 font-medium">
                  Sold at {lastRecordedSale.time}
                </span>
              </div>
              <p className="text-xs truncate font-semibold mt-0.5">
                {lastRecordedSale.quantitySold}x {lastRecordedSale.itemName} &bull;{' '}
                {formatCurrency(lastRecordedSale.amount, currentShop?.currency)}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0 bg-emerald-700/60 px-2.5 py-1.5 rounded-xl border border-emerald-500/40">
            <span className="text-[10px] text-emerald-200 block uppercase font-bold tracking-wider">
              Remaining Stock
            </span>
            <span className="font-black text-sm text-white">
              {lastRecordedSale.remainingStock} items left
            </span>
          </div>
        </div>
      )}

      {/* Top Search & Category Filter */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-2.5 sm:p-3 shadow-xs border border-slate-200 dark:border-slate-800">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search items by gadget name, SKU, or brand..."
            className="w-full pl-9 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800/80 rounded-xl text-xs sm:text-sm border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-medium text-slate-900 dark:text-white"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Main Column: Shop Catalog Items & Inline Popout Box (Col 1-7 on desktop, full width on mobile) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Items Catalog ({filteredItems.length})
              </span>
              <span className="text-[11px] text-slate-400">Tap item to sell</span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredItems.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  No electrical gadgets found matching your search.
                </div>
              ) : (
                filteredItems.map((item) => {
                  const isSelected = selectedItem?.id === item.id;
                  const isOut = item.quantity <= 0;
                  const isLow = !isOut && item.quantity <= item.reorderLevel;

                  return (
                    <div key={item.id} className="py-1.5">
                      {/* Item clickable row / box */}
                      <div
                        onClick={() => handleSelectItem(item)}
                        className={`p-3 rounded-2xl transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border ${
                          isSelected
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 shadow-xs'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 active:bg-slate-100'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2 flex-wrap">
                            <p className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white break-words leading-snug">
                              {item.name}
                            </p>
                            {isOut ? (
                              <span className="shrink-0 px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                                Out of stock
                              </span>
                            ) : isLow ? (
                              <span className="shrink-0 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                                Low stock ({item.quantity})
                              </span>
                            ) : null}
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 break-words mt-1">
                            SKU: <span className="font-mono text-slate-700 dark:text-slate-300 font-medium">{item.sku}</span>
                            {item.brand && item.brand.trim() && item.brand.toLowerCase() !== 'generic' && !item.name.toLowerCase().includes(item.brand.toLowerCase()) ? ` • ${item.brand}` : ''}
                            {' '}&bull;{' '}
                            <strong className={isOut ? 'text-rose-600 font-bold' : isLow ? 'text-amber-600 font-bold' : 'text-emerald-600 dark:text-emerald-400 font-bold'}>
                              {item.quantity} in stock
                            </strong>
                          </p>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                          <span className="font-black text-xs sm:text-sm text-slate-900 dark:text-white">
                            {formatCurrency(item.sellingPrice, currentShop?.currency)}
                          </span>
                          <div
                            className={`px-3 py-1 rounded-lg font-bold text-xs transition ${
                              isSelected
                                ? 'bg-emerald-600 text-white shadow-xs'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {isSelected ? '✓ Selling' : 'Select'}
                          </div>
                        </div>
                      </div>

                      {/* POPOUT BOX RIGHT UNDER AFTER SELECTING THE ITEM */}
                      {isSelected && (
                        <div className="mt-2.5 p-3.5 sm:p-4 bg-emerald-50/80 dark:bg-slate-800/95 rounded-2xl border-2 border-emerald-500 shadow-md animate-in fade-in slide-in-from-top-2 duration-150 space-y-3">
                          {/* Full Name Banner in the Popout Box */}
                          <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/60 shadow-2xs">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mb-0.5">
                                  <Zap className="w-3 h-3 fill-current" />
                                  Item To Be Sold
                                </span>
                                <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white break-words leading-snug">
                                  {item.name}
                                </h4>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 break-words">
                                  SKU: <span className="font-mono text-slate-700 dark:text-slate-300 font-semibold">{item.sku}</span>
                                  {item.brand && item.brand.trim() && item.brand.toLowerCase() !== 'generic' && !item.name.toLowerCase().includes(item.brand.toLowerCase()) ? ` • ${item.brand}` : ''}
                                  {' '}• Available: <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{item.quantity} in stock</strong>
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setSelectedItem(null)}
                                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
                                title="Close box"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <form onSubmit={handleRecordSale} className="space-y-3">
                            {/* 1. Number of items going to be sold */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="font-bold text-xs text-slate-800 dark:text-slate-200">
                                  Number of items to sell:
                                </label>
                                <span className="text-[11px] text-slate-500">
                                  Leaves{' '}
                                  <strong className="text-slate-800 dark:text-slate-200">
                                    {item.quantity -
                                      (typeof sellQuantity === 'number'
                                        ? sellQuantity
                                        : parseInt(sellQuantity, 10) || 0)}
                                  </strong>{' '}
                                  in stock
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                {/* Stepper */}
                                <div className="flex items-center border border-slate-300 dark:border-slate-600 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleQtyChange(
                                        ((typeof sellQuantity === 'number'
                                          ? sellQuantity
                                          : parseInt(sellQuantity, 10) || 1) || 1) - 1
                                      )
                                    }
                                    className="w-9 h-9 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 cursor-pointer"
                                  >
                                    <Minus className="w-4 h-4" />
                                  </button>
                                  <input
                                    type="number"
                                    min="0"
                                    max={
                                      currentShop?.settings.allowNegativeStock
                                        ? undefined
                                        : item.quantity
                                    }
                                    value={sellQuantity}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === '') {
                                        handleQtyChange('');
                                      } else {
                                        const p = parseInt(val, 10);
                                        handleQtyChange(isNaN(p) ? '' : p);
                                      }
                                    }}
                                    placeholder="0"
                                    className="w-12 text-center font-black text-sm bg-transparent border-none text-slate-900 dark:text-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleQtyChange(
                                        (typeof sellQuantity === 'number'
                                          ? sellQuantity
                                          : parseInt(sellQuantity, 10) || 0) + 1
                                      )
                                    }
                                    className="w-9 h-9 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 cursor-pointer"
                                  >
                                    <Plus className="w-4 h-4" />
                                  </button>
                                </div>

                                {/* Quick tap quantity buttons */}
                                <div className="flex items-center gap-1">
                                  {[1, 2, 3, 5, 10].map((num) => (
                                    <button
                                      key={num}
                                      type="button"
                                      onClick={() => handleQtyChange(num)}
                                      className={`px-2 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                                        sellQuantity === num
                                          ? 'bg-emerald-600 text-white'
                                          : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                                      }`}
                                    >
                                      {num}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>

                              {/* Price Info Summary (Non-editable) */}
                              <div className="flex items-center justify-between px-1 py-0.5 text-xs text-slate-600 dark:text-slate-300">
                                <span>Unit Price:</span>
                                <span className="font-bold text-slate-900 dark:text-white">
                                  {formatCurrency(item.sellingPrice, currentShop?.currency)} each
                                </span>
                              </div>

                            {errorMessage && (
                              <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 text-xs flex items-center gap-1.5">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <span>{errorMessage}</span>
                              </div>
                            )}

                            {/* Action Buttons: Cancel and Big Record Sale */}
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setSelectedItem(null)}
                                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 cursor-pointer"
                              >
                                Cancel
                              </button>

                              <button
                                type="submit"
                                disabled={isSubmitting}
                                className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 text-white font-bold text-xs sm:text-sm shadow-md hover:bg-emerald-700 transition active:scale-98 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                              >
                                <Sparkles className="w-4 h-4" />
                                <span>
                                  {isSubmitting
                                    ? 'Recording Sale...'
                                    : `Record Sale • ${formatCurrency(
                                        (typeof sellQuantity === 'number'
                                          ? sellQuantity
                                          : parseInt(sellQuantity, 10) || 0) * item.sellingPrice,
                                        currentShop?.currency
                                      )}`}
                                </span>
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Recent Sales Today Ledger */}
        <div className="lg:col-span-5 space-y-3">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                Recent Sales Today
              </span>
              <span className="text-[11px] text-slate-400">
                Staff: {currentUser?.name.split(' ')[0]}
              </span>
            </div>

            {recentSales.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                No sales recorded yet today. Tap any item to record a sale.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {recentSales.map((sale) => (
                  <div key={sale.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-white font-mono">
                          {sale.invoiceNo}
                        </span>
                        <span className="text-[10px] text-slate-500 font-medium">
                          {sale.exactTimeSold || formatTime(sale.createdAtClient)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 dark:text-slate-300 font-medium break-words mt-1">
                        {sale.lines.map((l) => `${l.qty}x ${l.name}`).join(', ')}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm">
                        {formatCurrency(sale.total, currentShop?.currency)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
