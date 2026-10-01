import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  parseCSVFile,
  executeBatchImport,
  exportErrorsToCSV,
  downloadCSV,
  generateSampleTemplateCSV,
  CSVParseResult,
  DuplicateHandlingMode,
  CSV_TEMPLATE_HEADERS,
} from '../../utils/csv';
import { InventoryImportHistory } from '../../types';
import { db } from '../../db';
import { formatDateTime } from '../../utils/formatters';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Download,
  RotateCcw,
  ArrowRight,
  ArrowLeft,
  Loader2,
  FileCheck,
  HelpCircle,
} from 'lucide-react';

interface ImportWizardScreenProps {
  onBack: () => void;
}

type WizardStep = 'upload' | 'mapping' | 'preview' | 'importing' | 'complete';

export const ImportWizardScreen: React.FC<ImportWizardScreenProps> = ({ onBack }) => {
  const { currentShop, currentUser } = useAuth();

  const [step, setStep] = useState<WizardStep>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<CSVParseResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [duplicateMode, setDuplicateMode] = useState<DuplicateHandlingMode>('add_stock');

  // Import Progress
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressRow, setProgressRow] = useState<number>(0);
  const [importSummary, setImportSummary] = useState<InventoryImportHistory | null>(null);

  // Import History & Undo
  const [history, setHistory] = useState<InventoryImportHistory[]>([]);
  const [isUndoing, setIsUndoing] = useState(false);

  const loadHistory = async () => {
    if (!currentShop) return;
    const records = await db.imports
      .where('shopId')
      .equals(currentShop.id)
      .reverse()
      .toArray();
    setHistory(records);
  };

  useEffect(() => {
    loadHistory();
  }, [currentShop]);

  // Handle File Upload
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);

    try {
      const result = await parseCSVFile(file);
      setParseResult(result);

      // Auto check if headers match template
      const initialMap: Record<string, string> = {};
      CSV_TEMPLATE_HEADERS.forEach((h) => {
        const found = result.headers.find(
          (rh) => rh.toLowerCase() === h || rh.toLowerCase().replace(/[\s_-]/g, '') === h.replace(/_/g, '')
        );
        if (found) initialMap[h] = found;
      });
      setColumnMapping(initialMap);

      // If headers generally align, proceed to preview, otherwise mapping step
      const hasRequired = initialMap['name'] && initialMap['selling_price'] && initialMap['quantity'];
      if (hasRequired) {
        setStep('preview');
      } else {
        setStep('mapping');
      }
    } catch (err: any) {
      alert(`CSV parsing failed: ${err.message || 'Invalid CSV file format.'}`);
    }
  };

  // Re-run parse when mapping is adjusted
  const applyColumnMapping = async () => {
    if (!selectedFile) return;
    try {
      const result = await parseCSVFile(selectedFile, columnMapping);
      setParseResult(result);
      setStep('preview');
    } catch (err: any) {
      alert(`Failed to apply mapping: ${err.message}`);
    }
  };

  // Execute Batch Import
  const handleStartImport = async () => {
    if (!currentShop || !currentUser || !parseResult || parseResult.validRows.length === 0) return;

    setStep('importing');
    setProgressPercent(0);

    try {
      const summary = await executeBatchImport({
        shopId: currentShop.id,
        userId: currentUser.uid,
        userName: currentUser.name,
        fileName: selectedFile?.name || 'inventory.csv',
        validRows: parseResult.validRows,
        duplicateMode,
        onProgress: (percent, row) => {
          setProgressPercent(percent);
          setProgressRow(row);
        },
      });

      setImportSummary(summary);
      setStep('complete');
      await loadHistory();
    } catch (err: any) {
      alert(`Import error: ${err.message}`);
      setStep('preview');
    }
  };

  // Download Sample Template CSV
  const handleDownloadTemplate = () => {
    const sampleCsv = generateSampleTemplateCSV();
    downloadCSV(sampleCsv, 'shopledger-sample-gadgets-template.csv');
  };

  // Download Errors CSV
  const handleDownloadErrors = () => {
    if (!parseResult || parseResult.errors.length === 0) return;
    const errorCsv = exportErrorsToCSV(parseResult.errors);
    downloadCSV(errorCsv, `import-errors-${Date.now()}.csv`);
  };

  // Undo Last Import
  const handleUndoImport = async (importRecord: InventoryImportHistory) => {
    if (!currentShop) return;
    if (
      !confirm(
        `Are you sure you want to undo import from "${importRecord.fileName}"? This will revert or remove newly added items from this import.`
      )
    ) {
      return;
    }

    try {
      setIsUndoing(true);
      // Soft-archive newly created items from this import
      await db.transaction('rw', [db.items, db.imports, db.auditLogs], async () => {
        for (const itemId of importRecord.snapshotItemIds) {
          const item = await db.items.get(itemId);
          if (item) {
            await db.items.update(itemId, { archived: true });
          }
        }
        await db.imports.delete(importRecord.id);
        await db.auditLogs.add({
          id: `audit-${Date.now()}`,
          shopId: currentShop.id,
          action: 'import_undone',
          entity: 'imports',
          entityId: importRecord.id,
          userId: currentUser?.uid || 'owner',
          userName: currentUser?.name || 'Owner',
          meta: { fileName: importRecord.fileName },
          createdAt: Date.now(),
        });
      });

      await loadHistory();
      alert('Import successfully undone.');
    } catch (err: any) {
      alert(`Undo failed: ${err.message}`);
    } finally {
      setIsUndoing(false);
    }
  };

  return (
    <div className="pb-24 pt-1 max-w-4xl mx-auto px-2 sm:px-4 space-y-3">
      {/* Top Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 text-slate-600 dark:text-slate-300"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="font-bold text-base sm:text-lg text-slate-900 dark:text-white flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-indigo-600" />
              <span>Bulk Inventory CSV Import Wizard</span>
            </h1>
            <p className="text-xs text-slate-500">
              Upload up to 10,000 electrical gadget rows with column mapping & error checking.
            </p>
          </div>
        </div>

        <button
          onClick={handleDownloadTemplate}
          className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
        >
          <Download className="w-3.5 h-3.5 text-indigo-500" />
          <span className="hidden sm:inline">Download</span> Template CSV
        </button>
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs text-center space-y-4">
          <div className="max-w-md mx-auto py-8 px-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl bg-slate-50/50 dark:bg-slate-800/20 hover:border-indigo-500 transition">
            <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 flex items-center justify-center mx-auto mb-3">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Choose your Inventory CSV File
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
              UTF-8 CSV formatted file with gadget name, price, stock, and SKU columns.
            </p>

            <label className="mt-4 inline-block px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition cursor-pointer shadow-sm">
              Select CSV File
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>

          <div className="max-w-md mx-auto text-left bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl text-xs space-y-1.5 text-slate-600 dark:text-slate-300">
            <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-emerald-500" />
              Standard 5-Column CSV Format:
            </p>
            <p className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-white dark:bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
              name, category, cost_price, selling_price, quantity
            </p>
            <p className="text-[11px] text-slate-500 pt-0.5 leading-relaxed">
              &bull; <strong>Auto-Generated SKUs:</strong> The system automatically assigns a unique SKU code (e.g. <code>ALQ-AUX-101</code>) to every item upon import.
              <br />
              &bull; <strong>name</strong>, <strong>selling_price</strong>, and <strong>quantity</strong> are required.
            </p>
          </div>
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {step === 'mapping' && parseResult && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Step 2: Map Your CSV Column Headers
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Match the columns in your file ({selectedFile?.name}) to the ShopLedger catalog fields.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {CSV_TEMPLATE_HEADERS.map((targetField) => {
              const isRequired = ['name', 'selling_price', 'quantity'].includes(targetField);

              return (
                <div
                  key={targetField}
                  className="p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between gap-2"
                >
                  <div>
                    <label className="font-semibold text-slate-800 dark:text-slate-200 capitalize">
                      {targetField.replace('_', ' ')}
                    </label>
                    {isRequired && <span className="text-rose-500 font-bold ml-1">*</span>}
                  </div>

                  <select
                    value={columnMapping[targetField] || ''}
                    onChange={(e) =>
                      setColumnMapping({ ...columnMapping, [targetField]: e.target.value })
                    }
                    className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                  >
                    <option value="">(Skip / Not in CSV)</option>
                    {parseResult.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setStep('upload')}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              Back
            </button>
            <button
              onClick={applyColumnMapping}
              className="px-5 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 flex items-center gap-1.5"
            >
              <span>Validate & Preview</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Validation & Preview */}
      {step === 'preview' && parseResult && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Step 3: Validation & Import Settings
            </h3>
            <p className="text-xs text-slate-500">
              Review parsed rows before executing database insertion.
            </p>
          </div>

          {/* Validation Metrics */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-500">Total Rows</span>
              <p className="font-black text-lg text-slate-900 dark:text-white">
                {parseResult.totalRows}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300">
              <span>Valid Ready</span>
              <p className="font-black text-lg">{parseResult.validRows.length}</p>
            </div>
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300">
              <span>Errors Found</span>
              <p className="font-black text-lg">{parseResult.errors.length}</p>
            </div>
          </div>

          {/* Duplicate Handling Policy */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5 text-xs">
            <label className="block font-bold text-slate-900 dark:text-white">
              Duplicate SKU Handling Strategy:
            </label>
            <p className="text-[11px] text-slate-500">
              When an uploaded SKU already exists in the store catalog:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="dup"
                  value="add_stock"
                  checked={duplicateMode === 'add_stock'}
                  onChange={() => setDuplicateMode('add_stock')}
                  className="text-indigo-600"
                />
                <div>
                  <span className="font-semibold block">Add to Stock</span>
                  <span className="text-[10px] text-slate-400">Increase existing qty</span>
                </div>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="dup"
                  value="update"
                  checked={duplicateMode === 'update'}
                  onChange={() => setDuplicateMode('update')}
                  className="text-indigo-600"
                />
                <div>
                  <span className="font-semibold block">Update Details</span>
                  <span className="text-[10px] text-slate-400">Overwrite price & fields</span>
                </div>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="dup"
                  value="skip"
                  checked={duplicateMode === 'skip'}
                  onChange={() => setDuplicateMode('skip')}
                  className="text-indigo-600"
                />
                <div>
                  <span className="font-semibold block">Skip Duplicate</span>
                  <span className="text-[10px] text-slate-400">Keep existing intact</span>
                </div>
              </label>
            </div>
          </div>

          {/* Error Rows Table if any */}
          {parseResult.errors.length > 0 && (
            <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-rose-800 dark:text-rose-300 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Validation Issues ({parseResult.errors.length} rows skipped)
                </span>
                <button
                  onClick={handleDownloadErrors}
                  className="text-[11px] font-semibold text-rose-700 dark:text-rose-300 underline flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  Download Errors CSV
                </button>
              </div>

              <div className="max-h-36 overflow-y-auto space-y-1 text-[11px]">
                {parseResult.errors.slice(0, 10).map((err, idx) => (
                  <div
                    key={idx}
                    className="p-1.5 rounded bg-white/80 dark:bg-slate-900/80 border border-rose-100 dark:border-rose-950 text-rose-700 dark:text-rose-300 flex justify-between"
                  >
                    <span>
                      Row #{err.row}: <strong>{err.name}</strong> ({err.field})
                    </span>
                    <span className="font-medium">{err.error}</span>
                  </div>
                ))}
                {parseResult.errors.length > 10 && (
                  <p className="text-[10px] text-rose-600 italic">
                    ...and {parseResult.errors.length - 10} more error rows. Download CSV for full list.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Valid Items Sample Preview */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Valid Items Sample (Showing first 5 of {parseResult.validRows.length})
            </span>
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden text-[11px]">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-semibold">
                  <tr>
                    <th className="p-2">SKU</th>
                    <th className="p-2">Name</th>
                    <th className="p-2">Category</th>
                    <th className="p-2 text-right">Price</th>
                    <th className="p-2 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {parseResult.validRows.slice(0, 5).map((row, idx) => (
                    <tr key={idx}>
                      <td className="p-2 font-mono">{row.sku}</td>
                      <td className="p-2 font-medium">{row.name}</td>
                      <td className="p-2 text-slate-500">{row.category}</td>
                      <td className="p-2 text-right font-bold">
                        {row.sellingPrice.toFixed(2)}
                      </td>
                      <td className="p-2 text-right">{row.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between items-center pt-2">
            <button
              onClick={() => setStep('mapping')}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              Re-map Headers
            </button>

            <button
              onClick={handleStartImport}
              disabled={parseResult.validRows.length === 0}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition disabled:opacity-50 flex items-center gap-2 shadow-sm"
            >
              <FileCheck className="w-4 h-4" />
              <span>Confirm & Import {parseResult.validRows.length} Items</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Batch Importing Progress */}
      {step === 'importing' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-xs text-center space-y-4">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
          <h3 className="font-bold text-base text-slate-900 dark:text-white">
            Importing Items in Resumable Batches...
          </h3>
          <p className="text-xs text-slate-500">
            Processed {progressRow} rows ({progressPercent}%)
          </p>

          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden max-w-md mx-auto">
            <div
              className="bg-emerald-600 h-full transition-all duration-150"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Step 5: Completed Summary */}
      {step === 'complete' && importSummary && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs text-center space-y-4 animate-in fade-in zoom-in-95">
          <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            CSV Import Completed!
          </h2>
          <p className="text-xs text-slate-500">File: {importSummary.fileName}</p>

          <div className="grid grid-cols-3 gap-2 max-w-md mx-auto text-xs">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-500">New Items Added</span>
              <p className="font-bold text-base text-emerald-600 mt-1">
                {importSummary.rowsAdded}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-500">Updated / Stock Added</span>
              <p className="font-bold text-base text-indigo-600 mt-1">
                {importSummary.rowsUpdated}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-500">Failed / Skipped</span>
              <p className="font-bold text-base text-rose-500 mt-1">
                {importSummary.rowsFailed}
              </p>
            </div>
          </div>

          <div className="flex justify-center gap-3 pt-3">
            <button
              onClick={() => {
                setStep('upload');
                setSelectedFile(null);
                setParseResult(null);
              }}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              Import Another File
            </button>
            <button
              onClick={onBack}
              className="px-6 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold shadow-sm"
            >
              Return to Inventory
            </button>
          </div>
        </div>
      )}

      {/* Import History & Undo Log */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2.5">
        <h3 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white flex items-center justify-between">
          <span>Import History & Rollback</span>
          <span className="text-[10px] text-slate-400 font-normal">
            Safely undo the last batch import
          </span>
        </h3>

        {history.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center">No CSV imports logged yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {history.map((rec, idx) => (
              <div
                key={rec.id}
                className="py-2.5 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white truncate">
                    {rec.fileName}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {formatDateTime(rec.createdAt)} &bull; {rec.rowsAdded} added, {rec.rowsUpdated} updated
                  </p>
                </div>

                {idx === 0 && (
                  <button
                    onClick={() => handleUndoImport(rec)}
                    disabled={isUndoing}
                    className="px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 text-xs font-medium flex items-center gap-1 cursor-pointer"
                    title="Undo this import"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Undo</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
