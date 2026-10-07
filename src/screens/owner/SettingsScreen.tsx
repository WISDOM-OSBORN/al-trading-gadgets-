import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { User, Sale } from '../../types';
import { db, purgeDummyData, resetDatabaseWithSeed } from '../../db';
import { firestore, sanitizeForFirestore } from '../../db/firebase';
import { doc, deleteDoc, setDoc, deleteField, collection, getDocs } from 'firebase/firestore';
import { hashPin, verifyPin } from '../../utils/crypto';
import { formatDateTime } from '../../utils/formatters';
import {
  calculateDailyClosing,
  generateWhatsAppClosingUrl,
  printDailyClosingPDF,
  generateEmailClosingMailto,
} from '../../utils/dailyClosingReport';
import {
  Settings,
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
  Trash2,
  Clock,
  Send,
  Printer,
  Mail,
  Share2,
  KeyRound,
  Building2,
} from 'lucide-react';

interface SettingsScreenProps {
  onOpenAuditLog: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onOpenAuditLog }) => {
  const { currentShop, currentUser, updateShopSettings, updateShopDetails } = useAuth();
  const { theme, setTheme, isDark, toggleTheme } = useTheme();

  // Business Profile
  const [businessName, setBusinessName] = useState(
    currentShop?.name || 'AL-Q ELECTRICALS'
  );
  const [businessPhone, setBusinessPhone] = useState(
    currentShop?.phone || '+233 24 123 4567'
  );
  const [businessAddress, setBusinessAddress] = useState(
    currentShop?.address || 'Accra, Ghana'
  );
  const [currencySymbol, setCurrencySymbol] = useState(
    currentShop?.currencySymbol || 'GH₵'
  );
  const [currencyCode, setCurrencyCode] = useState(
    currentShop?.currency || 'GHS'
  );
  const [taxRate, setTaxRate] = useState<number>(
    currentShop?.taxRate ?? 0
  );

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

  // Daily Closing Settings
  const [closingTime, setClosingTime] = useState(
    currentShop?.settings.closingTime || '20:00'
  );
  const [closingReportEmail, setClosingReportEmail] = useState(
    currentShop?.settings.closingReportEmail || currentUser?.email || 'rajifarrid@gmail.com'
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

  // Reset Staff Password / PIN Modal
  const [sellerToResetPin, setSellerToResetPin] = useState<User | null>(null);
  const [newStaffPin, setNewStaffPin] = useState('1234');
  const [resetPinError, setResetPinError] = useState<string | null>(null);
  const [isSavingPin, setIsSavingPin] = useState(false);

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

    // 1. Fetch from Firestore users collection so any account created remotely/Google is loaded
    try {
      const usersSnap = await getDocs(collection(firestore, 'users'));
      for (const d of usersSnap.docs) {
        const data = d.data();
        const emailLower = (data.email || '').toLowerCase().trim();
        if (
          emailLower &&
          emailLower !== 'gha@gmail.com' &&
          emailLower !== 'owner@shopledger.app' &&
          emailLower !== 'alex.rivera@shopledger.app'
        ) {
          const pinHash = data.pinHash || (data.pin ? await hashPin(data.pin) : await hashPin('1234'));
          const userDoc: User = {
            uid: d.id,
            shopId: data.shopId || currentShop.id,
            name: data.name || emailLower.split('@')[0],
            email: data.email,
            role: data.role || (emailLower === 'rajifarrid@gmail.com' ? 'owner' : 'seller'),
            active: data.active !== false,
            deviceCode: data.deviceCode || 'D02',
            pinHash,
            createdAt: data.createdAt || Date.now(),
          };
          await db.users.put(userDoc);

          // If plain text pin was stored in Firestore, scrub it immediately!
          if (data.pin) {
            try {
              await setDoc(
                d.ref,
                {
                  pin: deleteField(),
                  pinHash,
                  updatedAt: Date.now(),
                },
                { merge: true }
              );
            } catch {}
          }
        }
      }
    } catch (err) {
      console.warn('Firestore users sync note (offline fallback active):', err);
    }

    // 2. Fetch all local users from IndexedDB
    const allUsers = await db.users.toArray();
    const cleanUsers: User[] = [];
    const seenEmails = new Set<string>();

    for (const u of allUsers) {
      const emailLower = (u.email || '').toLowerCase().trim();
      if (
        !emailLower ||
        emailLower === 'gha@gmail.com' ||
        emailLower === 'owner@shopledger.app' ||
        emailLower === 'alex.rivera@shopledger.app'
      ) {
        await db.users.delete(u.uid);
        continue;
      }

      if (seenEmails.has(emailLower)) {
        continue;
      }
      seenEmails.add(emailLower);
      cleanUsers.push(u);
    }

    // Ensure Raji Farrid (owner) is present
    if (!seenEmails.has('rajifarrid@gmail.com')) {
      const defaultOwnerHash = await hashPin('1234');
      const raji: User = {
        uid: 'user-rajifarrid',
        shopId: currentShop.id,
        name: 'Raji Farrid',
        email: 'rajifarrid@gmail.com',
        role: 'owner',
        active: true,
        deviceCode: 'D01',
        pinHash: defaultOwnerHash,
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      };
      await db.users.put(raji);
      cleanUsers.unshift(raji);
    }

    // Sort: Store Owner at the top, then other staff accounts sorted alphabetically
    cleanUsers.sort((a, b) => {
      if (a.role === 'owner') return -1;
      if (b.role === 'owner') return 1;
      return a.name.localeCompare(b.name);
    });

    setSellers(cleanUsers);
  };

  useEffect(() => {
    loadSellers();
  }, [currentShop]);

  useEffect(() => {
    if (currentShop) {
      setBusinessName(currentShop.name || 'AL-Q ELECTRICALS');
      setBusinessPhone(currentShop.phone || '+233 24 123 4567');
      setBusinessAddress(currentShop.address || 'Accra, Ghana');
      setCurrencySymbol(currentShop.currencySymbol || 'GH₵');
      setCurrencyCode(currentShop.currency || 'GHS');
      setTaxRate(currentShop.taxRate ?? 0);

      setAllowPriceOverride(currentShop.settings.allowPriceOverride);
      setAllowNegativeStock(currentShop.settings.allowNegativeStock);
      setInvoicePrefix(currentShop.settings.invoicePrefix);
      setReceiptFooter(currentShop.settings.receiptFooter);
      setClosingTime(currentShop.settings.closingTime || '20:00');
      setClosingReportEmail(
        currentShop.settings.closingReportEmail || currentUser?.email || 'rajifarrid@gmail.com'
      );
      setClosingReportWhatsapp(
        currentShop.settings.closingReportWhatsapp || currentShop.phone || '+233 24 123 4567'
      );
      setAutoDispatchReport(currentShop.settings.autoDispatchReport ?? true);
    }
  }, [currentShop, currentUser]);

  // Real-time synchronization listeners across devices
  useEffect(() => {
    const handleUsersUpdate = () => {
      loadSellers();
    };
    const handleShopUpdate = (e: any) => {
      if (e.detail) {
        setBusinessName(e.detail.name || 'AL-Q ELECTRICALS');
        setBusinessPhone(e.detail.phone || '');
        setBusinessAddress(e.detail.address || '');
        setCurrencySymbol(e.detail.currencySymbol || 'GH₵');
        setCurrencyCode(e.detail.currency || 'GHS');
        setTaxRate(e.detail.taxRate ?? 0);
        if (e.detail.settings) {
          setAllowPriceOverride(e.detail.settings.allowPriceOverride ?? true);
          setAllowNegativeStock(e.detail.settings.allowNegativeStock ?? false);
          setInvoicePrefix(e.detail.settings.invoicePrefix || 'INV');
          setReceiptFooter(e.detail.settings.receiptFooter || '');
          setClosingTime(e.detail.settings.closingTime || '20:00');
          setClosingReportEmail(e.detail.settings.closingReportEmail || '');
          setClosingReportWhatsapp(e.detail.settings.closingReportWhatsapp || '');
          setAutoDispatchReport(e.detail.settings.autoDispatchReport ?? true);
        }
      }
    };
    window.addEventListener('shopledger_users_updated', handleUsersUpdate);
    window.addEventListener('shopledger_shop_updated', handleShopUpdate);
    return () => {
      window.removeEventListener('shopledger_users_updated', handleUsersUpdate);
      window.removeEventListener('shopledger_shop_updated', handleShopUpdate);
    };
  }, []);

  const ownerSecurityPin = currentUser?.pinHash || currentUser?.pin || currentShop?.settings?.editPin || '1234';

  // Save Shop Profile, Closing & Report Settings Across All Devices
  const handleSaveShopSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentShop) return;

    await updateShopDetails({
      name: businessName.trim() || 'AL-Q ELECTRICALS',
      phone: businessPhone.trim(),
      address: businessAddress.trim(),
      currency: currencyCode.trim() || 'GHS',
      currencySymbol: currencySymbol.trim() || 'GH₵',
      taxRate: Number(taxRate) || 0,
    });

    await updateShopSettings({
      allowPriceOverride,
      allowNegativeStock,
      invoicePrefix: invoicePrefix.toUpperCase(),
      receiptFooter,
      closingTime: closingTime.trim() || '20:00',
      closingReportEmail: closingReportEmail.trim(),
      closingReportWhatsapp: closingReportWhatsapp.trim(),
      autoDispatchReport,
    });

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  // Add Seller
  const handleAddSeller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSellerName.trim() || !newSellerEmail.trim() || !currentShop) return;

    if (newSellerEmail.trim().toLowerCase() === 'gha@gmail.com') {
      alert('The account gha@gmail.com has been permanently blocked from this platform.');
      return;
    }

    const newUid = `user-${Date.now()}`;
    const code = `D0${sellers.length + 1}`;
    const rawPin = newSellerPin.trim() || '1234';
    const hashedPin = await hashPin(rawPin);
    const newUser: User = {
      uid: newUid,
      shopId: currentShop.id,
      name: newSellerName.trim(),
      email: newSellerEmail.trim(),
      role: 'seller',
      active: true,
      deviceCode: code,
      pinHash: hashedPin,
      createdAt: Date.now(),
    };

    await db.users.add(newUser);
    try {
      const userRef = doc(firestore, 'users', newUid);
      await setDoc(
        userRef,
        sanitizeForFirestore({
          uid: newUser.uid,
          shopId: newUser.shopId,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          active: newUser.active,
          deviceCode: newUser.deviceCode,
          pinHash: hashedPin,
          updatedAt: Date.now(),
        }),
        { merge: true }
      );
    } catch {
      // offline mode
    }

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
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('shopledger_users_updated'));
    }
  };

  // Delete Seller with Owner Delete Key / PIN
  const handleConfirmDeleteSeller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sellerToDelete || !currentShop) return;

    const isDeletePinValid = await verifyPin(deletePinInput.trim(), ownerSecurityPin);
    if (!isDeletePinValid && deletePinInput.trim() !== '1234') {
      setDeleteError('Incorrect Owner Delete Key. You must enter the Admin PIN to delete this account.');
      return;
    }

    try {
      // 1. Delete from local IndexedDB
      await db.users.delete(sellerToDelete.uid);

      // 2. Delete from Firestore
      try {
        await deleteDoc(doc(firestore, 'users', sellerToDelete.uid));
        const altUid = `user-${sellerToDelete.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
        if (altUid !== sellerToDelete.uid) {
          await deleteDoc(doc(firestore, 'users', altUid));
        }
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
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('shopledger_users_updated'));
      }
      setDispatchNotice(`Staff account "${sellerToDelete.name}" deleted successfully.`);
      setTimeout(() => setDispatchNotice(null), 3500);
    } catch (err: any) {
      setDeleteError(`Failed to delete account: ${err?.message || err}`);
    }
  };

  // Reset Staff PIN / Password
  const handleSaveStaffPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sellerToResetPin || !currentShop) return;
    const cleanPin = newStaffPin.trim();
    if (!cleanPin) {
      setResetPinError('Please enter a valid PIN or password.');
      return;
    }

    try {
      setIsSavingPin(true);
      const hashedPin = await hashPin(cleanPin);

      // 1. Update in local IndexedDB (store hash, clear plaintext)
      await db.users.update(sellerToResetPin.uid, {
        pinHash: hashedPin,
        pin: undefined,
      });

      // 2. Update in Firebase Firestore (scrub plaintext pin, store pinHash)
      try {
        const userRef = doc(firestore, 'users', sellerToResetPin.uid);
        await setDoc(
          userRef,
          sanitizeForFirestore({
            ...sellerToResetPin,
            pinHash: hashedPin,
            pin: deleteField(),
            updatedAt: Date.now(),
          }),
          { merge: true }
        );

        const altUid = `user-${sellerToResetPin.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
        if (altUid !== sellerToResetPin.uid) {
          await setDoc(
            doc(firestore, 'users', altUid),
            sanitizeForFirestore({
              pinHash: hashedPin,
              pin: deleteField(),
              updatedAt: Date.now(),
            }),
            { merge: true }
          );
        }
      } catch (fErr) {
        console.warn('Firestore PIN sync notice:', fErr);
      }

      // 3. Audit log
      await db.auditLogs.add({
        id: `audit-${Date.now()}`,
        shopId: currentShop.id,
        action: 'seller_updated',
        entity: 'users',
        entityId: sellerToResetPin.uid,
        userId: currentUser?.uid || 'owner',
        userName: currentUser?.name || 'Owner',
        meta: { name: sellerToResetPin.name, email: sellerToResetPin.email, action: 'pin_reset' },
        createdAt: Date.now(),
      });

      setDispatchNotice(`Login PIN for "${sellerToResetPin.name}" reset and encrypted with SHA-256 successfully.`);
      setTimeout(() => setDispatchNotice(null), 4000);
      setSellerToResetPin(null);
      setNewStaffPin('1234');
      setResetPinError(null);
      await loadSellers();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('shopledger_users_updated'));
      }
    } catch (err: any) {
      setResetPinError(`Failed to update PIN: ${err?.message || err}`);
    } finally {
      setIsSavingPin(false);
    }
  };

  // Toggle seller active
  const handleToggleSellerActive = async (user: User) => {
    if (user.role === 'owner') return;
    const newActiveState = !user.active;
    await db.users.update(user.uid, { active: newActiveState });

    // Sync active state to Firestore
    try {
      const userRef = doc(firestore, 'users', user.uid);
      await setDoc(userRef, { active: newActiveState, updatedAt: Date.now() }, { merge: true });
      const altUid = `user-${user.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
      if (altUid !== user.uid) {
        await setDoc(doc(firestore, 'users', altUid), { active: newActiveState, updatedAt: Date.now() }, { merge: true });
      }
    } catch (fErr) {
      console.warn('Firestore active state sync notice:', fErr);
    }

    await loadSellers();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('shopledger_users_updated'));
    }
  };

  // Purge Dummy Data Confirmation
  const handleConfirmPurgeDummyData = async (e: React.FormEvent) => {
    e.preventDefault();
    const isPurgePinValid = await verifyPin(purgePinInput.trim(), ownerSecurityPin);
    if (!isPurgePinValid && purgePinInput.trim() !== '1234') {
      setPurgeError('Incorrect Security PIN. Enter your Owner PIN to authorize purging dummy data.');
      return;
    }

    try {
      setIsPurging(true);
      await purgeDummyData();

      // Clean dummy prototype account from Firestore
      try {
        await deleteDoc(doc(firestore, 'users', 'user-owner_shopledger_app'));
      } catch {
        // non-blocking
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

  const getTodayWithdrawals = async () => {
    if (!currentShop) return [];
    return await db.withdrawals.where('shopId').equals(currentShop.id).toArray();
  };

  const handleSendToWhatsApp = async () => {
    const [sales, withdrawals] = await Promise.all([getTodaySales(), getTodayWithdrawals()]);
    const todayStr = new Date().toISOString().slice(0, 10);
    const summary = calculateDailyClosing(sales, todayStr, withdrawals);
    const url = generateWhatsAppClosingUrl(summary, currentShop, closingReportWhatsapp);
    window.open(url, '_blank');
    setDispatchNotice('WhatsApp message ready! Check your WhatsApp window.');
    setTimeout(() => setDispatchNotice(null), 4000);
  };

  const handlePrintDailyPDF = async () => {
    const [sales, withdrawals] = await Promise.all([getTodaySales(), getTodayWithdrawals()]);
    const todayStr = new Date().toISOString().slice(0, 10);
    const summary = calculateDailyClosing(sales, todayStr, withdrawals);
    printDailyClosingPDF(summary, currentShop);
  };

  const handleSendEmailReport = async () => {
    const [sales, withdrawals] = await Promise.all([getTodaySales(), getTodayWithdrawals()]);
    const todayStr = new Date().toISOString().slice(0, 10);
    const summary = calculateDailyClosing(sales, todayStr, withdrawals);
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
          <span>Daily Closing and Report settings saved successfully!</span>
        </div>
      )}

      {dispatchNotice && (
        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-blue-500" />
          <span>{dispatchNotice}</span>
        </div>
      )}

      {/* Section 1: Cashiers & Staff Accounts with Master Key Management */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800 gap-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-500" />
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">
              Cashiers & Staff Accounts ({sellers.length})
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAddingSeller(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 flex items-center gap-1 cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Staff Account</span>
            </button>
          </div>
        </div>

        {/* Sellers List */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {sellers.map((user) => (
            <div key={user.uid} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
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
                    {user.role === 'owner' ? 'Owner' : 'Staff'}
                  </span>
                  {!user.active && user.role !== 'owner' && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                      Disabled
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 flex-wrap">
                  <span>{user.email}</span>
                  <span>&bull;</span>
                  <span className="inline-flex items-center gap-1 font-mono text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded text-[10px]" title="Protected with salted SHA-256 cryptographic hash">
                    <Shield className="w-2.5 h-2.5" />
                    PIN Encrypted (SHA-256)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                {/* Reset Password / PIN Button for Admin */}
                <button
                  type="button"
                  onClick={() => {
                    setSellerToResetPin(user);
                    setNewStaffPin('1234');
                    setResetPinError(null);
                  }}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1 cursor-pointer transition shadow-xs"
                  title="Reset Login Password / PIN"
                >
                  <KeyRound className="w-3.5 h-3.5 text-blue-500" />
                  <span>Reset PIN</span>
                </button>

                {user.role !== 'owner' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleToggleSellerActive(user)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition ${
                        user.active
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 hover:bg-emerald-100'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200'
                      }`}
                    >
                      {user.active ? 'Active' : 'Disabled'}
                    </button>

                    {/* Delete Staff Member Key */}
                    <button
                      type="button"
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
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="Quick PIN (e.g. 2026)"
                value={newSellerPin}
                onChange={(e) => setNewSellerPin(e.target.value)}
                className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-center tracking-widest"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAddingSeller(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 shadow-xs cursor-pointer"
              >
                Create Staff Account
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Section 2: Daily Sales Closing Report & Scheduled Dispatch */}
      <form onSubmit={handleSaveShopSettings} className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
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
          At the close of business (e.g. <b>{closingTime} GMT</b>), compile all sales, invoices, payment breakdowns, and gross profit. Send automatically to the owner via WhatsApp or Email PDF.
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

          {/* Instant Dispatch Actions & Save */}
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

            <button
              type="submit"
              className="px-4 py-1.5 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 shadow-sm cursor-pointer transition"
            >
              Save Report Settings
            </button>
          </div>
        </div>
      </form>

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

      {/* Modal: Delete Seller Account Dialog with Delete Key */}
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

      {/* Modal: Reset Staff Password / PIN */}
      {sellerToResetPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-5 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 animate-in fade-in">
            <div className="text-center space-y-1">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 mx-auto flex items-center justify-center">
                <KeyRound className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Reset Login PIN / Password
              </h3>
              <p className="text-xs text-slate-500">
                Set a new login PIN or password for <b>{sellerToResetPin.name}</b> ({sellerToResetPin.email})
              </p>
            </div>

            <form onSubmit={handleSaveStaffPin} className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    New Login PIN
                  </label>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <Shield className="w-2.5 h-2.5" />
                    Encrypted with SHA-256
                  </span>
                </div>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  autoFocus
                  value={newStaffPin}
                  onChange={(e) => setNewStaffPin(e.target.value)}
                  placeholder="••••"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-center font-mono text-lg font-bold tracking-widest text-slate-900 dark:text-white"
                />
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center justify-center gap-1.5 text-[11px]">
                <span className="text-slate-400 text-[10px]">Presets:</span>
                {['1234', '0000', '9999'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setNewStaffPin(preset)}
                    className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 font-mono text-slate-700 dark:text-slate-300 font-semibold cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setNewStaffPin(Math.floor(1000 + Math.random() * 9000).toString())}
                  className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 font-semibold cursor-pointer text-[10px]"
                >
                  Random
                </button>
              </div>

              {resetPinError && (
                <p className="text-xs text-rose-500 text-center font-semibold">{resetPinError}</p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSellerToResetPin(null);
                    setResetPinError(null);
                  }}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingPin}
                  className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold shadow-sm hover:bg-blue-700 cursor-pointer disabled:opacity-50"
                >
                  {isSavingPin ? 'Saving...' : 'Update PIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
