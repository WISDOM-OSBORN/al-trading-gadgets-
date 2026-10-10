import Papa from 'papaparse';
import { Item, InventoryImportHistory } from '../types';
import { db } from '../db';
import { syncAllInventoryToFirestore } from '../db/sync';
import { applyStockChangeTx } from '../db/stock';

export const CSV_TEMPLATE_HEADERS = [
  'name',
  'cost_price',
  'selling_price',
  'quantity',
];

export interface CSVRowValidationError {
  row: number;
  sku: string;
  name: string;
  field: string;
  error: string;
  rawData: Record<string, string>;
}

export interface CSVParseResult {
  headers: string[];
  totalRows: number;
  validRows: ParsedItemRow[];
  errors: CSVRowValidationError[];
}

export interface ParsedItemRow {
  rowNumber: number;
  sku: string;
  name: string;
  category: string;
  brand: string;
  costPrice: number;
  sellingPrice: number;
  quantity: number;
  reorderLevel: number;
  barcode: string;
  supplier: string;
  description: string;
}

export type DuplicateHandlingMode = 'skip' | 'update' | 'add_stock';

// Parse raw CSV string or file
export function parseCSVFile(
  file: File,
  columnMapping?: Record<string, string>
): Promise<CSVParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim().toLowerCase().replace(/[\s-]+/g, '_'),
      complete: (results) => {
        try {
          const rawData = results.data as Record<string, any>[];
          const headers = results.meta.fields || [];

          const validRows: ParsedItemRow[] = [];
          const errors: CSVRowValidationError[] = [];
          const seenSkusInFile = new Set<string>();

          rawData.forEach((row, index) => {
            const rowNumber = index + 2; // header is row 1

            // Helper to get field with mapping or direct match
            const getVal = (targetField: string): string => {
              if (columnMapping && columnMapping[targetField]) {
                return (row[columnMapping[targetField]] || '').toString().trim();
              }
              // Try variations
              const direct = row[targetField];
              if (direct !== undefined && direct !== null) return direct.toString().trim();
              const alt = row[targetField.replace('_', '')] || row[targetField.replace('_', ' ')];
              return (alt !== undefined && alt !== null) ? alt.toString().trim() : '';
            };

            const name = getVal('name');
            let sku = getVal('sku');
            const category = getVal('category') || 'General Electrical';
            const brand = getVal('brand') || '';
            const costPriceStr = getVal('cost_price');
            const sellingPriceStr = getVal('selling_price');
            const quantityStr = getVal('quantity');
            const reorderLevelStr = getVal('reorder_level');
            const barcode = getVal('barcode');
            const supplier = getVal('supplier');
            const description = getVal('description');

            // 1. Validate Name (Required)
            if (!name) {
              errors.push({
                row: rowNumber,
                sku: sku || 'N/A',
                name: '(Empty Name)',
                field: 'name',
                error: 'Product name is required.',
                rawData: row,
              });
              return;
            }

            // Auto-generate unique SKU if absent (e.g. ALQ-AUX-101)
            if (!sku) {
              const words = name.replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).filter(Boolean);
              let prefix = 'ITM';
              if (words.length >= 2) {
                prefix = (words[0].slice(0, 2) + words[1].slice(0, 2)).toUpperCase();
              } else if (words.length === 1 && words[0].length >= 3) {
                prefix = words[0].slice(0, 3).toUpperCase();
              } else if (category) {
                prefix = category.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'ITM';
              }
              let randomNum = Math.floor(100 + Math.random() * 900);
              sku = `ALQ-${prefix}-${randomNum}`;
              while (seenSkusInFile.has(sku.toUpperCase())) {
                randomNum = Math.floor(100 + Math.random() * 900);
                sku = `ALQ-${prefix}-${randomNum}`;
              }
            }

            // Check duplicate SKU inside the uploaded file itself
            const normalizedSku = sku.toUpperCase();
            if (seenSkusInFile.has(normalizedSku)) {
              errors.push({
                row: rowNumber,
                sku,
                name,
                field: 'sku',
                error: `Duplicate SKU "${sku}" found within the CSV file.`,
                rawData: row,
              });
              return;
            }
            seenSkusInFile.add(normalizedSku);

            // 2. Validate Selling Price (Required, positive number)
            const cleanSellingPrice = sellingPriceStr.replace(/[^0-9.-]/g, '');
            const sellingPrice = parseFloat(cleanSellingPrice);
            if (isNaN(sellingPrice) || sellingPrice < 0) {
              errors.push({
                row: rowNumber,
                sku,
                name,
                field: 'selling_price',
                error: `Invalid selling price "${sellingPriceStr}". Must be a positive number.`,
                rawData: row,
              });
              return;
            }

            // 3. Validate Quantity (Required, non-negative whole integer)
            const cleanQty = quantityStr.replace(/[^0-9.-]/g, '');
            const rawParsed = Number(cleanQty);
            if (quantityStr === '' || !Number.isInteger(rawParsed) || rawParsed < 0) {
              errors.push({
                row: rowNumber,
                sku,
                name,
                field: 'quantity',
                error: `Invalid quantity "${quantityStr}". Must be a whole integer 0 or greater.`,
                rawData: row,
              });
              return;
            }
            const quantity = rawParsed;

            // Optional Cost Price
            let costPrice = 0;
            if (costPriceStr) {
              const cleanCost = costPriceStr.replace(/[^0-9.-]/g, '');
              const parsedCost = parseFloat(cleanCost);
              if (!isNaN(parsedCost) && parsedCost >= 0) {
                costPrice = parsedCost;
              }
            }

            // Optional Reorder Level
            let reorderLevel = 5;
            if (reorderLevelStr) {
              const parsedReorder = parseInt(reorderLevelStr, 10);
              if (!isNaN(parsedReorder) && parsedReorder >= 0) {
                reorderLevel = parsedReorder;
              }
            }

            validRows.push({
              rowNumber,
              sku: normalizedSku,
              name,
              category,
              brand,
              costPrice,
              sellingPrice,
              quantity,
              reorderLevel,
              barcode,
              supplier,
              description,
            });
          });

          resolve({
            headers,
            totalRows: rawData.length,
            validRows,
            errors,
          });
        } catch (err) {
          reject(err);
        }
      },
      error: (err) => reject(err),
    });
  });
}

