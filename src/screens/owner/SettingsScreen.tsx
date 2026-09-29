import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { User } from '../../types';
import { db, resetDatabaseWithSeed } from '../../db';
import { formatDateTime } from '../../utils/formatters';
import {
  Settings,
  Store,
  Receipt,
  Users,
  Database,
  RotateCcw,
  Plus,
  Shield,
  CheckCircle2,
  AlertTriangle,
  History,
  Download,
  Sun,
  Moon,
} from 'lucide-react';

interface SettingsScreenProps {
  onOpenAuditLog: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onOpenAuditLog }) => {
  const { currentShop, currentUser, updateShopSettings, updateShopDetails } = useAuth();
  const { theme, setTheme, isDark, toggleTheme } = useTheme();

  // Shop Details form
  const [shopName, setShopName] = useState(currentShop?.name || '');
  const [shopPhone, setShopPhone] = useState(currentShop?.phone || '');
  const [shopAddress, setShopAddress] = useState(currentShop?.address || '');
  const [currency, setCurrency] = useState(currentShop?.currency || 'GHS');
  const [taxRate, setTaxRate] = useState(currentShop?.settings.taxRatePercent || 0);

  // Settings toggles
  const [allowPriceOverride, setAllowPriceOverride] = useState(
    currentShop?.settings.allowPriceOverride ?? true
  );
  const [allowNegativeStock, setAllowNegativeStock] = useState(
    currentShop?.settings.allowNegativeStock ?? false
  );
  const [invoicePrefix, setInvoicePrefix] = useState(
    currentShop?.settings.invoicePrefix || 'INV'
  );
  const [receiptFooter, setReceiptFooter] = useState(
    currentShop?.settings.receiptFooter || ''
  );

  // Sellers
  const [sellers, setSellers] = useState<User[]>([]);
  const [newSellerName, setNewSellerName] = useState('');
  const [newSellerEmail, setNewSellerEmail] = useState('');
  const [newSellerPin, setNewSellerPin] = useState('1234');
  const [isAddingSeller, setIsAddingSeller] = useState(false);

  // Status feedback
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const loadSellers = async () => {
    if (!currentShop) return;
    const allUsers = await db.users.where('shopId').equals(currentShop.id).toArray();
    setSellers(allUsers);
  };

  useEffect(() => {
    loadSellers();
  }, [currentShop]);

  useEffect(() => {
    if (currentShop) {
      setShopName(currentShop.name);
      setShopPhone(currentShop.phone);
      setShopAddress(currentShop.address);
      setCurrency(currentShop.currency);
      setTaxRate(currentShop.settings.taxRatePercent);
      setAllowPriceOverride(currentShop.settings.allowPriceOverride);
      setAllowNegativeStock(currentShop.settings.allowNegativeStock);
      setInvoicePrefix(currentShop.settings.invoicePrefix);
      setReceiptFooter(currentShop.settings.receiptFooter);
    }
  }, [currentShop]);

  const handleSaveShopSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentShop) return;

    await updateShopDetails({
      name: shopName,
      phone: shopPhone,
      address: shopAddress,
      currency,
    });

    await updateShopSettings({
      allowPriceOverride,
      allowNegativeStock,
      invoicePrefix: invoicePrefix.toUpperCase(),
      receiptFooter,
      taxRatePercent: Number(taxRate) || 0,
    });

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  // Add Seller
  const handleAddSeller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSellerName.trim() || !newSellerEmail.trim() || !currentShop) return;

    const newUid = `user-${Date.now()}`;
    const code = `D0${sellers.length + 1}`;
    const newUser: User = {
      uid: newUid,
      shopId: currentShop.id,
      name: newSellerName.trim(),
      email: newSellerEmail.trim(),
      role: 'seller',
      active: true,
      deviceCode: code,
      pin: newSellerPin.trim() || '1234',
      createdAt: Date.now(),
    };

    await db.users.add(newUser);
    await db.auditLogs.add({
      id: `audit-${Date.now()}`,
      shopId: currentShop.id,
      action: 'seller_created',
      entity: 'users',
      entityId: newUid,
      userId: currentUser?.uid || 'owner',
      userName: currentUser?.name || 'Owner',
      meta: { name: newUser.name, email: newUser.email },
      createdAt: Date.now(),
    });

    setNewSellerName('');
    setNewSellerEmail('');
    setNewSellerPin('1234');
    setIsAddingSeller(false);
    await loadSellers();
  };

  // Toggle seller active
  const handleToggleSellerActive = async (user: User) => {
    if (user.role === 'owner') return; // Cannot disable owner
    await db.users.update(user.uid, { active: !user.active });
    await loadSellers();
  };

  // Reset demo data
  const handleResetData = async () => {
    if (
      confirm(
        'Reset shop database to initial seeded demonstration data? All test sales and changes will be replaced with fresh sample electrical gadgets catalog.'
      )
    ) {
      try {
        setIsResetting(true);
        await resetDatabaseWithSeed();
        alert('Shop database restored to fresh seed demo state.');
        window.location.reload();
      } finally {
        setIsResetting(false);
      }
    }
  };

  // Full backup JSON export
  const handleExportFullBackup = async () => {
    if (!currentShop) return;
    const [items, sales, customers, stockMovements, auditLogs] = await Promise.all([
      db.items.toArray(),
      db.sales.toArray(),
      db.customers.toArray(),
      db.stockMovements.toArray(),
      db.auditLogs.toArray(),
    ]);

    const backup = {
      shop: currentShop,
      timestamp: new Date().toISOString(),
      items,
      sales,
      customers,
      stockMovements,
      auditLogs,
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `shopledger-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pb-24 pt-1 max-w-4xl mx-auto px-2 sm:px-4 space-y-4">
      {/* Top Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600" />
            <span>Store Configuration & Policies</span>
          </h1>
          <p className="text-xs text-slate-500">
            Shop profile, invoice format, staff logins, and security rules.
          </p>
        </div>

        <button
          onClick={onOpenAuditLog}
          className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer shadow-xs"
        >
          <History className="w-3.5 h-3.5 text-indigo-500" />
          <span>Audit Log</span>
        </button>
      </div>

      {saveSuccess && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>Settings successfully updated across store devices!</span>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={handleSaveShopSettings} className="space-y-4">
        {/* Section 1: Shop Profile */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <Store className="w-4 h-4 text-indigo-500" />
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">Shop Profile</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Shop Name
              </label>
              <input
                type="text"
                required
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={shopPhone}
                onChange={(e) => setShopPhone(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Address / Location
              </label>
              <input
                type="text"
                value={shopAddress}
                onChange={(e) => setShopAddress(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
                >
                  <option value="GHS">Ghanaian Cedi (GH₵)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="NGN">NGN (₦)</option>
                  <option value="KES">KES (KSh)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Appearance Theme
                </label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTheme('light')}
                    className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1 cursor-pointer ${
                      theme === 'light'
                        ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5" />
                    <span>Light</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('dark')}
                    className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1 cursor-pointer ${
                      theme === 'dark'
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-950 dark:border-white shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                    <span>Dark</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Counter & POS Policies */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <Receipt className="w-4 h-4 text-emerald-500" />
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">Counter POS & Invoicing Policies</h2>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Offline-Safe Invoice Prefix
                </label>
                <input
                  type="text"
                  maxLength={5}
                  value={invoicePrefix}
                  onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono uppercase font-bold"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Generated as: <span className="font-mono">{invoicePrefix}-D01-0042</span>
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Receipt Thermal Footer Text
                </label>
                <input
                  type="text"
                  value={receiptFooter}
                  onChange={(e) => setReceiptFooter(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
              <label className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
                <div>
                  <span className="font-semibold block text-slate-900 dark:text-white">
                    Allow Cashier Unit Price Override
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Allows sellers to modify item unit price at checkout (e.g. negotiated discount)
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={allowPriceOverride}
                  onChange={(e) => setAllowPriceOverride(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
                <div>
                  <span className="font-semibold block text-slate-900 dark:text-white">
                    Allow Negative Stock Sales
                  </span>
                  <span className="text-[11px] text-slate-500">
                    If off, prevents sellers from selling more items than currently in store.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={allowNegativeStock}
                  onChange={(e) => setAllowNegativeStock(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
                />
              </label>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition cursor-pointer shadow-sm"
            >
              Save Store Settings
            </button>
          </div>
        </div>
      </form>

      {/* Section 3: Staff & Sellers Management */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-500" />
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">
              Cashiers & Seller Accounts ({sellers.length})
            </h2>
          </div>
          <button
            onClick={() => setIsAddingSeller(true)}
            className="px-3 py-1 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            <span>Add Staff Account</span>
          </button>
        </div>

        {/* Sellers List */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {sellers.map((user) => (
            <div key={user.uid} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {user.name}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono font-bold">
                    Dev: {user.deviceCode}
                  </span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold ${
                      user.role === 'owner'
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    }`}
                  >
                    {user.role}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">{user.email}</p>
              </div>

              <div className="flex items-center gap-2">
                {user.role !== 'owner' && (
                  <button
                    onClick={() => handleToggleSellerActive(user)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                      user.active
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                        : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400'
                    }`}
                  >
                    {user.active ? 'Active' : 'Disabled'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Add Seller Form Modal */}
        {isAddingSeller && (
          <form
            onSubmit={handleAddSeller}
            className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2.5 text-xs animate-in fade-in"
          >
            <h4 className="font-bold text-slate-900 dark:text-white">Add New Staff Member</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                required
                placeholder="Full Name (e.g. Samira Chen)"
                value={newSellerName}
                onChange={(e) => setNewSellerName(e.target.value)}
                className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
              <input
                type="email"
                required
                placeholder="Email login (e.g. staff@shop.com)"
                value={newSellerEmail}
                onChange={(e) => setNewSellerEmail(e.target.value)}
                className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
              <input
                type="text"
                maxLength={6}
                placeholder="Counter Quick PIN (e.g. 2026)"
                value={newSellerPin}
                onChange={(e) => setNewSellerPin(e.target.value)}
                className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAddingSeller(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 shadow-xs"
              >
                Create Staff Account
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Section 4: Data Backup & Reset */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
          <Database className="w-4 h-4 text-purple-500" />
          <h2 className="font-bold text-sm text-slate-900 dark:text-white">Data Management & Backup</h2>
        </div>

        <p className="text-xs text-slate-500">
          Export full database snapshot or restore sample demo electrical gadgets to explore app capabilities.
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={handleExportFullBackup}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Download className="w-3.5 h-3.5 text-purple-500" />
            <span>Export Full Data Backup (JSON)</span>
          </button>

          <button
            onClick={handleResetData}
            disabled={isResetting}
            className="px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 text-xs font-semibold hover:bg-rose-100 flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{isResetting ? 'Restoring...' : 'Reset to Fresh Seed Demo Data'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
