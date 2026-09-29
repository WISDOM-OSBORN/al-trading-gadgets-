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
  ArrowRight,
  Sparkles,
} from 'lucide-react';

export const SellScreen: React.FC = () => {
  const { currentUser, currentShop } = useAuth();

  // Search & Catalog
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Active Sale Form State
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [sellQuantity, setSellQuantity] = useState<number>(1);
  const [sellAmount, setSellAmount] = useState<number>(0);
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
  }, [currentShop]);

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => {
      if (i.category) set.add(i.category);
    });
    return ['All', ...Array.from(set).sort()];
  }, [items]);

  // Filtered items based on search query and category
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.barcode && item.barcode.toLowerCase().includes(q)) ||
        item.brand.toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery, selectedCategory]);

  // Handle selecting an item to sell
  const handleSelectItem = (item: Item) => {
    setSelectedItem(item);
    setSellQuantity(1);
    setSellAmount(item.sellingPrice);
    setErrorMessage(null);
  };

  // Adjust quantity & auto update default amount
  const handleQtyChange = (qty: number) => {
    const validQty = Math.max(1, qty);
    setSellQuantity(validQty);
    if (selectedItem) {
      setSellAmount(Number((validQty * selectedItem.sellingPrice).toFixed(2)));
    }
  };

  // Record Sale: Allocates system invoice #, decrements ledger, records exact time
  const handleRecordSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !currentUser || !currentShop) return;
    if (sellQuantity <= 0) {
      setErrorMessage('Quantity must be at least 1.');
      return;
    }
    if (sellAmount < 0) {
      setErrorMessage('Sale amount cannot be negative.');
      return;
    }

    if (!currentShop.settings.allowNegativeStock && selectedItem.quantity < sellQuantity) {
      setErrorMessage(
        `Insufficient stock for "${selectedItem.name}". Only ${selectedItem.quantity} left in stock.`
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const unitPrice = sellQuantity > 0 ? Number((sellAmount / sellQuantity).toFixed(2)) : selectedItem.sellingPrice;

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
            qty: sellQuantity,
            unitPrice: unitPrice,
            costPriceAtSale: selectedItem.costPrice,
            discount: 0,
            lineTotal: sellAmount,
          },
        ],
        subtotal: sellAmount,
        total: sellAmount,
      });

      const remaining = selectedItem.quantity - sellQuantity;

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
        quantitySold: sellQuantity,
        amount: sellAmount,
        remainingStock: remaining,
      });

      // Reset selection
      setSelectedItem(null);
      setSellQuantity(1);
      setSellAmount(0);

      // Refresh items list to reflect deducted stock
      await loadItems();
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
            placeholder="Search shop items by gadget name, SKU, or brand..."
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

        {/* Category Pills */}
        <div className="flex gap-1.5 overflow-x-auto pt-2 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition cursor-pointer shrink-0 ${
                selectedCategory === cat
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Left Column: Shop Catalog Items (Col 1-7) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Shop Items Catalog ({filteredItems.length})
              </span>
              <span className="text-[11px] text-slate-400">Tap item to sell</span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[500px] overflow-y-auto">
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
                    <div
                      key={item.id}
                      onClick={() => handleSelectItem(item)}
                      className={`py-2.5 px-2 rounded-xl transition cursor-pointer flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/50'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 active:bg-slate-100'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                            {item.name}
                          </p>
                          {isOut ? (
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                              Out of stock
                            </span>
                          ) : isLow ? (
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                              Low ({item.quantity})
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          SKU: {item.sku} &bull; {item.brand} &bull;{' '}
                          <strong className="text-slate-700 dark:text-slate-300">
                            {item.quantity} in stock
                          </strong>
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                          {formatCurrency(item.sellingPrice, currentShop?.currency)}
                        </span>
                        <div
                          className={`px-2.5 py-1 rounded-lg font-bold text-xs transition ${
                            isSelected
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {isSelected ? 'Selected' : 'Select'}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Record Sale Panel (Col 8-12) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm sticky top-16">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 dark:border-slate-800 mb-3">
              <span className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-emerald-500" />
                Record Sale
              </span>
              <span className="text-[11px] text-slate-400">
                Staff: {currentUser?.name.split(' ')[0]}
              </span>
            </div>

            {!selectedItem ? (
              <div className="py-10 text-center text-slate-400 text-xs space-y-2">
                <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                  <Boxes className="w-5 h-5" />
                </div>
                <p className="font-medium text-slate-600 dark:text-slate-300">No Item Selected</p>
                <p className="text-[11px] max-w-xs mx-auto">
                  Tap any item from the shop catalog on the left to enter amount and record the sale.
                </p>
              </div>
            ) : (
              <form onSubmit={handleRecordSale} className="space-y-3.5 text-xs">
                {/* Selected Item Info Box */}
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <p className="font-bold text-sm text-slate-900 dark:text-white">
                    {selectedItem.name}
                  </p>
                  <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                    <span>SKU: {selectedItem.sku}</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      Currently {selectedItem.quantity} in stock
                    </span>
                  </div>
                </div>

                {/* Quantity Sold Stepper */}
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Number of Items Sold:
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                      <button
                        type="button"
                        onClick={() => handleQtyChange(sellQuantity - 1)}
                        className="w-10 h-10 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        min="1"
                        max={currentShop?.settings.allowNegativeStock ? undefined : selectedItem.quantity}
                        value={sellQuantity}
                        onChange={(e) => handleQtyChange(parseInt(e.target.value) || 1)}
                        className="w-14 text-center font-black text-sm bg-transparent border-none text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => handleQtyChange(sellQuantity + 1)}
                        className="w-10 h-10 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    <span className="text-xs text-slate-500">
                      Will leave{' '}
                      <strong className="text-slate-800 dark:text-slate-200">
                        {selectedItem.quantity - sellQuantity}
                      </strong>{' '}
                      in stock
                    </span>
                  </div>
                </div>

                {/* Amount Entered */}
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Total Amount ({currentShop?.currencySymbol || 'GH₵'}) *:
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      required
                      value={sellAmount}
                      onChange={(e) => setSellAmount(parseFloat(e.target.value) || 0)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-black text-base text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Pre-calculated from retail price. You can adjust the exact amount collected.
                  </p>
                </div>

                {errorMessage && (
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Final Record Sale Button */}
                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedItem(null)}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 min-h-[48px] rounded-xl bg-emerald-600 text-white font-bold text-sm shadow-md hover:bg-emerald-700 transition active:scale-98 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>
                      {isSubmitting
                        ? 'Recording...'
                        : `Record Sale (${formatCurrency(sellAmount, currentShop?.currency)})`}
                    </span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Quick Ledger of Recent Sales Today */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" />
              Recent Sales Ledger
            </span>

            {recentSales.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">No sales recorded yet today.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {recentSales.map((sale) => (
                  <div key={sale.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {sale.invoiceNo}
                        </span>
                        <span className="text-[10px] text-slate-500 font-medium">
                          {sale.exactTimeSold || formatTime(sale.createdAtClient)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">
                        {sale.lines.map((l) => `${l.qty}x ${l.name}`).join(', ')}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-bold text-slate-900 dark:text-white">
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