// Execute batch import into Dexie
export async function executeBatchImport(params: {
  shopId: string;
  userId: string;
  userName: string;
  fileName: string;
  validRows: ParsedItemRow[];
  duplicateMode: DuplicateHandlingMode;
  onProgress?: (progressPercent: number, rowNum: number) => void;
}): Promise<InventoryImportHistory> {
  const { shopId, userId, userName, fileName, validRows, duplicateMode, onProgress } = params;
  const now = Date.now();

  let rowsAdded = 0;
  let rowsUpdated = 0;
  let rowsFailed = 0;
  const affectedItemIds: string[] = [];

  // Fetch all existing items for fast in-memory map lookup
  const existingItems = await db.items.where('shopId').equals(shopId).toArray();
  const existingBySku = new Map<string, Item>();
  existingItems.forEach((i) => existingBySku.set(i.sku.toUpperCase(), i));

  const total = validRows.length;
  const batchSize = 100;

  for (let i = 0; i < total; i += batchSize) {
    const batch = validRows.slice(i, i + batchSize);

    await db.transaction('rw', [db.items, db.stockMovements, db.syncQueue], async () => {
      for (const row of batch) {
        try {
          const existing = existingBySku.get(row.sku);

          if (existing) {
            if (duplicateMode === 'skip') {
              // Do nothing
              continue;
            } else if (duplicateMode === 'add_stock') {
              await applyStockChangeTx({
                shopId,
                itemId: existing.id,
                delta: row.quantity,
                type: 'import',
                reason: `CSV Import add stock (${fileName})`,
                userId,
                userName,
                now,
              });
              rowsUpdated++;
              affectedItemIds.push(existing.id);
            } else if (duplicateMode === 'update') {
              // update: write metadata WITHOUT quantity, then apply the difference against FRESH stock
              const fresh = await db.items.get(existing.id);
              await db.items.update(existing.id, {
                name: row.name,
                category: row.category || existing.category,
                brand: row.brand || existing.brand,
                costPrice: row.costPrice,
                sellingPrice: row.sellingPrice,
                reorderLevel: row.reorderLevel,
                barcode: row.barcode || existing.barcode,
                supplier: row.supplier || existing.supplier,
                description: row.description || existing.description,
                updatedAt: now,
              });

              await db.syncQueue.add({
                id: `sync-imp-item-${existing.id}-${now}`,
                entity: 'item',
                action: 'update',
                payload: { ...existing, ...row, updatedAt: now },
                attempts: 0,
                status: 'pending',
                createdAt: now,
              });

              const delta = row.quantity - (fresh?.quantity ?? 0);
              if (delta !== 0) {
                await applyStockChangeTx({
                  shopId,
                  itemId: existing.id,
                  delta,
                  type: 'import',
                  reason: `CSV Import update details (${fileName})`,
                  userId,
                  userName,
                  now,
                });
              }
              rowsUpdated++;
              affectedItemIds.push(existing.id);
            }
          } else {
            // New item: add with quantity 0, then apply initial stock
            const newItemId = `item-imp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const newItem: Item = {
              id: newItemId,
              shopId,
              sku: row.sku,
              barcode: row.barcode || '',
              name: row.name,
              category: row.category,
              brand: row.brand,
              costPrice: row.costPrice,
              sellingPrice: row.sellingPrice,
              quantity: 0,
              reorderLevel: row.reorderLevel,
              supplier: row.supplier || '',
              description: row.description || '',
              archived: false,
              createdAt: now,
              updatedAt: now,
            };

            await db.items.add(newItem);
            existingBySku.set(row.sku, newItem);

            await db.syncQueue.add({
              id: `sync-imp-item-${newItemId}-${now}`,
              entity: 'item',
              action: 'create',
              payload: newItem,
              attempts: 0,
              status: 'pending',
              createdAt: now,
            });

            if (row.quantity > 0) {
              await applyStockChangeTx({
                shopId,
                itemId: newItemId,
                delta: row.quantity,
                type: 'import',
                reason: `CSV Import new item (${fileName})`,
                userId,
                userName,
                now,
              });
            }

            rowsAdded++;
            affectedItemIds.push(newItemId);
          }
        } catch {
          rowsFailed++;
        }
      }
    });

    if (onProgress) {
      const currentProcessed = Math.min(i + batchSize, total);
      const percent = Math.round((currentProcessed / total) * 100);
      onProgress(percent, currentProcessed);
    }
    // Yield to UI loop
    await new Promise((r) => setTimeout(r, 10));
  }

  const importRecord: InventoryImportHistory = {
    id: `imp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    shopId,
    fileName,
    rowsAdded,
    rowsUpdated,
    rowsFailed,
    userId,
    userName,
    createdAt: now,
    snapshotItemIds: affectedItemIds,
  };

  await db.imports.add(importRecord);
  await db.auditLogs.add({
    id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    shopId,
    action: 'inventory_imported',
    entity: 'imports',
    entityId: importRecord.id,
    userId,
    userName,
    meta: {
      fileName,
      rowsAdded,
      rowsUpdated,
      rowsFailed,
    },
    createdAt: now,
  });

  // Automatically sync newly imported items and import record to Firebase Firestore
  try {
    await syncAllInventoryToFirestore(shopId, true);
  } catch (syncErr) {
    console.warn('Background sync to Firestore scheduled:', syncErr);
  }

  return importRecord;
}

// Download raw CSV string helper
export function downloadCSV(csvContent: string, fileName: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Generate error CSV string
export function exportErrorsToCSV(errors: CSVRowValidationError[]): string {
  const data = errors.map((e) => ({
    row_number: e.row,
    sku: e.sku,
    name: e.name,
    error_field: e.field,
    error_message: e.error,
  }));
  return Papa.unparse(data);
}

// Export entire current inventory to CSV
export async function exportInventoryToCSV(shopId: string): Promise<string> {
  const items = await db.items.where('shopId').equals(shopId).toArray();
  const exportData = items.map((item) => ({
    sku: item.sku,
    name: item.name,
    category: item.category,
    brand: item.brand,
    cost_price: item.costPrice.toFixed(2),
    selling_price: item.sellingPrice.toFixed(2),
    quantity: item.quantity,
    reorder_level: item.reorderLevel,
    barcode: item.barcode || '',
    supplier: item.supplier || '',
    description: item.description || '',
    status: item.archived ? 'Archived' : 'Active',
  }));
  return Papa.unparse(exportData);
}

// Generate CSV template with simple sample items in Ghanaian Cedis (GH₵)
export function generateSampleTemplateCSV(): string {
  return Papa.unparse({
    fields: ['name', 'cost_price', 'selling_price', 'quantity'],
    data: [
      ['3.5mm Male-to-Male Audio Aux Cable (1.2m)', '15.00', '30.00', '50'],
      ['Anker 20W USB-C Nano PowerPort Adapter', '85.00', '140.00', '45'],
      ['Braided Type-C to Type-C 60W Fast Charging Cable (1m)', '25.00', '45.00', '80'],
      ['Oraimo 10,000mAh Toast 10 Power Bank Dual USB', '180.00', '260.00', '34'],
      ['Schneider 4-Gang Surge Protected Socket Extender (2m)', '95.00', '150.00', '22'],
      ['Philips 9W Warm White LED Bulb E27 Screw Base', '20.00', '35.00', '60'],
      ['Oraimo FreePods 4 Active Noise Cancelling TWS Earbuds', '220.00', '320.00', '26'],
      ['Duracell Ultra Alkaline AA Batteries (Pack of 4)', '30.00', '50.00', '90'],
      ['British General 13A Double Switched Wall Socket', '40.00', '70.00', '40'],
      ['Digital Multimeter AC/DC Voltage & Resistance Tester', '85.00', '145.00', '18'],
      ['Heavy-Duty PVC Insulating Electric Tape (Black 10m)', '6.00', '12.00', '120'],
      ['Baseus 65W GaN5 Pro Fast Charger 3-Port', '210.00', '310.00', '25'],
      ['Apple 20W USB-C Power Adapter (Original UK Pin)', '190.00', '280.00', '30'],
      ['Oraimo Lightning to USB Fast Charge Cable (1m)', '20.00', '40.00', '75'],
      ['Schneider 16A Single Pole Miniature Circuit Breaker (MCB)', '28.00', '50.00', '50'],
    ],
  });
}
