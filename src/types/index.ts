export type UserRole = 'owner' | 'seller';

export interface ShopSettings {
  allowPriceOverride: boolean;
  allowNegativeStock: boolean;
  invoicePrefix: string;
  receiptFooter: string;
  lowStockThresholdDefault: number;
  taxRatePercent: number;
  // Security PIN to edit shop name & address
  editPin?: string;
  // Daily Closing Report settings
  closingTime?: string; // e.g. '20:00' (8:00 PM GMT)
  closingReportEmail?: string;
  closingReportWhatsapp?: string;
  autoDispatchReport?: boolean;
}

export interface Shop {
  id: string;
  name: string;
  currency: string;
  currencySymbol: string;
  phone: string;
  address: string;
  taxRate: number;
  settings: ShopSettings;
  createdAt: number;
}

export interface User {
  uid: string;
  shopId: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  deviceCode: string;
  pin?: string;
  createdAt: number;
}

export interface Item {
  id: string;
  shopId: string;
  sku: string;
  barcode?: string;
  name: string;
  category: string;
  brand: string;
  costPrice: number; // in currency cents or integer
  sellingPrice: number;
  quantity: number;
  reorderLevel: number;
  supplier?: string;
  description?: string;
  photoUrl?: string;
  archived: boolean;
  isFavorite?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type StockMovementType = 'import' | 'sale' | 'return' | 'restock' | 'adjustment' | 'withdrawal';

export interface OwnerWithdrawal {
  id: string;
  shopId: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  quantity: number;
  costPrice: number;
  sellingPrice: number;
  totalCostValue: number;
  reason: string;
  userId: string;
  userName: string;
  createdAt: number;
}

export interface StockMovement {
  id: string;
  shopId: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  type: StockMovementType;
  qtyChange: number;
  previousQty: number;
  newQty: number;
  reason: string;
  refId?: string; // invoiceId, importId, etc.
  userId: string;
  userName: string;
  createdAt: number;
}

export interface SaleLineItem {
  itemId: string;
  name: string;
  sku: string;
  qty: number;
  unitPrice: number;
  costPriceAtSale: number;
  discount: number; // discount amount per line
  lineTotal: number;
}

export type PaymentMethod = 'Cash' | 'Mobile Money' | 'Card' | 'Bank Transfer' | 'Credit';

export interface SalePayment {
  method: PaymentMethod;
  amount: number;
}

export type SaleStatus = 'completed' | 'voided' | 'partially_returned';

export interface Sale {
  id: string; // Client UUID
  invoiceNo: string;
  shopId: string;
  sellerId: string;
  sellerName: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  lines: SaleLineItem[];
  subtotal: number;
  discountTotal: number;
  tax: number;
  total: number;
  payments: SalePayment[];
  status: SaleStatus;
  voidReason?: string;
  voidedAt?: number;
  voidedBy?: string;
  createdAtClient: number;
  exactTimeSold?: string;
  remainingStockAfterSale?: number;
  syncedAt?: number | null;
  deviceCode: string;
  notes?: string;
}

export interface Customer {
  id: string;
  shopId: string;
  name: string;
  phone: string;
  balanceOwed: number; // Positive if customer owes shop
  createdAt: number;
  updatedAt: number;
}

export interface CustomerPayment {
  id: string;
  shopId: string;
  customerId: string;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  note?: string;
  createdAt: number;
  userId: string;
  userName: string;
}

export interface InventoryImportHistory {
  id: string;
  shopId: string;
  fileName: string;
  rowsAdded: number;
  rowsUpdated: number;
  rowsFailed: number;
  userId: string;
  userName: string;
  createdAt: number;
  snapshotItemIds: string[]; // item IDs affected for undo
}

export type AuditAction = 
  | 'sale_created' 
  | 'sale_voided' 
  | 'price_override' 
  | 'stock_adjusted' 
  | 'item_created' 
  | 'item_updated' 
  | 'item_archived' 
  | 'item_restored' 
  | 'inventory_imported' 
  | 'import_undone' 
  | 'seller_created' 
  | 'seller_updated' 
  | 'seller_deleted' 
  | 'settings_updated'
  | 'day_closed'
  | 'user_login';

export interface AuditLog {
  id: string;
  shopId: string;
  action: AuditAction;
  entity: string;
  entityId: string;
  userId: string;
  userName: string;
  meta?: Record<string, any>;
  createdAt: number;
}

export interface SyncQueueItem {
  id: string;
  entity: 'sale' | 'stockMovement' | 'item' | 'customer' | 'customerPayment' | 'auditLog' | 'withdrawal' | 'import';
  action: 'create' | 'update' | 'delete';
  payload: any;
  attempts: number;
  lastError?: string;
  status: 'pending' | 'syncing' | 'failed' | 'synced';
  createdAt: number;
}

export interface DailyClosingReport {
  id: string;
  shopId: string;
  sellerId: string;
  sellerName: string;
  dateStr: string; // YYYY-MM-DD
  salesCount: number;
  totalRevenue: number;
  cashTotal: number;
  mobileMoneyTotal: number;
  cardTotal: number;
  bankTransferTotal: number;
  creditTotal: number;
  actualCashCounted?: number;
  cashDifference?: number;
  notes?: string;
  isClosed: boolean;
  closedAt?: number;
  closedBy?: string;
  createdAt: number;
}
