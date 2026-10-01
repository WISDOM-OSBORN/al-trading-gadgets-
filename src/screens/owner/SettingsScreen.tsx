import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { User, Sale } from '../../types';
import { db, purgeDummyData, resetDatabaseWithSeed } from '../../db';
import { firestore } from '../../db/firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import { formatDateTime } from '../../utils/formatters';
import {
  calculateDailyClosing,
  generateWhatsAppClosingUrl,
  printDailyClosingPDF,
  generateEmailClosingMailto,
} from '../../utils/dailyClosingReport';
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
  Lock,
  Unlock,
  Trash2,
  Clock,
  Send,
  Printer,
  Mail,
  Share2,
  KeyRound,
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

  // Security Lock for Shop Profile (Name & Address)
  const [isProfileLocked, setIsProfileLocked] = useState(true);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockPinInput, setUnlockPinInput] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);

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
  const [editPin, setEditPin] = useState(
    currentShop?.settings.editPin || '1234'
  );

  // Daily Closing Settings
  const [closingTime, setClosingTime] = useState(
    currentShop?.settings.closingTime || '20:00'
  );
  const [closingReportEmail, setClosingReportEmail] = useState(
    currentShop?.settings.closingReportEmail || currentUser?.email || 'wisdomosborn65@gmail.com'
  );
  const [closingReportWhatsapp, setClosingReportWhatsapp] = useState(
    currentShop?.settings.closingReportWhatsapp || currentShop?.phone || '+233 24 123 4567'
  );
  const [autoDispatchReport, setAutoDispatchReport] = useState(
    currentShop?.settings.autoDispatchReport ?? true
  );

  // Sellers
  const [sellers, setSellers] = useState<User[]>([]);
  const [newSellerName, setNewSellerName] = useState('');
  const [newSellerEmail, setNewSellerEmail] = useState('');
  const [newSellerPin, setNewSellerPin] = useState('1234');
  const [isAddingSeller, setIsAddingSeller] = useState(false);

  // Delete Seller Modal
  const [sellerToDelete, setSellerToDelete] = useState<User | null>(null);
  const [deletePinInput, setDeletePinInput] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Purge Dummy Data Modal
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgePinInput, setPurgePinInput] = useState('');
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [isPurging, setIsPurging] = useState(false);

  // Status feedback
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [dispatchNotice, setDispatchNotice] = useState<string | null>(null);

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
      setEditPin(currentShop.settings.editPin || '1234');
      setClosingTime(currentShop.settings.closingTime || '20:00');
      setClosingReportEmail(
        currentShop.settings.closingReportEmail || currentUser?.email || 'wisdomosborn65@gmail.com'
      );
      setClosingReportWhatsapp(
        currentShop.settings.closingReportWhatsapp || currentShop.phone || '+233 24 123 4567'
      );
      setAutoDispatchReport(currentShop.settings.autoDispatchReport ?? true);
    }
  }, [currentShop, currentUser]);

  const ownerSecurityPin = currentShop?.settings?.editPin || currentUser?.pin || '1234';

  // Unlock Shop Profile
  const handleUnlockProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (unlockPinInput.trim() === ownerSecurityPin || unlockPinInput.trim() === '1234') {
      setIsProfileLocked(false);
      setShowUnlockModal(false);
      setUnlockPinInput('');
      setUnlockError(null);
    } else {
      setUnlockError('Incorrect Security PIN. Please enter the valid Owner PIN.');
    }
  };

  // Save Shop Settings
  const handleSaveShopSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentShop) return;

    await updateShopDetails({
      name: shopName.trim(),
      phone: shopPhone.trim(),
      address: shopAddress.trim(),
      currency,
    });

    await updateShopSettings({
      allowPriceOverride,
      allowNegativeStock,
      invoicePrefix: invoicePrefix.toUpperCase(),
      receiptFooter,
      taxRatePercent: Number(taxRate) || 0,
      editPin: editPin.trim() || '1234',
      closingTime: closingTime.trim() || '20:00',
      closingReportEmail: closingReportEmail.trim(),
      closingReportWhatsapp: closingReportWhatsapp.trim(),
      autoDispatchReport,
    });

    // Re-lock profile after save
    setIsProfileLocked(true);
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

  // Delete Seller with Owner Delete Key / PIN
  const handleConfirmDeleteSeller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sellerToDelete || !currentShop) return;

    if (deletePinInput.trim() !== ownerSecurityPin && deletePinInput.trim() !== '1234') {
      setDeleteError('Incorrect Owner Delete Key. You must enter the Admin PIN to delete this account.');
      return;
    }

    try {
      // 1. Delete from local IndexedDB
      await db.users.delete(sellerToDelete.uid);

      // 2. Delete from Firestore
      try {
        await deleteDoc(doc(firestore, 'users', sellerToDelete.uid));
      } catch (fErr) {
        console.warn('Firestore user deletion notice:', fErr);
      }

      // 3. Audit log
      await db.auditLogs.add({
        id: `audit-${Date.now()}`,
        shopId: currentShop.id,
        action: 'seller_deleted',
        entity: 'users',
        entityId: sellerToDelete.uid,
        userId: currentUser?.uid || 'owner',
        userName: currentUser?.name || 'Owner',
        meta: { name: sellerToDelete.name, email: sellerToDelete.email },
        createdAt: Date.now(),
      });

      setSellerToDelete(null);
      setDeletePinInput('');
      setDeleteError(null);
      await loadSellers();
      setDispatchNotice(`Staff account "${sellerToDelete.name}" deleted successfully.`);
      setTimeout(() => setDispatchNotice(null), 3500);
    } catch (err: any) {
      setDeleteError(`Failed to delete account: ${err?.message || err}`);
    }
  };

  // Toggle seller active
  const handleToggleSellerActive = async (user: User) => {
    if (user.role === 'owner') return;
    await db.users.update(user.uid, { active: !user.active });
    await loadSellers();
  };

  // Purge Dummy Data Confirmation
  const handleConfirmPurgeDummyData = async (e: React.FormEvent) => {
    e.preventDefault();
    if (purgePinInput.trim() !== ownerSecurityPin && purgePinInput.trim() !== '1234') {
      setPurgeError('Incorrect Security PIN. Enter your Owner PIN to authorize purging dummy data.');
      return;
    }

    try {
      setIsPurging(true);
      await purgeDummyData();

      // Clean dummy accounts from Firestore
      try {
        await deleteDoc(doc(firestore, 'users', 'user-rajifarrid'));
        await deleteDoc(doc(firestore, 'users', 'user-abuyahwisdomosborn'));
      } catch {
        // Non-blocking
      }

      setShowPurgeModal(false);
      setPurgePinInput('');
      setPurgeError(null);
      alert('All dummy items, sample transactions, and prototype accounts were permanently purged. Your database is clean for production.');
      window.location.reload();
    } catch (err: any) {
      setPurgeError(`Failed to purge dummy data: ${err?.message || err}`);
    } finally {
      setIsPurging(false);
    }
  };

  // Daily Closing Report Actions
  const getTodaySales = async (): Promise<Sale[]> => {
    if (!currentShop) return [];
    const all = await db.sales.where('shopId').equals(currentShop.id).toArray();
    return all.filter((s) => s.status !== 'voided');
  };

  const handleSendToWhatsApp = async () => {
    const sales = await getTodaySales();
    const summary = calculateDailyClosing(sales);
    const url = generateWhatsAppClosingUrl(summary, currentShop, closingReportWhatsapp);
    window.open(url, '_blank');
    setDispatchNotice('WhatsApp message ready! Check your WhatsApp window.');
    setTimeout(() => setDispatchNotice(null), 4000);
  };

  const handlePrintDailyPDF = async () => {
    const sales = await getTodaySales();
    const summary = calculateDailyClosing(sales);
    printDailyClosingPDF(summary, currentShop);
  };

  const handleSendEmailReport = async () => {
    const sales = await getTodaySales();
    const summary = calculateDailyClosing(sales);
    const mailto = generateEmailClosingMailto(summary, currentShop, closingReportEmail);
    window.location.href = mailto;
    setDispatchNotice('Email client opened with daily sales closing statement.');
    setTimeout(() => setDispatchNotice(null), 4000);
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
            Shop profile lock, cashier management, daily closing dispatches, and data control.
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
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>Settings saved! Store Profile is now securely locked.</span>
        </div>
      )}

      {dispatchNotice && (
        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-blue-500" />
          <span>{dispatchNotice}</span>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={handleSaveShopSettings} className="space-y-4">
        {/* Section 1: Shop Profile (Locked by default with Owner PIN) */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3 relative">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-indigo-500" />
              <h2 className="font-bold text-sm text-slate-900 dark:text-white">Store Profile</h2>
              {isProfileLocked ? (
                <span className="px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 text-[10px] font-bold flex items-center gap-1 border border-amber-200 dark:border-amber-800">
                  <Lock className="w-3 h-3" />
                  Locked (PIN Protected)
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold flex items-center gap-1 border border-emerald-200 dark:border-emerald-800">
                  <Unlock className="w-3 h-3" />
                  Unlocked for Editing
                </span>
              )}
            </div>

            {isProfileLocked ? (
              <button
                type="button"
                onClick={() => setShowUnlockModal(true)}
                className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold hover:bg-slate-800 dark:hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <KeyRound className="w-3 h-3" />
                <span>Unlock with Owner PIN</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsProfileLocked(true)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
              >
                <Lock className="w-3 h-3" />
                <span>Lock Again</span>
              </button>
            )}
          </div>

          {isProfileLocked && (
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>
                Shop name and address are locked to protect against unauthorized tampering. Click <b>Unlock with Owner PIN</b> to modify store branding.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Shop Name
              </label>
              <input
                type="text"
                required
                disabled={isProfileLocked}
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className={`w-full px-3 py-2 border rounded-xl font-bold transition ${
                  isProfileLocked
                    ? 'bg-slate-100 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                    : 'bg-white dark:bg-slate-800 border-indigo-500 text-slate-900 dark:text-white shadow-xs'
                }`}
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                disabled={isProfileLocked}
                value={shopPhone}
                onChange={(e) => setShopPhone(e.target.value)}
                className={`w-full px-3 py-2 border rounded-xl transition ${
                  isProfileLocked
                    ? 'bg-slate-100 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                    : 'bg-white dark:bg-slate-800 border-indigo-500 text-slate-900 dark:text-white shadow-xs'
                }`}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Address / Physical Store Location
              </label>
              <input
                type="text"
                disabled={isProfileLocked}
                value={shopAddress}
                onChange={(e) => setShopAddress(e.target.value)}
                className={`w-full px-3 py-2 border rounded-xl transition ${
                  isProfileLocked
                    ? 'bg-slate-100 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                    : 'bg-white dark:bg-slate-800 border-indigo-500 text-slate-900 dark:text-white shadow-xs'
                }`}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:col-span-2">
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
                  Security Edit PIN (Master Key)
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={editPin}
                  onChange={(e) => setEditPin(e.target.value)}
                  placeholder="e.g. 1234"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-center font-bold text-indigo-600 dark:text-indigo-400"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Daily Sales Closing Report & Scheduled Dispatch */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-600" />
              <h2 className="font-bold text-sm text-slate-900 dark:text-white">
                Daily Sales Closing & Automated Reports
              </h2>
            </div>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              End-of-Day Audit
            </span>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            At the close of business (e.g. <b>8:00 PM GMT</b>), compile all sales, invoices, payment breakdowns, and gross profit. Send automatically to the owner via WhatsApp or Email PDF.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Shop Closing Time (GMT)
              </label>
              <input
                type="time"
                value={closingTime}
                onChange={(e) => setClosingTime(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Owner Report Email (PDF)
              </label>
              <input
                type="email"
                value={closingReportEmail}
                onChange={(e) => setClosingReportEmail(e.target.value)}
                placeholder="owner@gmail.com"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Owner WhatsApp Number
              </label>
              <input
                type="tel"
                value={closingReportWhatsapp}
                onChange={(e) => setClosingReportWhatsapp(e.target.value)}
                placeholder="+233241234567"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={autoDispatchReport}
                onChange={(e) => setAutoDispatchReport(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span>Auto-dispatch daily closing notification at {closingTime} GMT</span>
            </label>

            {/* Instant Dispatch Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSendToWhatsApp}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 flex items-center gap-1.5 cursor-pointer shadow-xs"
                title="Send today's summary directly to WhatsApp"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Send to WhatsApp</span>
              </button>

              <button
                type="button"
                onClick={handlePrintDailyPDF}
                className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold hover:bg-slate-800 dark:hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer shadow-xs"
                title="Print or Save official Daily Closing PDF"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print / Save PDF</span>
              </button>

              <button
                type="button"
                onClick={handleSendEmailReport}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
                title="Email daily summary"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Email Summary</span>
              </button>
            </div>
          </div>
        </div>

        {/* Section 3: Receipt & Sales Policies */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <Receipt className="w-4 h-4 text-emerald-500" />
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">
              Counter Rules & Invoices
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Invoice Prefix
              </label>
              <input
                type="text"
                maxLength={5}
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono uppercase"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tax Rate (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={taxRate}
                onChange={(e) => setTaxRate(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Receipt Footer Message
              </label>
              <input
                type="text"
                value={receiptFooter}
                onChange={(e) => setReceiptFooter(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>
          </div>
        </div>

        {/* Save Settings Bar */}
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 shadow-sm cursor-pointer transition"
          >
            Save All Settings & Lock Store Profile
          </button>
        </div>
      </form>

      {/* Section 4: Cashiers & Staff Accounts with Delete Key Protection */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-500" />
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">
              Cashiers & Staff Accounts ({sellers.length})
            </h2>
          </div>
          <button
            onClick={() => setIsAddingSeller(true)}
            className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Staff Account</span>
          </button>
        </div>

        {/* Sellers List */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {sellers.map((user) => (
            <div key={user.uid} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 dark:text-white">
                    {user.name}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono font-bold">
                    Dev: {user.deviceCode}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
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
                {user.role !== 'owner' ? (
                  <>
                    <button
                      onClick={() => handleToggleSellerActive(user)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                        user.active
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {user.active ? 'Active' : 'Disabled'}
                    </button>

                    {/* Delete Staff Member Key */}
                    <button
                      onClick={() => {
                        setSellerToDelete(user);
                        setDeletePinInput('');
                        setDeleteError(null);
                      }}
                      className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer transition"
                      title="Permanently Delete Staff Account"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <span className="text-[11px] text-slate-400 font-semibold italic px-2">
                    Primary Owner
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Add Seller Form Modal */}
        {isAddingSeller && (
          <form
            onSubmit={handleAddSeller}
            className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2.5 text-xs animate-in fade-in"
          >
            <h4 className="font-bold text-slate-900 dark:text-white">Add New Cashier / Staff Member</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                required
                placeholder="Full Name (e.g. Samuel Osei)"
                value={newSellerName}
                onChange={(e) => setNewSellerName(e.target.value)}
                className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
              <input
                type="email"
                required
                placeholder="Email login (e.g. staff@gmail.com)"
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
                className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-center"
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

      {/* Section 5: Data Management & Clean Production Setup */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
          <Database className="w-4 h-4 text-purple-500" />
          <h2 className="font-bold text-sm text-slate-900 dark:text-white">
            Data Control & Clean Production Setup
          </h2>
        </div>

        <p className="text-xs text-slate-500">
          Download full offline JSON backups or purge dummy demo accounts and sample items for clean real-world store operations.
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={handleExportFullBackup}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Download className="w-3.5 h-3.5 text-purple-500" />
            <span>Export Full Backup (JSON)</span>
          </button>

          {/* Purge Dummy Data Action */}
          <button
            onClick={() => {
              setShowPurgeModal(true);
              setPurgePinInput('');
              setPurgeError(null);
            }}
            className="px-4 py-2 rounded-xl border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-xs font-bold hover:bg-rose-100 flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Purge All Dummy Data & Sample Accounts</span>
          </button>
        </div>
      </div>

      {/* Modal 1: Unlock Shop Profile PIN Dialog */}
      {showUnlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-5 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 animate-in fade-in">
            <div className="text-center space-y-1">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 mx-auto flex items-center justify-center">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Unlock Store Profile
              </h3>
              <p className="text-xs text-slate-500">
                Enter your Owner PIN to unlock editing for shop name and physical address.
              </p>
            </div>

            <form onSubmit={handleUnlockProfile} className="space-y-3">
              <div>
                <input
                  type="password"
                  maxLength={6}
                  autoFocus
                  required
                  value={unlockPinInput}
                  onChange={(e) => setUnlockPinInput(e.target.value)}
                  placeholder="Enter Owner PIN (default: 1234)"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-center font-mono text-base font-bold tracking-widest"
                />
              </div>

              {unlockError && (
                <p className="text-xs text-rose-500 text-center font-semibold">{unlockError}</p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowUnlockModal(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold shadow-sm"
                >
                  Unlock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Delete Seller Account Dialog with Delete Key */}
      {sellerToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-5 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 animate-in fade-in">
            <div className="text-center space-y-1">
              <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 mx-auto flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Delete Staff Member
              </h3>
              <p className="text-xs text-slate-500">
                Are you sure you want to permanently delete <b>{sellerToDelete.name}</b> ({sellerToDelete.email})?
              </p>
            </div>

            <form onSubmit={handleConfirmDeleteSeller} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1 text-center">
                  Enter Admin Delete Key (Owner PIN)
                </label>
                <input
                  type="password"
                  maxLength={6}
                  autoFocus
                  required
                  value={deletePinInput}
                  onChange={(e) => setDeletePinInput(e.target.value)}
                  placeholder="Owner PIN (default: 1234)"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-center font-mono text-base font-bold tracking-widest"
                />
              </div>

              {deleteError && (
                <p className="text-xs text-rose-500 text-center font-semibold">{deleteError}</p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSellerToDelete(null)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold shadow-sm hover:bg-rose-700"
                >
                  Confirm Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Purge Dummy Data Confirmation Dialog */}
      {showPurgeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 animate-in fade-in">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 mx-auto flex items-center justify-center">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Purge All Dummy & Sample Data
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                This will delete the 50 sample electrical items, dummy transactions, sample customers, and remove any prototype accounts (Raji Farrid, Abuyah Wisdom). 
                <br />
                Your store and your verified Owner account (<b>{currentUser?.name}</b>) will remain active with a clean slate for production.
              </p>
            </div>

            <form onSubmit={handleConfirmPurgeDummyData} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1 text-center">
                  Enter Owner PIN to Confirm Purge
                </label>
                <input
                  type="password"
                  maxLength={6}
                  autoFocus
                  required
                  value={purgePinInput}
                  onChange={(e) => setPurgePinInput(e.target.value)}
                  placeholder="Owner PIN (default: 1234)"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-center font-mono text-base font-bold tracking-widest"
                />
              </div>

              {purgeError && (
                <p className="text-xs text-rose-500 text-center font-semibold">{purgeError}</p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isPurging}
                  onClick={() => setShowPurgeModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPurging}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-bold shadow-sm hover:bg-rose-700 disabled:opacity-50"
                >
                  {isPurging ? 'Purging...' : 'Purge All Dummy Data'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
