import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Item, StockMovementType, OwnerWithdrawal } from '../../types';
import { db, recordOwnerWithdrawal } from '../../db';
import {
  adjustStock,
  saveItemAcrossDevices,
  deleteItemAcrossDevices,
} from '../../db/sync';
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
  CheckCircle2,
  AlertTriangle,
  XCircle,
  SlidersHorizontal,
  X,
  PackageMinus,
  History,
  FileSpreadsheet,
  Trash2,
} from 'lucide-react';

interface InventoryScreenProps {
  onOpenImport: () => void;
}

export const InventoryScreen: React.FC<InventoryScreenProps> = ({ onOpenImport }) => {
  const { currentShop, currentUser } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'low' | 'out'>('all');
  const [activeTab, setActiveTab] = useState<'inventory' | 'withdrawals'>('inventory');

  // Withdrawals history state
  const [withdrawals, setWithdrawals] = useState<OwnerWithdrawal[]>([]);

  // Edit / Add Modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<Item> | null>(null);

  // Stock Adjustment Modal
  const [adjustingItem, setAdjustingItem] = useState<Item | null>(null);
  const [adjustQtyChange, setAdjustQtyChange] = useState<number | ''>(0);
  const [adjustReasonType, setAdjustReasonType] = useState<StockMovementType>('restock');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [isSubmittingAdjust, setIsSubmittingAdjust] = useState(false);

  // Owner Withdraw Modal State
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawingItem, setWithdrawingItem] = useState<Item | null>(null);
  const [withdrawQty, setWithdrawQty] = useState<number | ''>(1);
  const [withdrawReason, setWithdrawReason] = useState<string>('Personal use by Owner');
  const [withdrawNotes, setWithdrawNotes] = useState<string>('');
  const [isSubmittingWithdraw, setIsSubmittingWithdraw] = useState<boolean>(false);
  const [withdrawMessage, setWithdrawMessage] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const loadItems = async () => {
    if (!currentShop) return;
    const all = await db.items.where('shopId').equals(currentShop.id).toArray();
    setItems(all);
  };

  const loadWithdrawals = async () => {
    if (!currentShop) return;
    const all = await db.withdrawals.where('shopId').equals(currentShop.id).reverse().toArray();
    setWithdrawals(all);
  };

  useEffect(() => {
    loadItems();
    loadWithdrawals();

    const handleUpdate = () => {
      loadItems();
    };
    window.addEventListener('shopledger_inventory_updated', handleUpdate);
    return () => {
      window.removeEventListener('shopledger_inventory_updated', handleUpdate);
    };
  }, [currentShop]);

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

      if (stockFilter === 'out') return item.quantity <= 0;
      if (stockFilter === 'low') return item.quantity > 0 && item.quantity <= item.reorderLevel;
      if (stockFilter === 'in') return item.quantity > item.reorderLevel;

      return true;
    });
  }, [items, searchQuery, stockFilter]);

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
      const updatedItem: Item = {
        ...editingItem,
        id: editingItem.id,
        shopId: currentShop.id,
        name: editingItem.name.trim(),
        sku,
        barcode: editingItem.barcode?.trim() || undefined,
        category: 'General Electrical',
        brand: editingItem.brand?.trim() || '',
        costPrice: Number(editingItem.costPrice) || 0,
        sellingPrice: Number(editingItem.sellingPrice) || 0,
        quantity: Number(editingItem.quantity) || 0,
        reorderLevel: Number(editingItem.reorderLevel) || 5,
        supplier: editingItem.supplier?.trim() || undefined,
        description: editingItem.description?.trim() || undefined,
        archived: Boolean(editingItem.archived),
        createdAt: editingItem.createdAt || now,
        updatedAt: now,
      };

      await saveItemAcrossDevices(updatedItem);

      await db.auditLogs.add({
        id: `audit-${now}`,
        shopId: currentShop.id,
        action: 'item_updated',
        entity: 'items',
        entityId: editingItem.id,
        userId: currentUser?.uid || 'owner',
        userName: currentUser?.name || 'Owner',
        meta: { name: editingItem.name, sku },
        createdAt: now,
      });
    } else {
      // Create new
      const newItemId = `item-${now}-${Math.random().toString(36).substring(2, 7)}`;
      const newItem: Item = {
        id: newItemId,
        shopId: currentShop.id,
        name: editingItem.name.trim(),
        sku,
        barcode: editingItem.barcode?.trim() || undefined,
        category: 'General Electrical',
        brand: editingItem.brand?.trim() || '',
        costPrice: Number(editingItem.costPrice) || 0,
        sellingPrice: Number(editingItem.sellingPrice) || 0,
        quantity: Number(editingItem.quantity) || 0,
        reorderLevel: Number(editingItem.reorderLevel) || 5,
        supplier: editingItem.supplier?.trim() || undefined,
        description: editingItem.description?.trim() || undefined,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };

      await saveItemAcrossDevices(newItem);

      // Record initial movement
      if (newItem.quantity > 0) {
        await db.stockMovements.add({
          id: `sm-${now}`,
          shopId: currentShop.id,
          itemId: newItemId,
          itemName: newItem.name,
          itemSku: newItem.sku,
          type: 'restock',
          qtyChange: newItem.quantity,
          previousQty: 0,
          newQty: newItem.quantity,
          reason: 'Initial stock entry',
          userId: currentUser?.uid || 'owner',
          userName: currentUser?.name || 'Owner',
          createdAt: now,
        });
      }

      await db.auditLogs.add({
        id: `audit-${now}`,
        shopId: currentShop.id,
        action: 'item_created',
        entity: 'items',
        entityId: newItemId,
        userId: currentUser?.uid || 'owner',
        userName: currentUser?.name || 'Owner',
        meta: { name: newItem.name, sku },
        createdAt: now,
      });
    }

    setIsEditModalOpen(false);
    setEditingItem(null);
    await loadItems();
  };

  // Toggle archive across devices
  const handleToggleArchive = async (item: Item) => {
    if (!currentShop) return;
    const now = Date.now();
    await saveItemAcrossDevices({
      ...item,
      archived: !item.archived,
      updatedAt: now,
    });
    await db.auditLogs.add({
      id: `audit-${now}`,
      shopId: currentShop.id,
      action: item.archived ? 'item_restored' : 'item_archived',
      entity: 'items',
      entityId: item.id,
      userId: currentUser?.uid || 'owner',
      userName: currentUser?.name || 'Owner',
      meta: { name: item.name },
      createdAt: now,
    });
    await loadItems();
  };

  // Permanently delete item across all devices & cloud
  const handleDeleteItem = async (item: Item) => {
    if (!currentShop || !currentUser) return;
    if (
      !confirm(
        `Are you sure you want to permanently delete "${item.name}" (SKU: ${item.sku})? This will remove it across all devices and cloud inventory.`
      )
    ) {
      return;
    }
    await deleteItemAcrossDevices(
      currentShop.id,
      item.id,
      currentUser.uid,
      currentUser.name
    );
    setIsEditModalOpen(false);
    setEditingItem(null);
    await loadItems();
  };

  // Handle Stock Adjustment Submit
  const handleExecuteAdjustment = async () => {
    if (!adjustingItem || !currentShop || !currentUser) return;
    const numChange = typeof adjustQtyChange === 'number' ? adjustQtyChange : parseInt(adjustQtyChange, 10) || 0;
    if (numChange === 0) return;

    try {
      setIsSubmittingAdjust(true);
      await adjustStock({
        shopId: currentShop.id,
        itemId: adjustingItem.id,
        qtyChange: numChange,
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

  // Handle Owner Withdrawal Submit
  const handleExecuteWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!withdrawingItem || !currentShop || !currentUser) return;
    const numWithdrawQty = typeof withdrawQty === 'number' ? withdrawQty : parseInt(withdrawQty, 10) || 0;
    if (numWithdrawQty <= 0) {
      setWithdrawError('Quantity to withdraw must be at least 1.');
      return;
    }
    if (numWithdrawQty > withdrawingItem.quantity) {
      setWithdrawError(`Cannot withdraw more than available stock (${withdrawingItem.quantity}).`);
      return;
    }

    try {
      setIsSubmittingWithdraw(true);
      setWithdrawError(null);
      const combinedReason = withdrawNotes.trim()
        ? `${withdrawReason}: ${withdrawNotes.trim()}`
        : withdrawReason;

      const record = await recordOwnerWithdrawal({
        shopId: currentShop.id,
        itemId: withdrawingItem.id,
        quantity: numWithdrawQty,
        reason: combinedReason,
        userId: currentUser.uid,
        userName: currentUser.name,
      });

      setWithdrawMessage(
        `Successfully withdrawn ${record.quantity}x "${record.itemName}". Deducted from inventory.`
      );
      setTimeout(() => setWithdrawMessage(null), 4000);

      setIsWithdrawModalOpen(false);
      setWithdrawingItem(null);
      setWithdrawQty(1);
      setWithdrawNotes('');
      await loadItems();
      await loadWithdrawals();
    } catch (err: any) {
      setWithdrawError(err?.message || 'Failed to record withdrawal.');
    } finally {
      setIsSubmittingWithdraw(false);
    }
  };

  // Export inventory to CSV
  const handleExportCSV = async () => {
    if (!currentShop) return;
    const csv = await exportInventoryToCSV(currentShop.id);
    downloadCSV(csv, `shopledger-inventory-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const totalWithdrawnCostValue = useMemo(() => {
    return withdrawals.reduce((sum, w) => sum + (w.totalCostValue || 0), 0);
  }, [withdrawals]);

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

        <div className="flex items-center gap-2 flex-wrap">
          {/* Owner Withdrawal Button */}
          <button
            onClick={() => {
              setWithdrawingItem(items.find((i) => !i.archived && i.quantity > 0) || items[0] || null);
              setWithdrawQty(1);
              setWithdrawError(null);
              setIsWithdrawModalOpen(true);
            }}
            className="flex-1 sm:flex-initial min-h-[40px] px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
            title="Owner Takeout: Record personal item withdrawal"
          >
            <PackageMinus className="w-4 h-4" />
            <span>Withdraw Item</span>
          </button>

          <button
            onClick={onOpenImport}
            className="flex-1 sm:flex-initial min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <UploadCloud className="w-4 h-4 text-indigo-500" />
            <span>Import CSV</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="flex-1 sm:flex-initial min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-500" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => {
              setEditingItem({
                name: '',
                category: 'General Electrical',
                brand: '',
                costPrice: 0,
                sellingPrice: 0,
                quantity: 10,
                reorderLevel: 5,
              });
              setIsEditModalOpen(true);
            }}
            className="flex-1 sm:flex-initial min-h-[40px] px-4 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Add Gadget</span>
          </button>
        </div>
      </div>

      {/* Success Notification */}
      {withdrawMessage && (
        <div className="p-3 rounded-2xl bg-amber-500 text-white text-xs font-bold flex items-center gap-2 shadow-md animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{withdrawMessage}</span>
        </div>
      )}

      {/* Tabs: Inventory Catalog vs Owner Withdrawals Ledger */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-4 text-xs font-bold px-1">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`pb-2.5 transition cursor-pointer border-b-2 flex items-center gap-1.5 ${
            activeTab === 'inventory'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Boxes className="w-4 h-4" />
          <span>Active Stock ({items.filter((i) => !i.archived).length})</span>
        </button>

        <button
          onClick={() => setActiveTab('withdrawals')}
          className={`pb-2.5 transition cursor-pointer border-b-2 flex items-center gap-1.5 ${
            activeTab === 'withdrawals'
              ? 'border-amber-600 text-amber-600 dark:text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <PackageMinus className="w-4 h-4" />
          <span>Owner Withdrawals ({withdrawals.length})</span>
        </button>
      </div>

      {activeTab === 'inventory' ? (
        <>
          {/* Search & Stock Filter Bar (NO CATEGORIES) */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search items by gadget name, SKU, brand, or barcode..."
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium"
              />
            </div>

            {/* Stock status filter */}
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
            </div>
          </div>

          {/* Items Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-3.5 py-3">Gadget & SKU</th>
                    <th className="px-3.5 py-3 text-right">Cost Price</th>
                    <th className="px-3.5 py-3 text-right">Selling Price</th>
                    <th className="px-3.5 py-3 text-center">Stock</th>
                    <th className="px-3.5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-500">
                        No gadgets found matching the search.
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
                          <td className="px-3.5 py-3 min-w-[220px] max-w-[360px]">
                            <p className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white break-words leading-snug">
                              {item.name}
                            </p>
                            <p className="text-[11px] text-slate-500 font-mono mt-0.5 break-words">
                              {item.sku} {item.brand && item.brand.trim() && item.brand.toLowerCase() !== 'generic' && !item.name.toLowerCase().includes(item.brand.toLowerCase()) ? `\u2022 ${item.brand}` : ''}
                            </p>
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
                              {/* Owner Withdraw Quick Trigger */}
                              <button
                                onClick={() => {
                                  setWithdrawingItem(item);
                                  setWithdrawQty(1);
                                  setWithdrawError(null);
                                  setIsWithdrawModalOpen(true);
                                }}
                                disabled={item.quantity <= 0}
                                className="p-1.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100 transition disabled:opacity-30 cursor-pointer"
                                title="Withdraw item (Take out from store)"
                              >
                                <PackageMinus className="w-3.5 h-3.5" />
                              </button>

                              {/* Stock Adjustment Trigger */}
                              <button
                                onClick={() => {
                                  setAdjustingItem(item);
                                  setAdjustQtyChange(0);
                                  setAdjustReasonType('restock');
                                  setAdjustNotes('');
                                }}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition cursor-pointer"
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
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition cursor-pointer"
                                title="Edit Product Details"
                              >
                                <Edit2 className="w-3.5 h-3.5 text-blue-500" />
                              </button>

                              {/* Archive Item */}
                              <button
                                onClick={() => handleToggleArchive(item)}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-amber-500 transition cursor-pointer"
                                title={item.archived ? 'Restore Gadget' : 'Archive Gadget'}
                              >
                                <Archive className="w-3.5 h-3.5" />
                              </button>

                              {/* Delete Item permanently across all devices */}
                              <button
                                onClick={() => handleDeleteItem(item)}
                                className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition cursor-pointer"
                                title="Permanently Delete Item across all devices"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
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
        </>
      ) : (
        /* Owner Withdrawals Ledger Sub-Tab */
        <div className="space-y-3">
          <div className="bg-gradient-to-br from-amber-600 to-orange-700 text-white rounded-2xl p-4 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs text-amber-100 font-medium">Total Owner Withdrawals</p>
              <h2 className="text-2xl font-black mt-0.5">
                {formatCurrency(totalWithdrawnCostValue, currentShop?.currency)}
              </h2>
              <p className="text-[11px] text-amber-100 mt-1">
                Value based on shop purchase cost price
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs text-amber-100">Total Items Withdrawn</span>
              <p className="text-xl font-bold">
                {withdrawals.reduce((sum, w) => sum + (w.quantity || 0), 0)} units
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                <History className="w-4 h-4 text-amber-500" />
                <span>Withdrawal Audit Records</span>
              </h3>
              <button
                onClick={() => {
                  setWithdrawingItem(items.find((i) => !i.archived && i.quantity > 0) || items[0] || null);
                  setWithdrawQty(1);
                  setWithdrawError(null);
                  setIsWithdrawModalOpen(true);
                }}
                className="px-3 py-1 rounded-xl bg-amber-600 text-white font-semibold text-xs hover:bg-amber-700 transition flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Takeout</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-3.5 py-3">Date & Time</th>
                    <th className="px-3.5 py-3">Item Name & SKU</th>
                    <th className="px-3.5 py-3 text-center">Qty</th>
                    <th className="px-3.5 py-3 text-right">Cost Value</th>
                    <th className="px-3.5 py-3">Purpose / Note</th>
                    <th className="px-3.5 py-3">Authorized By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {withdrawals.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-500">
                        No items have been withdrawn by the owner yet.
                      </td>
                    </tr>
                  ) : (
                    withdrawals.map((w) => (
                      <tr key={w.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="px-3.5 py-3 text-slate-500 whitespace-nowrap">
                          {formatDateTime(w.createdAt)}
                        </td>
                        <td className="px-3.5 py-3">
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {w.itemName}
                          </p>
                          <span className="text-[10px] font-mono text-slate-500">{w.itemSku}</span>
                        </td>
                        <td className="px-3.5 py-3 text-center font-bold text-amber-600 dark:text-amber-400">
                          {w.quantity}
                        </td>
                        <td className="px-3.5 py-3 text-right font-bold text-slate-900 dark:text-white">
                          {formatCurrency(w.totalCostValue, currentShop?.currency)}
                        </td>
                        <td className="px-3.5 py-3 text-slate-600 dark:text-slate-300">
                          {w.reason}
                        </td>
                        <td className="px-3.5 py-3 text-slate-500">
                          {w.userName || 'Owner'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Owner Item Withdrawal Modal */}
      {isWithdrawModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/70 text-amber-600 flex items-center justify-center">
                  <PackageMinus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    Owner Item Withdrawal
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Take out stock for personal use or maintenance
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsWithdrawModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteWithdrawal} className="space-y-3 text-xs">
              {/* Select Item */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Select Gadget from Inventory
                </label>
                <select
                  value={withdrawingItem?.id || ''}
                  onChange={(e) => {
                    const sel = items.find((i) => i.id === e.target.value);
                    if (sel) {
                      setWithdrawingItem(sel);
                      setWithdrawQty(1);
                    }
                  }}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-900 dark:text-white"
                >
                  {items
                    .filter((i) => !i.archived)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.quantity} in stock) - {item.sku}
                      </option>
                    ))}
                </select>
              </div>

              {withdrawingItem && (
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Current In Stock:</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {withdrawingItem.quantity} items
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Unit Cost Price:</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {formatCurrency(withdrawingItem.costPrice, currentShop?.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200 dark:border-slate-700">
                    <span className="font-semibold text-amber-700 dark:text-amber-400">
                      Total Cost Value:
                    </span>
                    <span className="font-black text-amber-700 dark:text-amber-400">
                      {formatCurrency(
                        (withdrawingItem.costPrice || 0) *
                          (typeof withdrawQty === 'number'
                            ? withdrawQty
                            : parseInt(withdrawQty, 10) || 0),
                        currentShop?.currency
                      )}
                    </span>
                  </div>
                </div>
              )}

              {/* Quantity */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Quantity to Withdraw
                </label>
                <input
                  type="number"
                  min="0"
                  max={withdrawingItem?.quantity || 9999}
                  required
                  value={withdrawQty}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setWithdrawQty('');
                    } else {
                      const p = parseInt(val, 10);
                      setWithdrawQty(isNaN(p) ? '' : p);
                    }
                  }}
                  placeholder="0"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-sm text-slate-900 dark:text-white"
                />
              </div>

              {/* Reason */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Purpose / Reason
                </label>
                <select
                  value={withdrawReason}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                >
                  <option value="Personal use by Owner">Personal use by Owner</option>
                  <option value="Store Maintenance / Shop Use">Store Maintenance / Shop Use</option>
                  <option value="Defective / Factory Damaged">Defective / Factory Damaged</option>
                  <option value="Client Demo / Sample">Client Demo / Sample</option>
                  <option value="Gift / Goodwill">Gift / Goodwill</option>
                  <option value="Other">Other Reason</option>
                </select>
              </div>

              {/* Additional Notes */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Additional Notes (Optional)
                </label>
                <input
                  type="text"
                  value={withdrawNotes}
                  onChange={(e) => setWithdrawNotes(e.target.value)}
                  placeholder="e.g. Taken for personal home electrical work..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
              </div>

              {withdrawError && (
                <p className="text-[11px] text-rose-500 font-semibold">{withdrawError}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsWithdrawModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingWithdraw || !withdrawingItem}
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold transition shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingWithdraw ? 'Deducting Stock...' : 'Confirm Withdrawal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full p-5 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Adjust Inventory Stock
              </h3>
              <button
                onClick={() => setAdjustingItem(null)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs space-y-3">
              <div>
                <p className="font-bold text-slate-900 dark:text-white">{adjustingItem.name}</p>
                <p className="text-[11px] text-slate-500 font-mono">
                  {adjustingItem.sku} &bull; Current: {adjustingItem.quantity}
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Reason for Adjustment
                </label>
                <select
                  value={adjustReasonType}
                  onChange={(e) => setAdjustReasonType(e.target.value as StockMovementType)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                >
                  <option value="restock">Restock / New Shipment Received</option>
                  <option value="return">Customer Return</option>
                  <option value="adjustment">Stock Count Audit / Correction</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Quantity Change (+ or -)
                </label>
                <input
                  type="number"
                  value={adjustQtyChange}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || val === '-') {
                      setAdjustQtyChange(val as any);
                    } else {
                      const p = parseInt(val, 10);
                      setAdjustQtyChange(isNaN(p) ? '' : p);
                    }
                  }}
                  placeholder="+10 or -5"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  New stock will be:{' '}
                  {adjustingItem.quantity +
                    (typeof adjustQtyChange === 'number'
                      ? adjustQtyChange
                      : parseInt(adjustQtyChange, 10) || 0)}
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
                  placeholder="e.g. Weekly physical audit correction"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setAdjustingItem(null)}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecuteAdjustment}
                  disabled={isSubmittingAdjust || adjustQtyChange === 0}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSubmittingAdjust ? 'Applying...' : 'Save Movement'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit / Add Item Modal (NO CATEGORY FIELD) */}
      {isEditModalOpen && editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-5 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                {editingItem.id ? 'Edit Gadget' : 'Add New Electrical Gadget'}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Gadget Name *
                </label>
                <input
                  type="text"
                  required
                  value={editingItem.name || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                  placeholder="e.g. Anker 20W Fast Charger"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    SKU Code
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
                    Brand / Manufacturer
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

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Barcode (EAN/UPC) - Optional
                </label>
                <input
                  type="text"
                  value={editingItem.barcode || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, barcode: e.target.value })}
                  placeholder="848061023451"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
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
                    value={editingItem.costPrice === undefined ? '' : editingItem.costPrice}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        costPrice: e.target.value === '' ? ('' as any) : parseFloat(e.target.value) || 0,
                      })
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
                    value={editingItem.sellingPrice === undefined ? '' : editingItem.sellingPrice}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        sellingPrice: e.target.value === '' ? ('' as any) : parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    In-Stock Quantity
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editingItem.quantity === undefined ? '' : editingItem.quantity}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        quantity: e.target.value === '' ? ('' as any) : parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Low Stock Reorder Alert
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editingItem.reorderLevel === undefined ? '' : editingItem.reorderLevel}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        reorderLevel: e.target.value === '' ? ('' as any) : parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Supplier / Source (Optional)
                </label>
                <input
                  type="text"
                  value={editingItem.supplier || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, supplier: e.target.value })}
                  placeholder="e.g. Apex Tech Distro"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                {editingItem.id ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteItem(editingItem as Item)}
                    className="px-3.5 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 font-semibold hover:bg-rose-100 dark:hover:bg-rose-900/40 flex items-center gap-1.5 cursor-pointer text-xs"
                    title="Permanently Delete Item across all devices"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete Item</span>
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 cursor-pointer shadow-sm text-xs"
                  >
                    Save Gadget
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
