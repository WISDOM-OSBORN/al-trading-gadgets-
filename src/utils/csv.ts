import Papa from 'papaparse';
import { Item, InventoryImportHistory } from '../types';
import { db } from '../db';

export const CSV_TEMPLATE_HEADERS = [
  'sku',
  'name',
  'category',
  'brand',
  'cost_price',
  'selling_price',
  'quantity',
  'reorder_level',
  'barcode',
  'supplier',
  'description',
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
            const brand = getVal('brand') || 'Generic';
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

            // Auto-generate SKU if absent
            if (!sku) {
              const prefix = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'ITM';
              sku = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
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

            // 3. Validate Quantity (Required, non-negative integer/number)
            const cleanQty = quantityStr.replace(/[^0-9.-]/g, '');
            const quantity = parseInt(cleanQty || '0', 10);
            if (isNaN(quantity) || quantity < 0) {
              errors.push({
                row: rowNumber,
                sku,
                name,
                field: 'quantity',
                error: `Invalid quantity "${quantityStr}". Cannot be negative.`,
                rawData: row,
              });
              return;
            }

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

    await db.transaction('rw', [db.items, db.stockMovements], async () => {
      for (const row of batch) {
        try {
          const existing = existingBySku.get(row.sku);

          if (existing) {
            if (duplicateMode === 'skip') {
              // Do nothing
              continue;
            } else if (duplicateMode === 'add_stock') {
              const newQty = existing.quantity + row.quantity;
              await db.items.update(existing.id, {
                quantity: newQty,
                updatedAt: now,
              });
              await db.stockMovements.add({
                id: `mov-imp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                shopId,
                itemId: existing.id,
                itemName: existing.name,
                itemSku: existing.sku,
                type: 'import',
                qtyChange: row.quantity,
                previousQty: existing.quantity,
                newQty,
                reason: `CSV Import add stock (${fileName})`,
                userId,
                userName,
                createdAt: now,
              });
              rowsUpdated++;
              affectedItemIds.push(existing.id);
            } else if (duplicateMode === 'update') {
              const prevQty = existing.quantity;
              await db.items.update(existing.id, {
                name: row.name,
                category: row.category || existing.category,
                brand: row.brand || existing.brand,
                costPrice: row.costPrice,
                sellingPrice: row.sellingPrice,
                quantity: row.quantity,
                reorderLevel: row.reorderLevel,
                barcode: row.barcode || existing.barcode,
                supplier: row.supplier || existing.supplier,
                description: row.description || existing.description,
                updatedAt: now,
              });
              if (prevQty !== row.quantity) {
                await db.stockMovements.add({
                  id: `mov-imp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                  shopId,
                  itemId: existing.id,
                  itemName: row.name,
                  itemSku: row.sku,
                  type: 'import',
                  qtyChange: row.quantity - prevQty,
                  previousQty: prevQty,
                  newQty: row.quantity,
                  reason: `CSV Import update details (${fileName})`,
                  userId,
                  userName,
                  createdAt: now,
                });
              }
              rowsUpdated++;
              affectedItemIds.push(existing.id);
            }
          } else {
            // New item
            const newItemId = `item-imp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const newItem: Item = {
              id: newItemId,
              shopId,
              sku: row.sku,
              barcode: row.barcode || undefined,
              name: row.name,
              category: row.category,
              brand: row.brand,
              costPrice: row.costPrice,
              sellingPrice: row.sellingPrice,
              quantity: row.quantity,
              reorderLevel: row.reorderLevel,
              supplier: row.supplier || undefined,
              description: row.description || undefined,
              archived: false,
              createdAt: now,
              updatedAt: now,
            };

            await db.items.add(newItem);
            existingBySku.set(row.sku, newItem);

            await db.stockMovements.add({
              id: `mov-imp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              shopId,
              itemId: newItemId,
              itemName: row.name,
              itemSku: row.sku,
              type: 'import',
              qtyChange: row.quantity,
              previousQty: 0,
              newQty: row.quantity,
              reason: `CSV Import initial (${fileName})`,
              userId,
              userName,
              createdAt: now,
            });

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

// Generate CSV template with sample items in Ghanaian Cedis (GH₵)
export function generateSampleTemplateCSV(): string {
  return Papa.unparse({
    fields: CSV_TEMPLATE_HEADERS,
    data: [
      ['CHG-20W-ANK', 'Anker 20W USB-C Nano PowerPort Adapter', 'Chargers & Adapters', 'Anker', '85.00', '140.00', '45', '10', '848061023451', 'Apex Tech Distro', 'Fast charger for iPhone and Android'],
      ['CAB-TC-1M', 'Braided Type-C to Type-C 60W Cable (1m)', 'Cables & Leads', 'Oraimo', '25.00', '45.00', '80', '15', '693417770101', 'Transsion Acc Ltd', 'Heavy duty nylon braided PD cord'],
      ['PB-10000-ORA', 'Oraimo 10,000mAh Toast 10 Power Bank', 'Power Banks', 'Oraimo', '180.00', '260.00', '34', '8', '489518074901', 'Transsion Acc Ltd', 'Dual output with LED power display'],
      ['EXT-4WAY-2M', 'Schneider 4-Gang Surge Protected Socket (2m)', 'Extension Sockets', 'Schneider', '95.00', '150.00', '22', '6', '501234567891', 'VoltMaster Electricals', 'Surge suppression neon switches'],
      ['BLB-LED-9W-E27', 'Philips 9W Warm White LED Bulb E27 Screw', 'Lighting & Bulbs', 'Philips', '20.00', '35.00', '50', '12', '871869970001', 'Lumen Electricals', 'A60 shape 806 lumens energy saver'],
      ['EAR-BT-ORA', 'Oraimo FreePods 4 ANC TWS Earbuds', 'Audio & Earphones', 'Oraimo', '220.00', '320.00', '26', '6', '489518074001', 'Transsion Acc Ltd', 'Active Noise Cancelling Bluetooth 5.2'],
      ['BAT-AA-4PK', 'Duracell Ultra Alkaline AA Batteries (Pack of 4)', 'Batteries & Cells', 'Duracell', '30.00', '50.00', '90', '20', '500039401201', 'VoltMaster Electricals', 'High drain long life power cells'],
      ['SCK-13A-DP', 'British General 13A Double Switched Wall Socket', 'Switches & Sockets', 'BG Electrical', '40.00', '70.00', '40', '10', '502123400103', 'VoltMaster Electricals', 'Standard UK 13A socket outlet'],
    ],
  });
}
