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
import { collection, getDocs, doc, deleteDoc } from 'firebase/firestore';

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

    const ownerUser: User = {
      uid: 'user-rajifarrid',
      shopId: SEED_SHOP_ID,
      name: 'Raji Farrid',
      email: 'rajifarrid@gmail.com',
      role: 'owner',
      active: true,
      deviceCode: 'D01',
      pin: '1234',
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    };

    await db.shops.add(defaultShop);
    await db.users.add(ownerUser);

    // Populate initial items
    const now = Date.now();
    const itemRecords: Item[] = INITIAL_GADGETS.map((g, idx) => ({
      ...g,
      id: `item-${idx + 1}`,
      shopId: SEED_SHOP_ID,
      createdAt: now - 20 * 24 * 60 * 60 * 1000,
      updatedAt: now,
    }));

    await db.items.bulkAdd(itemRecords);

    // Initial stock movement logs
    const movements: StockMovement[] = itemRecords.map((item, idx) => ({
      id: `mov-init-${idx + 1}`,
      shopId: SEED_SHOP_ID,
      itemId: item.id,
      itemName: item.name,
      itemSku: item.sku,
      type: 'import',
      qtyChange: item.quantity,
      previousQty: 0,
      newQty: item.quantity,
      reason: 'Initial stock intake',
      userId: ownerUser.uid,
      userName: ownerUser.name,
      createdAt: now - 20 * 24 * 60 * 60 * 1000,
    }));
    await db.stockMovements.bulkAdd(movements);

    // Add 2 initial demo customers
    const demoCustomers: Customer[] = [
      {
        id: 'cust-1',
        shopId: SEED_SHOP_ID,
        name: 'David K. Osei',
        phone: '+233 24 774 2190',
        balanceOwed: 25.00,
        createdAt: now - 10 * 24 * 60 * 60 * 1000,
        updatedAt: now - 2 * 24 * 60 * 60 * 1000,
      },
      {
        id: 'cust-2',
        shopId: SEED_SHOP_ID,
        name: 'Marcus Vance',
        phone: '+233 20 881 3324',
        balanceOwed: 0,
        createdAt: now - 5 * 24 * 60 * 60 * 1000,
        updatedAt: now - 5 * 24 * 60 * 60 * 1000,
      }
    ];
    await db.customers.bulkAdd(demoCustomers);

    // Seed recent historical sales across the past 5 days for rich charts & metrics
    const sampleSales: Sale[] = [
      {
        id: 'sale-demo-01',
        invoiceNo: 'INV-D01-0001',
        shopId: SEED_SHOP_ID,
        sellerId: ownerUser.uid,
        sellerName: ownerUser.name,
        customerName: 'Walk-in Customer',
        lines: [
          {
            itemId: itemRecords[0].id,
            name: itemRecords[0].name,
            sku: itemRecords[0].sku,
            qty: 1,
            unitPrice: 15.00,
            costPriceAtSale: 8.50,
            discount: 0,
            lineTotal: 15.00,
          },
          {
            itemId: itemRecords[4].id,
            name: itemRecords[4].name,
            sku: itemRecords[4].sku,
            qty: 2,
            unitPrice: 5.50,
            costPriceAtSale: 2.20,
            discount: 0,
            lineTotal: 11.00,
          }
        ],
        subtotal: 26.00,
        discountTotal: 0,
        tax: 1.95,
        total: 27.95,
        payments: [{ method: 'Cash', amount: 27.95 }],
        status: 'completed',
        createdAtClient: now - 4 * 24 * 60 * 60 * 1000,
        syncedAt: now - 4 * 24 * 60 * 60 * 1000,
        deviceCode: 'D01',
      },
      {
        id: 'sale-demo-02',
        invoiceNo: 'INV-D02-0002',
        shopId: SEED_SHOP_ID,
        sellerId: ownerUser.uid,
        sellerName: ownerUser.name,
        customerName: 'Marcus Vance',
        customerPhone: '+233 20 881 3324',
        lines: [
          {
            itemId: itemRecords[11].id,
            name: itemRecords[11].name,
            sku: itemRecords[11].sku,
            qty: 1,
            unitPrice: 20.00,
            costPriceAtSale: 10.50,
            discount: 2.00,
            lineTotal: 18.00,
          },
          {
            itemId: itemRecords[15].id,
            name: itemRecords[15].name,
            sku: itemRecords[15].sku,
            qty: 1,
            unitPrice: 22.00,
            costPriceAtSale: 12.00,
            discount: 0,
            lineTotal: 22.00,
          }
        ],
        subtotal: 40.00,
        discountTotal: 2.00,
        tax: 3.00,
        total: 43.00,
        payments: [{ method: 'Mobile Money', amount: 43.00 }],
        status: 'completed',
        createdAtClient: now - 2 * 24 * 60 * 60 * 1000,
        syncedAt: now - 2 * 24 * 60 * 60 * 1000,
        deviceCode: 'D02',
      },
      {
        id: 'sale-demo-03',
        invoiceNo: 'INV-D01-0003',
        shopId: SEED_SHOP_ID,
        sellerId: ownerUser.uid,
        sellerName: ownerUser.name,
        customerName: 'David K. Osei',
        customerPhone: '+233 24 774 2190',
        lines: [
          {
            itemId: itemRecords[1].id,
            name: itemRecords[1].name,
            sku: itemRecords[1].sku,
            qty: 1,
            unitPrice: 38.00,
            costPriceAtSale: 22.00,
            discount: 0,
            lineTotal: 38.00,
          }
        ],
        subtotal: 38.00,
        discountTotal: 0,
        tax: 2.85,
        total: 40.85,
        payments: [
          { method: 'Cash', amount: 15.85 },
          { method: 'Credit', amount: 25.00 },
        ],
        status: 'completed',
        createdAtClient: now - 1 * 24 * 60 * 60 * 1000,
        syncedAt: now - 1 * 24 * 60 * 60 * 1000,
        deviceCode: 'D01',
      },
      {
        id: 'sale-demo-04',
        invoiceNo: 'INV-D02-0004',
        shopId: SEED_SHOP_ID,
        sellerId: ownerUser.uid,
        sellerName: ownerUser.name,
        customerName: 'Walk-in Customer',
        lines: [
          {
            itemId: itemRecords[26].id,
            name: itemRecords[26].name,
            sku: itemRecords[26].sku,
            qty: 1,
            unitPrice: 35.00,
            costPriceAtSale: 19.00,
            discount: 0,
            lineTotal: 35.00,
          },
          {
            itemId: itemRecords[31].id,
            name: itemRecords[31].name,
            sku: itemRecords[31].sku,
            qty: 2,
            unitPrice: 5.50,
            costPriceAtSale: 2.80,
            discount: 0,
            lineTotal: 11.00,
          }
        ],
        subtotal: 46.00,
        discountTotal: 0,
        tax: 3.45,
        total: 49.45,
        payments: [{ method: 'Card', amount: 49.45 }],
        status: 'completed',
        createdAtClient: now - 3 * 60 * 60 * 1000, // 3 hours ago today
        syncedAt: now - 3 * 60 * 60 * 1000,
        deviceCode: 'D02',
      }
    ];
    await db.sales.bulkAdd(sampleSales);

    // Audit logs
    await db.auditLogs.add({
      id: 'audit-01',
      shopId: SEED_SHOP_ID,
      action: 'inventory_imported',
      entity: 'items',
      entityId: 'all',
      userId: ownerUser.uid,
      userName: ownerUser.name,
      meta: { count: itemRecords.length },
      createdAt: now - 20 * 24 * 60 * 60 * 1000,
    });
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
      'wisdomosborn65@gmail.com',
      'abuyahwisdomosborn@gmail.com',
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
          await db.users.update(u.uid, {
            name: 'Raji Farrid',
            email: 'rajifarrid@gmail.com',
            role: 'owner',
            active: true,
            deviceCode: 'D01',
            pin: '1234',
          });
        } else {
          await db.users.delete(u.uid);
        }
      }
      // Real workers created by admin (role === 'seller') are strictly PRESERVED!
    }

    if (!keptRaji) {
      const shopId = existing?.id || SEED_SHOP_ID;
      await db.users.put({
        uid: 'user-rajifarrid',
        shopId,
        name: 'Raji Farrid',
        email: 'rajifarrid@gmail.com',
        role: 'owner',
        active: true,
        deviceCode: 'D01',
        pin: '1234',
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      });
    }

    // Auto-purge the mistake cashier/staff accounts from Firestore and Dexie
    if (!localStorage.getItem('shopledger_purged_mistake_accounts_v3')) {
      const allUsersNow = await db.users.toArray();
      for (const u of allUsersNow) {
        if (u.email?.toLowerCase() !== 'rajifarrid@gmail.com' && u.role !== 'owner') {
          await db.users.delete(u.uid);
        }
      }
      try {
        const snap = await getDocs(collection(firestore, 'users'));
        for (const docSnap of snap.docs) {
          const data = docSnap.data();
          const email = (data.email || '').toLowerCase().trim();
          if (email !== 'rajifarrid@gmail.com' && data.role !== 'owner') {
            await deleteDoc(doc(firestore, 'users', docSnap.id));
          }
        }
      } catch (err) {
        console.warn('Error purging mistake accounts from Firestore:', err);
      }
      localStorage.setItem('shopledger_purged_mistake_accounts_v3', 'true');
    }

    // Pull registered workers from Firestore so they persist across devices/refreshes
    try {
      const snap = await getDocs(collection(firestore, 'users'));
      for (const docSnap of snap.docs) {
        const uData = docSnap.data() as User;
        if (
          uData &&
          uData.email &&
          !blockedEmails.includes(uData.email.toLowerCase().trim())
        ) {
          await db.users.put({
            ...uData,
            uid: docSnap.id,
          });
        } else if (uData && uData.email && blockedEmails.includes(uData.email.toLowerCase().trim())) {
          await db.users.delete(docSnap.id);
        }
      }
    } catch {
      // offline fallback
    }
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
