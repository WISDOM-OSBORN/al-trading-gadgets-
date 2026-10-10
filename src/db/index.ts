import Dexie, { type Table } from 'dexie';
import {
  Shop,
  User,
  Item,
  Sale,
  StockMovement,
  Customer,
  CustomerPayment,
  InventoryImportHistory,
  AuditLog,
  SyncQueueItem,
  DailyClosingReport,
  OwnerWithdrawal,
} from '../types';
import { INITIAL_GADGETS, SEED_SHOP_ID } from './seedData';
import { firestore } from './firebase';
import { collection, getDocs, doc, deleteDoc, deleteField, setDoc } from 'firebase/firestore';
import { hashPin } from '../utils/crypto';
import { applyStockChangeTx, assertWholeNumber, newId } from './stock';
import { scheduleSync } from './sync';

export class ShopLedgerDatabase extends Dexie {
  shops!: Table<Shop, string>;
  users!: Table<User, string>;
  items!: Table<Item, string>;
  sales!: Table<Sale, string>;
  stockMovements!: Table<StockMovement, string>;
  customers!: Table<Customer, string>;
  customerPayments!: Table<CustomerPayment, string>;
  imports!: Table<InventoryImportHistory, string>;
  auditLogs!: Table<AuditLog, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  dailyReports!: Table<DailyClosingReport, string>;
  withdrawals!: Table<OwnerWithdrawal, string>;

  constructor() {
    super('ShopLedgerDB');
    this.version(1).stores({
      shops: 'id',
      users: 'uid, shopId, email, role, active',
      items: 'id, shopId, sku, barcode, name, category, quantity, reorderLevel, archived, isFavorite',
      sales: 'id, invoiceNo, shopId, sellerId, status, createdAtClient, syncedAt, deviceCode',
      stockMovements: 'id, shopId, itemId, type, createdAt',
      customers: 'id, shopId, name, phone, balanceOwed',
      customerPayments: 'id, shopId, customerId, createdAt',
      imports: 'id, shopId, createdAt',
      auditLogs: 'id, shopId, action, entity, userId, createdAt',
      syncQueue: 'id, entity, action, status, createdAt',
      dailyReports: 'id, shopId, sellerId, dateStr, isClosed',
      withdrawals: 'id, shopId, itemId, createdAt',
    });
  }
}

export const db = new ShopLedgerDatabase();

export const DESIGNATED_TEAM_ACCOUNTS: Omit<User, 'createdAt'>[] = [
  {
    uid: 'user-rajifarrid',
    shopId: SEED_SHOP_ID,
    name: 'Raji Farrid',
    email: 'rajifarrid@gmail.com',
    role: 'owner',
    active: true,
    deviceCode: 'D01',
    pinHash: '', // populated with hashPin('1234') on init
  },
  {
    uid: 'user-wisdomosborn',
    shopId: SEED_SHOP_ID,
    name: 'Wisdom Osborn',
    email: 'wisdomosborn65@gmail.com',
    role: 'owner',
    active: true,
    deviceCode: 'D01',
    pinHash: '', // populated with hashPin('1234') on init
  },
  {
    uid: 'user-abuyahwisdomosborn',
    shopId: SEED_SHOP_ID,
    name: 'Abuyah Wisdom Osborn',
    email: 'abuyahwisdomosborn@gmail.com',
    role: 'seller',
    active: true,
    deviceCode: 'D02',
    pinHash: '', // populated with hashPin('1234') on init
  },
];

