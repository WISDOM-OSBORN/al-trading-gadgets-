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

// Initialize default store data if empty
export async function initializeDatabase() {
  const shopCount = await db.shops.count();
  if (shopCount === 0) {
    let cloudShopFound = false;
    let cloudItemsCount = 0;

    // 1. Check if Cloud Firestore already has shop, users, and items
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const shopSnap = await getDocs(collection(firestore, 'shops'));
        if (!shopSnap.empty) {
          const shopDoc = shopSnap.docs[0];
          const sData = shopDoc.data() as Shop;
          await db.shops.put({
            ...sData,
            id: shopDoc.id,
          });
          cloudShopFound = true;
        }

        // Pull users from Firestore
        const userSnap = await getDocs(collection(firestore, 'users'));
        for (const uDoc of userSnap.docs) {
          const uData = uDoc.data() as User;
          if (uData && uData.email) {
            await db.users.put({
              ...uData,
              uid: uDoc.id,
            });
          }
        }

        // Check if items already exist in Firestore (from owner upload or setup)
        const itemsSnap = await getDocs(collection(firestore, 'items'));
        if (!itemsSnap.empty) {
          cloudItemsCount = itemsSnap.docs.length;
          const cloudItems: Item[] = [];
          for (const iDoc of itemsSnap.docs) {
            const iData = iDoc.data() as Item;
            if (iData && iData.name) {
              cloudItems.push({
                ...iData,
                id: iDoc.id,
                costPrice: Number(iData.costPrice) || 0,
                sellingPrice: Number(iData.sellingPrice) || 0,
                quantity: Number(iData.quantity) || 0,
                archived: Boolean(iData.archived),
              });
            }
          }
          await db.items.bulkPut(cloudItems);
        }
      } catch (err) {
        console.warn('Initial cloud hydration check notice:', err);
      }
    }

    if (!cloudShopFound) {
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
    }

    // Ensure owner user exists
    const ownerExists = await db.users.where('email').equalsIgnoreCase('rajifarrid@gmail.com').first();
    if (!ownerExists) {
      const defaultOwnerHash = await hashPin('1234');
      const ownerUser: User = {
        uid: 'user-rajifarrid',
        shopId: SEED_SHOP_ID,
        name: 'Raji Farrid',
        email: 'rajifarrid@gmail.com',
        role: 'owner',
        active: true,
        deviceCode: 'D01',
        pinHash: defaultOwnerHash,
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      };
      await db.users.add(ownerUser);
    }

    // ONLY populate dummy initial gadgets if Cloud Firestore was completely empty of items
    const wasPurged = localStorage.getItem('shopledger_last_purged_at');
    if (cloudItemsCount === 0 && !wasPurged) {
      const now = Date.now();
      const itemRecords: Item[] = INITIAL_GADGETS.map((g, idx) => ({
        ...g,
        id: `item-${idx + 1}`,
        shopId: SEED_SHOP_ID,
        createdAt: now - 20 * 24 * 60 * 60 * 1000,
        updatedAt: now,
      }));
      await db.items.bulkAdd(itemRecords);
    }
  } else {
    // Ensure existing shop has AL-Q ELECTRICALS and Ghanaian Cedi
    const existing = await db.shops.toCollection().first();
    if (existing) {
      await db.shops.update(existing.id, {
        name: 'AL-Q ELECTRICALS',
        currency: 'GHS',
        currencySymbol: 'GH₵',
      });
    }

    // Sanitize accounts: Remove blocked account gha@gmail.com and old prototype accounts
    const blockedEmails = [
      'gha@gmail.com',
      'owner@shopledger.app',
      'alex.rivera@shopledger.app',
    ];

    const allUsers = await db.users.toArray();
    let keptRaji = false;

    for (const u of allUsers) {
      const emailLower = (u.email || '').toLowerCase().trim();
      if (blockedEmails.includes(emailLower)) {
        await db.users.delete(u.uid);
      } else if (emailLower === 'rajifarrid@gmail.com') {
        if (!keptRaji) {
          keptRaji = true;
          const ownerHash = await hashPin('1234');
          await db.users.update(u.uid, {
            name: 'Raji Farrid',
            email: 'rajifarrid@gmail.com',
            role: 'owner',
            active: true,
            deviceCode: 'D01',
            pinHash: ownerHash,
          });
        } else {
          await db.users.delete(u.uid);
        }
      }
      // Real workers created by admin (role === 'seller') are strictly PRESERVED!
    }

    if (!keptRaji) {
      const shopId = existing?.id || SEED_SHOP_ID;
      const ownerHash = await hashPin('1234');
      await db.users.put({
        uid: 'user-rajifarrid',
        shopId,
        name: 'Raji Farrid',
        email: 'rajifarrid@gmail.com',
        role: 'owner',
        active: true,
        deviceCode: 'D01',
        pinHash: ownerHash,
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      });
    }
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

// Purge all cashier and staff accounts created by mistake (keeps ONLY store owner)
export async function deleteAllCashierStaffAccounts(): Promise<number> {
  let count = 0;
  // 1. Delete all non-owner staff from local Dexie
  const localUsers = await db.users.toArray();
  for (const u of localUsers) {
    if (u.email?.toLowerCase() !== 'rajifarrid@gmail.com' && u.role !== 'owner') {
      await db.users.delete(u.uid);
      count++;
    }
  }

  // 2. Delete all non-owner staff from Firestore
  try {
    const snap = await getDocs(collection(firestore, 'users'));
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const email = (data.email || '').toLowerCase().trim();
      if (email !== 'rajifarrid@gmail.com' && data.role !== 'owner') {
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
  const item = await db.items.get(params.itemId);
  if (!item) throw new Error('Item not found in inventory.');
  if (item.quantity < params.quantity) {
    throw new Error(`Insufficient stock for "${item.name}". Only ${item.quantity} available.`);
  }

  const now = Date.now();
  const withdrawalId = `with-${now}-${Math.random().toString(36).slice(2, 7)}`;
  const previousQty = item.quantity;
  const newQty = item.quantity - params.quantity;
  const totalCostValue = (item.costPrice || 0) * params.quantity;

  const withdrawal: OwnerWithdrawal = {
    id: withdrawalId,
    shopId: params.shopId,
    itemId: item.id,
    itemName: item.name,
    itemSku: item.sku,
    quantity: params.quantity,
    costPrice: item.costPrice || 0,
    sellingPrice: item.sellingPrice || 0,
    totalCostValue,
    reason: params.reason || 'Owner Withdrawal',
    userId: params.userId,
    userName: params.userName,
    createdAt: now,
  };

  // 1. Deduct stock in IndexedDB
  await db.items.update(item.id, {
    quantity: newQty,
    updatedAt: now,
  });

  // 2. Add Stock Movement
  await db.stockMovements.add({
    id: `sm-${now}-${Math.random().toString(36).slice(2, 7)}`,
    shopId: params.shopId,
    itemId: item.id,
    itemName: item.name,
    itemSku: item.sku,
    type: 'withdrawal',
    qtyChange: -params.quantity,
    previousQty,
    newQty,
    reason: `Owner Withdrawal: ${params.reason}`,
    refId: withdrawalId,
    userId: params.userId,
    userName: params.userName,
    createdAt: now,
  });

  // 3. Save Withdrawal record
  await db.withdrawals.add(withdrawal);

  // 4. Audit Log
  await db.auditLogs.add({
    id: `audit-${now}`,
    shopId: params.shopId,
    action: 'stock_adjusted',
    entity: 'items',
    entityId: item.id,
    userId: params.userId,
    userName: params.userName,
    meta: {
      action: 'owner_withdrawal',
      quantityWithdrawn: params.quantity,
      remainingStock: newQty,
      costValue: totalCostValue,
      reason: params.reason,
    },
    createdAt: now,
  });

  return withdrawal;
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
