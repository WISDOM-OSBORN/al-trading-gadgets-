import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Item, StockMovementType } from '../../types';
import { db } from '../../db';
import { adjustStock } from '../../db/sync';
import { exportInventoryToCSV, downloadCSV } from '../../utils/csv';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  Boxes,
  Search,
  Plus,
  Edit2,
  Archive,
  Download,
  UploadCloud,
  Filter,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  SlidersHorizontal,
  X,
} from 'lucide-react';

interface InventoryScreenProps {
  onOpenImport: () => void;
}

export const InventoryScreen: React.FC<InventoryScreenProps> = ({ onOpenImport }) => {
  const { currentShop, currentUser } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'low' | 'out'>('all');

  // Edit / Add Modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<Item> | null>(null);

  // Stock Adjustment Modal
  const [adjustingItem, setAdjustingItem] = useState<Item | null>(null);
  const [adjustQtyChange, setAdjustQtyChange] = useState<number>(0);
  const [adjustReasonType, setAdjustReasonType] = useState<StockMovementType>('restock');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [isSubmittingAdjust, setIsSubmittingAdjust] = useState(false);

  const loadItems = async () => {
    if (!currentShop) return;
    const all = await db.items.where('shopId').equals(currentShop.id).toArray();
    setItems(all);
  };

  useEffect(() => {
    loadItems();
  }, [currentShop]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => {
      if (i.category) set.add(i.category);
    });
    return ['All', ...Array.from(set).sort()];
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return items.filter((item) => {
      if (item.archived) return false;
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.barcode && item.barcode.toLowerCase().includes(q)) ||
        item.brand.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (categoryFilter !== 'All' && item.category !== categoryFilter) return false;

      if (stockFilter === 'out') return item.quantity <= 0;
      if (stockFilter === 'low') return item.quantity > 0 && item.quantity <= item.reorderLevel;
      if (stockFilter === 'in') return item.quantity > item.reorderLevel;

      return true;
    });
  }, [items, searchQuery, categoryFilter, stockFilter]);

  // Handle Save / Add Item
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentShop || !editingItem || !editingItem.name || !editingItem.sellingPrice) return;

    const now = Date.now();
    const sku =
      editingItem.sku?.trim().toUpperCase() ||
      `${editingItem.name.slice(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

    if (editingItem.id) {
      // Update
      await db.items.update(editingItem.id, {
        name: editingItem.name.trim(),
        sku,
        barcode: editingItem.barcode?.trim() || undefined,
        category: editingItem.category || 'General Electrical',
        brand: editingItem.brand || 'Generic',
        costPrice: Number(editingItem.costPrice) || 0,
        sellingPrice: Number(editingItem.sellingPrice) || 0,
        quantity: Number(editingItem.quantity) || 0,
        reorderLevel: Number(editingItem.reorderLevel) || 5,
        supplier: editingItem.supplier?.trim() || undefined,
        description: editingItem.description?.trim() || undefined,
        isFavorite: !!editingItem.isFavorite,
        updatedAt: now,
      });

      await db.auditLogs.add({
        id: `audit-${Date.now()}`,
        shopId: currentShop.id,
        action: 'item_updated',
        entity: 'items',
        entityId: editingItem.id,
        userId: currentUser?.uid || 'owner',
        userName: currentUser?.name || 'Owner',
        meta: { sku, name: editingItem.name },
        createdAt: now,
      });
    } else {
      // Create new
      const newItemId = `item-${Date.now()}`;
      const newItem: Item = {
        id: newItemId,
        shopId: currentShop.id,
        name: editingItem.name.trim(),
        sku,
        barcode: editingItem.barcode?.trim() || undefined,
        category: editingItem.category || 'General Electrical',
        brand: editingItem.brand || 'Generic',
        costPrice: Number(editingItem.costPrice) || 0,
        sellingPrice: Number(editingItem.sellingPrice) || 0,
        quantity: Number(editingItem.quantity) || 0,
        reorderLevel: Number(editingItem.reorderLevel) || 5,
        supplier: editingItem.supplier?.trim() || undefined,
        description: editingItem.description?.trim() || undefined,
        archived: false,
        isFavorite: !!editingItem.isFavorite,
        createdAt: now,
        updatedAt: now,
      };

      await db.items.add(newItem);

      await db.stockMovements.add({
        id: `mov-new-${Date.now()}`,
        shopId: currentShop.id,
        itemId: newItemId,
        itemName: newItem.name,
        itemSku: newItem.sku,
        type: 'import',
        qtyChange: newItem.quantity,
        previousQty: 0,
        newQty: newItem.quantity,
        reason: 'Initial item creation',
        userId: currentUser?.uid || 'owner',
        userName: currentUser?.name || 'Owner',
        createdAt: now,
      });

      await db.auditLogs.add({
        id: `audit-${Date.now()}`,
        shopId: currentShop.id,
        action: 'item_created',
        entity: 'items',
        entityId: newItemId,
        userId: currentUser?.uid || 'owner',
        userName: currentUser?.name || 'Owner',
        meta: { sku, name: newItem.name },
        createdAt: now,
      });
    }

    setIsEditModalOpen(false);
    setEditingItem(null);
    await loadItems();
  };

  // Handle Archive (soft delete)
  const handleArchive = async (item: Item) => {
    if (!currentShop) return;
    if (confirm(`Archive "${item.name}"? It will no longer appear on counter sell screens.`)) {
      await db.items.update(item.id, { archived: true, updatedAt: Date.now() });
      await db.auditLogs.add({
        id: `audit-${Date.now()}`,
        shopId: currentShop.id,
        action: 'item_archived',
        entity: 'items',
        entityId: item.id,
        userId: currentUser?.uid || 'owner',
        userName: currentUser?.name || 'Owner',
        meta: { sku: item.sku, name: item.name },
        createdAt: Date.now(),
      });
      await loadItems();
    }
  };

  // Handle Stock Adjustment Submit
  const handleExecuteAdjustment = async () => {
    if (!adjustingItem || !currentShop || !currentUser) return;
    if (adjustQtyChange === 0) return;

    try {
      setIsSubmittingAdjust(true);
      await adjustStock({
        shopId: currentShop.id,
        itemId: adjustingItem.id,
        qtyChange: adjustQtyChange,
        reasonType: adjustReasonType as any,
        notes: adjustNotes || adjustReasonType,
        userId: currentUser.uid,
        userName: currentUser.name,
      });

      setAdjustingItem(null);
      setAdjustQtyChange(0);
      setAdjustNotes('');
      await loadItems();
    } finally {
      setIsSubmittingAdjust(false);
    }
  };

  // Export inventory to CSV
  const handleExportCSV = async () => {
    if (!currentShop) return;
    const csv = await exportInventoryToCSV(currentShop.id);
    downloadCSV(csv, `shopledger-inventory-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="pb-24 pt-1 max-w-7xl mx-auto px-2 sm:px-4 space-y-3">
      {/* Top Action Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Boxes className="w-5 h-5 text-indigo-600" />
            <span>Inventory Master Catalog</span>
          </h1>
          <p className="text-xs text-slate-500">
            {items.filter((i) => !i.archived).length} total electrical gadgets in stock
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenImport}
            className="flex-1 sm:flex-initial min-h-[42px] px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <UploadCloud className="w-4 h-4 text-indigo-500" />
            <span>Import CSV</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="flex-1 sm:flex-initial min-h-[42px] px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-500" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => {
              setEditingItem({
                name: '',
                category: 'Chargers & Adapters',
                brand: '',
                costPrice: 0,
                sellingPrice: 0,
                quantity: 10,
                reorderLevel: 5,
              });
              setIsEditModalOpen(true);
            }}
            className="flex-1 sm:flex-initial min-h-[42px] px-4 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Add Gadget</span>
          </button>
        </div>
      </div>

      {/* Search & Category Filter Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search items by SKU, gadget name, brand, or barcode..."
            className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
          />
        </div>

        {/* Stock status filter + category scroll */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 scrollbar-none">
          <button
            onClick={() => setStockFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-semibold shrink-0 cursor-pointer ${
              stockFilter === 'all'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            All Stock
          </button>
          <button
            onClick={() => setStockFilter('low')}
            className={`px-3 py-1 rounded-full text-xs font-semibold shrink-0 cursor-pointer ${
              stockFilter === 'low'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
            }`}
          >
            Low Stock Alerts
          </button>
          <button
            onClick={() => setStockFilter('out')}
            className={`px-3 py-1 rounded-full text-xs font-semibold shrink-0 cursor-pointer ${
              stockFilter === 'out'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
            }`}
          >
            Out of Stock
          </button>

          <span className="w-px h-4 bg-slate-300 dark:bg-slate-700 mx-1 shrink-0" />

          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium shrink-0 cursor-pointer ${
                categoryFilter === c
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Items Table / Cards */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-3.5 py-3">Gadget & SKU</th>
                <th className="px-3.5 py-3">Category</th>
                <th className="px-3.5 py-3 text-right">Cost Price</th>
                <th className="px-3.5 py-3 text-right">Selling Price</th>
                <th className="px-3.5 py-3 text-center">Stock</th>
                <th className="px-3.5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    No gadgets found matching the current filters.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isOut = item.quantity <= 0;
                  const isLow = !isOut && item.quantity <= item.reorderLevel;

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition"
                    >
                      <td className="px-3.5 py-3 max-w-[200px]">
                        <p className="font-semibold text-slate-900 dark:text-white truncate">
                          {item.name}
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          {item.sku} {item.brand && `\u2022 ${item.brand}`}
                        </p>
                      </td>
                      <td className="px-3.5 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {item.category}
                      </td>
                      <td className="px-3.5 py-3 text-right font-medium text-slate-500">
                        {formatCurrency(item.costPrice, currentShop?.currency)}
                      </td>
                      <td className="px-3.5 py-3 text-right font-bold text-slate-900 dark:text-white">
                        {formatCurrency(item.sellingPrice, currentShop?.currency)}
                      </td>
                      <td className="px-3.5 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            isOut
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                              : isLow
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                        >
                          {item.quantity} in stock
                        </span>
                      </td>
                      <td className="px-3.5 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Stock Adjustment Trigger */}
                          <button
                            onClick={() => {
                              setAdjustingItem(item);
                              setAdjustQtyChange(0);
                              setAdjustReasonType('restock');
                              setAdjustNotes('');
                            }}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
                            title="Stock Movement Adjustment"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
                          </button>

                          {/* Edit Item */}
                          <button
                            onClick={() => {
                              setEditingItem({ ...item });
                              setIsEditModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
                            title="Edit Product Details"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-blue-500" />
                          </button>

                          {/* Archive Item */}
                          <button
                            onClick={() => handleArchive(item)}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition"
                            title="Archive Item"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Product Modal */}
      {isEditModalOpen && editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-lg my-auto rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h2 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                {editingItem.id ? 'Edit Gadget Details' : 'Add New Gadget to Shop'}
              </h2>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  value={editingItem.name || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                  placeholder="e.g. Anker 20W USB-C Nano PowerPort"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    SKU (Optional, auto-generated)
                  </label>
                  <input
                    type="text"
                    value={editingItem.sku || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, sku: e.target.value })}
                    placeholder="CHG-20W-ANK"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Barcode (EAN/UPC)
                  </label>
                  <input
                    type="text"
                    value={editingItem.barcode || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, barcode: e.target.value })}
                    placeholder="848061023451"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    value={editingItem.category || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                    placeholder="Chargers & Adapters"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Brand
                  </label>
                  <input
                    type="text"
                    value={editingItem.brand || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, brand: e.target.value })}
                    placeholder="Anker, Baseus, Oraimo..."
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Cost Price ({currentShop?.currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editingItem.costPrice ?? ''}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, costPrice: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Selling Price * ({currentShop?.currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={editingItem.sellingPrice ?? ''}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        sellingPrice: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Initial / In Stock Qty
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editingItem.quantity ?? ''}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, quantity: parseInt(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Reorder Alert Level
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editingItem.reorderLevel ?? 5}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        reorderLevel: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="fav-check"
                  checked={!!editingItem.isFavorite}
                  onChange={(e) => setEditingItem({ ...editingItem, isFavorite: e.target.checked })}
                  className="rounded text-indigo-600"
                />
                <label htmlFor="fav-check" className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                  Pin to Counter Quick Tap Favourites (12 most popular items)
                </label>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition"
                >
                  Save Gadget
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Stock Adjustment: {adjustingItem.name}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Current in stock: <span className="font-bold text-slate-800 dark:text-slate-200">{adjustingItem.quantity}</span> units
            </p>

            <div className="mt-3 space-y-2.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Reason for Adjustment *
                </label>
                <select
                  value={adjustReasonType}
                  onChange={(e) => setAdjustReasonType(e.target.value as StockMovementType)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                >
                  <option value="restock">Restock / New Shipment (+)</option>
                  <option value="adjustment">Stock Count Correction (+ / -)</option>
                  <option value="damage">Damaged / Defective Stock (-)</option>
                  <option value="theft">Lost or Theft (-)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Quantity Change (+ to add, - to reduce)
                </label>
                <input
                  type="number"
                  value={adjustQtyChange || ''}
                  onChange={(e) => setAdjustQtyChange(parseInt(e.target.value) || 0)}
                  placeholder="e.g. +15 or -2"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  New stock will become:{' '}
                  <span className="font-bold text-indigo-600">
                    {adjustingItem.quantity + adjustQtyChange} units
                  </span>
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Audit Notes
                </label>
                <input
                  type="text"
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  placeholder="e.g. Received shipment from Apex Tech"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setAdjustingItem(null)}
                className="flex-1 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteAdjustment}
                disabled={adjustQtyChange === 0 || isSubmittingAdjust}
                className="flex-1 py-2 text-xs font-bold rounded-xl bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {isSubmittingAdjust ? 'Updating...' : 'Log & Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