// Initialize default store data locally and INSTANTLY (<10ms) without blocking on network roundtrips
export async function initializeDatabase() {
  const shopCount = await db.shops.count();
  const defaultPinHash = await hashPin('1234');

  if (shopCount === 0) {
    const defaultShop: Shop = {
      id: SEED_SHOP_ID,
      name: 'AL-Q ELECTRICALS',
      currency: 'GHS',
      currencySymbol: 'GH₵',
      phone: '+233 24 123 4567',
      address: 'Spintex Road, Accra, Ghana',
      taxRate: 0,
      settings: {
        allowPriceOverride: true,
        allowNegativeStock: false,
        invoicePrefix: 'INV',
        receiptFooter: 'Thank you for shopping at AL-Q ELECTRICALS! Quality electrical gadgets & accessories.',
        lowStockThresholdDefault: 8,
        taxRatePercent: 0,
      },
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    };
    await db.shops.add(defaultShop);
  } else {
    // Ensure existing shop maintains AL-Q ELECTRICALS branding & GHS currency
    const existing = await db.shops.toCollection().first();
    if (existing) {
      await db.shops.update(existing.id, {
        name: 'AL-Q ELECTRICALS',
        currency: 'GHS',
        currencySymbol: 'GH₵',
      });
    }
  }

  // 2. Ensure all pre-configured business accounts (Raji Farrid, Wisdom Osborn, Abuyah Wisdom Osborn) exist
  const existingShop = await db.shops.toCollection().first();
  const targetShopId = existingShop?.id || SEED_SHOP_ID;

  for (const acct of DESIGNATED_TEAM_ACCOUNTS) {
    const existingUser = await db.users.where('email').equalsIgnoreCase(acct.email).first();
    if (!existingUser) {
      await db.users.put({
        ...acct,
        shopId: targetShopId,
        pinHash: defaultPinHash,
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      });
    } else {
      // Ensure role, active status, and pinHash are updated
      await db.users.update(existingUser.uid, {
        name: acct.name,
        role: acct.role,
        active: true,
        deviceCode: acct.deviceCode,
        pinHash: existingUser.pinHash || defaultPinHash,
      });
    }
  }

  // 3. Remove blocked / deprecated accounts
  const blockedEmails = [
    'gha@gmail.com',
    'owner@shopledger.app',
    'alex.rivera@shopledger.app',
  ];
  const allUsers = await db.users.toArray();
  for (const u of allUsers) {
    const emailLower = (u.email || '').toLowerCase().trim();
    if (blockedEmails.includes(emailLower)) {
      await db.users.delete(u.uid);
    }
  }

  // 4. Ensure initial gadgets catalog is present if items table is empty
  const currentItemCount = await db.items.count();
  const wasPurged = localStorage.getItem('shopledger_last_purged_at');
  if (currentItemCount === 0 && !wasPurged) {
    const now = Date.now();
    const itemRecords: Item[] = INITIAL_GADGETS.map((g, idx) => ({
      ...g,
      id: `item-${idx + 1}`,
      shopId: targetShopId,
      createdAt: now - 20 * 24 * 60 * 60 * 1000,
      updatedAt: now,
    }));
    await db.items.bulkPut(itemRecords);
  }

  // 5. Non-blocking asynchronous cloud hydration in background
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    setTimeout(() => {
      syncUsersFromFirestore().catch(() => {});
    }, 100);
  }
}

// Asynchronously pull registered workers from Firestore in the background without blocking page load
export async function syncUsersFromFirestore(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return;
  }

  const blockedEmails = [
    'gha@gmail.com',
    'owner@shopledger.app',
    'alex.rivera@shopledger.app',
  ];

  try {
    const snap = await getDocs(collection(firestore, 'users'));
    for (const docSnap of snap.docs) {
      const uData = docSnap.data() as User;
      const emailLower = (uData?.email || '').toLowerCase().trim();
      if (uData && emailLower && !blockedEmails.includes(emailLower)) {
        const pinHash = uData.pinHash || (uData.pin ? await hashPin(uData.pin) : await hashPin('1234'));
        await db.users.put({
          ...uData,
          uid: docSnap.id,
          pinHash,
        });

        // Scrub any legacy plaintext PIN from Firestore
        if (uData.pin) {
          try {
            await setDoc(
              docSnap.ref,
              { pin: deleteField(), pinHash, updatedAt: Date.now() },
              { merge: true }
            );
          } catch {}
        }
      } else if (emailLower && blockedEmails.includes(emailLower)) {
        await db.users.delete(docSnap.id);
        try {
          await deleteDoc(docSnap.ref);
        } catch {}
      }
    }
  } catch (err) {
    console.warn('Background users sync notice (offline mode active):', err);
  }
}

// Purge all cashier and staff accounts created by mistake (keeps store owners and designated seller)
export async function deleteAllCashierStaffAccounts(): Promise<number> {
  let count = 0;
  const isProtected = (email?: string) => {
    const l = (email || '').toLowerCase().trim();
    return (
      l === 'rajifarrid@gmail.com' ||
      l === 'wisdomosborn65@gmail.com' ||
      l === 'abuyahwisdomosborn@gmail.com'
    );
  };

  // 1. Delete all non-protected staff from local Dexie
  const localUsers = await db.users.toArray();
  for (const u of localUsers) {
    if (!isProtected(u.email) && u.role !== 'owner') {
      await db.users.delete(u.uid);
      count++;
    }
  }

  // 2. Delete all non-protected staff from Firestore
  try {
    const snap = await getDocs(collection(firestore, 'users'));
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const email = (data.email || '').toLowerCase().trim();
      if (!isProtected(email) && data.role !== 'owner') {
        await deleteDoc(doc(firestore, 'users', docSnap.id));
        count++;
      }
    }
  } catch (err) {
    console.warn('Error deleting mistake accounts from Firestore:', err);
  }

  return count;
}

