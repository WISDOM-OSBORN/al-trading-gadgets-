import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Sale, OwnerWithdrawal } from '../../types';
import { db } from '../../db';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { downloadCSV } from '../../utils/csv';
import {
  calculateDailyClosing,
  generateWhatsAppClosingUrl,
  printDailyClosingPDF,
} from '../../utils/dailyClosingReport';
import Papa from 'papaparse';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  DollarSign,
  Boxes,
  Users,
  TrendingUp,
  Share2,
  Printer,
  PackageMinus,
} from 'lucide-react';

export const ReportsScreen: React.FC = () => {
  const { currentShop } = useAuth();
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [sales, setSales] = useState<Sale[]>([]);
  const [withdrawals, setWithdrawals] = useState<OwnerWithdrawal[]>([]);

  const loadData = async () => {
    if (!currentShop) return;
    const allSales = await db.sales
      .where('shopId')
      .equals(currentShop.id)
      .toArray();
    setSales(allSales.filter((s) => s.status !== 'voided'));

    const allWithdrawals = await db.withdrawals
      .where('shopId')
      .equals(currentShop.id)
      .toArray();
    setWithdrawals(allWithdrawals);
  };

  useEffect(() => {
    loadData();
  }, [currentShop]);

  // Filter sales for the selected date
  const daySales = useMemo(() => {
    return sales.filter((s) => {
      const dStr = new Date(s.createdAtClient).toISOString().slice(0, 10);
      return dStr === selectedDate;
    });
  }, [sales, selectedDate]);

  // Filter withdrawals for the selected date
  const dayWithdrawals = useMemo(() => {
    return withdrawals.filter((w) => {
      const dStr = new Date(w.createdAt).toISOString().slice(0, 10);
      return dStr === selectedDate;
    });
  }, [withdrawals, selectedDate]);

  // Aggregate stats for the day
  const totalRevenue = daySales.reduce((sum, s) => sum + s.total, 0);
  const totalSalesCount = daySales.length;
  const totalUnitsSold = daySales.reduce((sum, s) => {
    return sum + s.lines.reduce((lSum, l) => lSum + l.qty, 0);
  }, 0);
  const avgSale = totalSalesCount > 0 ? totalRevenue / totalSalesCount : 0;

  const totalUnitsWithdrawn = dayWithdrawals.reduce((sum, w) => sum + (w.quantity || 0), 0);
  const totalWithdrawnCost = dayWithdrawals.reduce((sum, w) => sum + (w.totalCostValue || 0), 0);
  const totalUnitsDeducted = totalUnitsSold + totalUnitsWithdrawn;

  // Export Daily Sales CSV
  const handleExportDailySales = () => {
    const exportData = daySales.map((s) => ({
      invoice_no: s.invoiceNo,
      time_sold: formatDateTime(s.createdAtClient),
      cashier: s.sellerName,
      items: s.lines.map((l) => `${l.qty}x ${l.name}`).join('; '),
      units_sold: s.lines.reduce((sum, l) => sum + l.qty, 0),
      total_amount: s.total.toFixed(2),
      device_code: s.deviceCode,
    }));

    const csv = Papa.unparse(exportData);
    downloadCSV(csv, `sales-report-${selectedDate}.csv`);
  };

  // Export Daily Withdrawals CSV
  const handleExportDailyWithdrawals = () => {
    const exportData = dayWithdrawals.map((w) => ({
      withdrawal_id: w.id,
      timestamp: formatDateTime(w.createdAt),
      gadget: w.itemName,
      sku: w.itemSku,
      quantity_taken: w.quantity,
      unit_cost: w.costPrice.toFixed(2),
      total_cost_value: w.totalCostValue.toFixed(2),
      authorized_by: w.userName,
      reason: w.reason,
    }));

    const csv = Papa.unparse(exportData);
    downloadCSV(csv, `withdrawals-report-${selectedDate}.csv`);
  };

  // 1-Tap WhatsApp Summary
  const handleShareWhatsApp = () => {
    const summary = calculateDailyClosing(daySales, selectedDate, dayWithdrawals);
    const url = generateWhatsAppClosingUrl(
      summary,
      currentShop,
      currentShop?.settings?.closingReportWhatsapp
    );
    window.open(url, '_blank');
  };

  // 1-Tap Printable PDF
  const handlePrintPDF = () => {
    const summary = calculateDailyClosing(daySales, selectedDate, dayWithdrawals);
    printDailyClosingPDF(summary, currentShop);
  };

  return (
    <div className="pb-24 pt-1 max-w-4xl mx-auto px-2 sm:px-4 space-y-3">
      {/* Top Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
            <span>Daily Sales & Inventory Deduction Reports</span>
          </h1>
          <p className="text-xs text-slate-500">
            Daily breakdown of sales amounts, units deducted, cashier activity, and owner withdrawals.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold"
          />

          <button
            onClick={handleShareWhatsApp}
            disabled={daySales.length === 0 && dayWithdrawals.length === 0}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
            title="Share to WhatsApp"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>WhatsApp</span>
          </button>

          <button
            onClick={handlePrintPDF}
            disabled={daySales.length === 0 && dayWithdrawals.length === 0}
            className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold hover:bg-slate-800 dark:hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
            title="Print or Save as PDF"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>PDF</span>
          </button>

          <button
            onClick={handleExportDailySales}
            disabled={daySales.length === 0}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
            title="Export Sales CSV"
          >
            <Download className="w-3.5 h-3.5 text-emerald-500" />
            <span>Sales CSV</span>
          </button>

          {dayWithdrawals.length > 0 && (
            <button
              onClick={handleExportDailyWithdrawals}
              className="px-3 py-1.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-100 flex items-center gap-1.5 cursor-pointer shadow-xs"
              title="Export Withdrawals CSV"
            >
              <Download className="w-3.5 h-3.5 text-amber-500" />
              <span>Withdrawals CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* Daily Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] text-slate-500 font-medium">Daily Revenue</span>
          <p className="text-lg font-black text-slate-900 dark:text-white mt-1">
            {formatCurrency(totalRevenue, currentShop?.currency)}
          </p>
          <span className="text-[10px] text-emerald-600 font-medium">{totalSalesCount} sales recorded</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] text-indigo-600 font-medium">Total Deducted</span>
          <p className="text-lg font-black text-indigo-600 mt-1">
            {totalUnitsDeducted} items
          </p>
          <span className="text-[10px] text-slate-400">
            {totalUnitsSold} sold &bull; {totalUnitsWithdrawn} takeout
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] text-amber-600 font-medium flex items-center gap-1">
            <PackageMinus className="w-3.5 h-3.5" />
            <span>Owner Takeout</span>
          </span>
          <p className="text-lg font-black text-amber-600 mt-1">
            {formatCurrency(totalWithdrawnCost, currentShop?.currency)}
          </p>
          <span className="text-[10px] text-slate-400">
            {totalUnitsWithdrawn} pcs ({dayWithdrawals.length} times)
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] text-purple-600 font-medium">Avg Sale Value</span>
          <p className="text-lg font-black text-slate-900 dark:text-white mt-1">
            {formatCurrency(avgSale, currentShop?.currency)}
          </p>
          <span className="text-[10px] text-slate-400">Per transaction</span>
        </div>
      </div>

      {/* Daily Sales Ledger Breakdown */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <h2 className="font-bold text-sm text-slate-900 dark:text-white flex items-center justify-between">
          <span>Sales Ledger for {selectedDate}</span>
          <span className="text-xs text-slate-400 font-normal">{daySales.length} records</span>
        </h2>

        {daySales.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center">No sales recorded on this date.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {daySales.map((sale) => (
              <div key={sale.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {sale.invoiceNo}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {formatDateTime(sale.createdAtClient)}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 truncate mt-0.5">
                    {sale.lines.map((l) => `${l.qty}x ${l.name}`).join(', ')}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Seller: {sale.sellerName} &bull; Device: {sale.deviceCode}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-bold text-sm text-slate-900 dark:text-white">
                    {formatCurrency(sale.total, currentShop?.currency)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Owner Withdrawals Ledger Breakdown */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-amber-200/70 dark:border-amber-900/50 shadow-xs space-y-3">
        <h2 className="font-bold text-sm text-amber-800 dark:text-amber-300 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <PackageMinus className="w-4 h-4 text-amber-600" />
            <span>Owner Inventory Withdrawals for {selectedDate}</span>
          </span>
          <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">
            {dayWithdrawals.length} records ({totalUnitsWithdrawn} pcs &bull; Cost: {formatCurrency(totalWithdrawnCost, currentShop?.currency)})
          </span>
        </h2>

        {dayWithdrawals.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center">No owner withdrawals recorded on this date.</p>
        ) : (
          <div className="divide-y divide-amber-100 dark:divide-amber-950/60 text-xs">
            {dayWithdrawals.map((w) => (
              <div key={w.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white truncate">
                      {w.itemName}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">
                      {w.itemSku}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {formatDateTime(w.createdAt)}
                    </span>
                  </div>
                  <p className="text-amber-700 dark:text-amber-400 text-[11px] mt-0.5">
                    Reason: <strong>{w.reason || 'Personal / Store maintenance'}</strong>
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Authorized by: {w.userName}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-bold text-sm text-amber-700 dark:text-amber-400">
                    {w.quantity} pcs
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Cost: {formatCurrency(w.totalCostValue, currentShop?.currency)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