// Record Owner Withdrawal: Owner takes out inventory for personal use/store maintenance
export async function recordOwnerWithdrawal(params: {
  shopId: string;
  itemId: string;
  quantity: number;
  reason: string;
  userId: string;
  userName: string;
}): Promise<OwnerWithdrawal> {
  assertWholeNumber(params.quantity, 'Quantity');
  if (params.quantity < 1) throw new Error('Quantity must be at least 1.');
  const now = Date.now();
  let record!: OwnerWithdrawal;

  await db.transaction('rw',
    [db.items, db.stockMovements, db.withdrawals, db.auditLogs, db.syncQueue],
    async () => {
      const item = await db.items.get(params.itemId);
      if (!item) throw new Error('Item not found in inventory.');
      const withdrawalId = newId('with');
      const mv = await applyStockChangeTx({
        shopId: params.shopId,
        itemId: item.id,
        delta: -params.quantity,
        type: 'withdrawal',
        reason: `Owner Withdrawal: ${params.reason}`,
        refId: withdrawalId,
        userId: params.userId,
        userName: params.userName,
        now,
      });
      record = {
        id: withdrawalId,
        shopId: params.shopId,
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku,
        quantity: params.quantity,
        costPrice: item.costPrice || 0,
        sellingPrice: item.sellingPrice || 0,
        totalCostValue: (item.costPrice || 0) * params.quantity,
        reason: params.reason || 'Owner Withdrawal',
        userId: params.userId,
        userName: params.userName,
        createdAt: now,
      };
      await db.withdrawals.add(record);
      await db.auditLogs.add({
        id: newId('audit'),
        shopId: params.shopId,
        action: 'stock_adjusted',
        entity: 'items',
        entityId: item.id,
        userId: params.userId,
        userName: params.userName,
        meta: {
          action: 'owner_withdrawal',
          quantityWithdrawn: params.quantity,
          remainingStock: mv.newQty,
          costValue: record.totalCostValue,
          reason: params.reason,
        },
        createdAt: now,
      });
      await db.syncQueue.add({
        id: newId('sync'),
        entity: 'withdrawal',
        action: 'create',
        payload: record,
        attempts: 0,
        status: 'pending',
        createdAt: now,
      });
    });

  scheduleSync();
  return record;
}

// Purge dummy/sample inventory, sales, and dummy accounts for clean production
export async function purgeDummyData(): Promise<void> {
  const purgeTimestamp = Date.now();
  await db.transaction('rw', [
    db.items,
    db.sales,
    db.stockMovements,
    db.customers,
    db.customerPayments,
    db.imports,
    db.dailyReports,
    db.users,
  ], async () => {
    await db.items.clear();
    await db.sales.clear();
    await db.stockMovements.clear();
    await db.customers.clear();
    await db.customerPayments.clear();
    await db.imports.clear();
    await db.dailyReports.clear();

    // Delete all accounts except rajifarrid@gmail.com
    const allUsers = await db.users.toArray();
    let keptRaji = false;
    for (const u of allUsers) {
      if (u.email?.toLowerCase() === 'rajifarrid@gmail.com' && !keptRaji) {
        keptRaji = true;
      } else {
        await db.users.delete(u.uid);
      }
    }
  });

  localStorage.setItem('shopledger_last_purged_at', purgeTimestamp.toString());

  // Also purge from Cloud Firestore so all other devices wipe dummy records
  try {
    // 1. Delete all items from Firestore
    const itemsSnap = await getDocs(collection(firestore, 'items'));
    for (const d of itemsSnap.docs) {
      try {
        await deleteDoc(d.ref);
      } catch {}
    }

    // 2. Delete all sales from Firestore
    const salesSnap = await getDocs(collection(firestore, 'sales'));
    for (const d of salesSnap.docs) {
      try {
        await deleteDoc(d.ref);
      } catch {}
    }

    // 3. Delete all imports from Firestore
    const importsSnap = await getDocs(collection(firestore, 'imports'));
    for (const d of importsSnap.docs) {
      try {
        await deleteDoc(d.ref);
      } catch {}
    }

    // 4. Update shop document in Firestore with purge timestamp
    const shopRef = doc(firestore, 'shops', 'shop-electrical-01');
    await setDoc(
      shopRef,
      {
        lastInventoryPurgedAt: purgeTimestamp,
        lastInventoryUpdated: purgeTimestamp,
      },
      { merge: true }
    );
  } catch (cloudErr) {
    console.warn('Notice during Firestore cloud purge:', cloudErr);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shopledger_inventory_updated'));
  }
}

// Reset database utility
export async function resetDatabaseWithSeed() {
  await db.transaction('rw', [
    db.shops, db.users, db.items, db.sales, db.stockMovements,
    db.customers, db.customerPayments, db.imports, db.auditLogs,
    db.syncQueue, db.dailyReports
  ], async () => {
    await db.shops.clear();
    await db.users.clear();
    await db.items.clear();
    await db.sales.clear();
    await db.stockMovements.clear();
    await db.customers.clear();
    await db.customerPayments.clear();
    await db.imports.clear();
    await db.auditLogs.clear();
    await db.syncQueue.clear();
    await db.dailyReports.clear();
  });
  await initializeDatabase();
}
