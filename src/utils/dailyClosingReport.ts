import { Sale, Shop } from '../types';
import { formatCurrency, formatDateTime } from './formatters';

export interface DailyClosingSummary {
  dateStr: string;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  salesCount: number;
  unitsSold: number;
  averageTicket: number;
  paymentsBreakdown: Record<string, number>;
  cashierBreakdown: Record<string, { count: number; total: number }>;
  topItems: { name: string; qty: number; total: number }[];
}

export function calculateDailyClosing(
  sales: Sale[],
  dateStr: string = new Date().toISOString().slice(0, 10)
): DailyClosingSummary {
  const daySales = sales.filter((s) => {
    if (s.status === 'voided') return false;
    const sDate = new Date(s.createdAtClient).toISOString().slice(0, 10);
    return sDate === dateStr;
  });

  let totalRevenue = 0;
  let totalCost = 0;
  let unitsSold = 0;
  const paymentsBreakdown: Record<string, number> = {};
  const cashierBreakdown: Record<string, { count: number; total: number }> = {};
  const itemMap: Record<string, { name: string; qty: number; total: number }> = {};

  for (const sale of daySales) {
    totalRevenue += sale.total;

    // Payments
    if (sale.payments && sale.payments.length > 0) {
      for (const p of sale.payments) {
        paymentsBreakdown[p.method] = (paymentsBreakdown[p.method] || 0) + p.amount;
      }
    } else {
      paymentsBreakdown['Cash'] = (paymentsBreakdown['Cash'] || 0) + sale.total;
    }

    // Cashier
    const cName = sale.sellerName || 'Staff';
    if (!cashierBreakdown[cName]) {
      cashierBreakdown[cName] = { count: 0, total: 0 };
    }
    cashierBreakdown[cName].count += 1;
    cashierBreakdown[cName].total += sale.total;

    // Lines & cost
    for (const line of sale.lines) {
      unitsSold += line.qty;
      const lineCost = (line.costPriceAtSale || 0) * line.qty;
      totalCost += lineCost;

      if (!itemMap[line.name]) {
        itemMap[line.name] = { name: line.name, qty: 0, total: 0 };
      }
      itemMap[line.name].qty += line.qty;
      itemMap[line.name].total += line.lineTotal || 0;
    }
  }

  const grossProfit = totalRevenue - totalCost;
  const averageTicket = daySales.length > 0 ? totalRevenue / daySales.length : 0;
  const topItems = Object.values(itemMap)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  return {
    dateStr,
    totalRevenue,
    totalCost,
    grossProfit,
    salesCount: daySales.length,
    unitsSold,
    averageTicket,
    paymentsBreakdown,
    cashierBreakdown,
    topItems,
  };
}

/**
 * Format crisp WhatsApp text message & generate wa.me link
 */
export function generateWhatsAppClosingUrl(
  summary: DailyClosingSummary,
  shop: Shop | null,
  phoneNumber?: string
): string {
  const shopName = shop?.name || 'AL-Q ELECTRICALS';
  const currencySymbol = shop?.currencySymbol || 'GH₵';
  const cleanPhone = (phoneNumber || shop?.phone || '').replace(/[^0-9]/g, '');

  let text = `📊 *${shopName.toUpperCase()} - DAILY CLOSING REPORT*\n`;
  text += `📅 Date: ${summary.dateStr}\n`;
  text += `⏰ Closed At: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}\n\n`;

  text += `💰 *TOTAL SALES:* ${currencySymbol}${summary.totalRevenue.toFixed(2)}\n`;
  text += `🧾 *Invoices Count:* ${summary.salesCount}\n`;
  text += `📦 *Units Deducted:* ${summary.unitsSold} items\n`;
  text += `📈 *Est. Gross Profit:* ${currencySymbol}${summary.grossProfit.toFixed(2)}\n`;
  text += `🎯 *Average Basket:* ${currencySymbol}${summary.averageTicket.toFixed(2)}\n\n`;

  // Payment Breakdown
  text += `💳 *PAYMENT BREAKDOWN:*\n`;
  for (const [method, amount] of Object.entries(summary.paymentsBreakdown)) {
    text += `• ${method}: ${currencySymbol}${amount.toFixed(2)}\n`;
  }
  text += `\n`;

  // Cashier Breakdown
  if (Object.keys(summary.cashierBreakdown).length > 0) {
    text += `🧑‍💼 *STAFF / CASHIERS:*\n`;
    for (const [name, stats] of Object.entries(summary.cashierBreakdown)) {
      text += `• ${name}: ${stats.count} sales (${currencySymbol}${stats.total.toFixed(2)})\n`;
    }
    text += `\n`;
  }

  // Top Items
  if (summary.topItems.length > 0) {
    text += `🏆 *TOP SELLING ITEMS:*\n`;
    summary.topItems.forEach((item, idx) => {
      text += `${idx + 1}. ${item.name} (${item.qty} pcs - ${currencySymbol}${item.total.toFixed(2)})\n`;
    });
    text += `\n`;
  }

  text += `✅ *Day verified & closed in ShopLedger POS.*`;

  const encoded = encodeURIComponent(text);
  return cleanPhone ? `https://wa.me/${cleanPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

/**
 * Generate formatted HTML printable report (Save as PDF)
 */
export function printDailyClosingPDF(summary: DailyClosingSummary, shop: Shop | null): void {
  const shopName = shop?.name || 'AL-Q ELECTRICALS';
  const currencySymbol = shop?.currencySymbol || 'GH₵';
  const nowStr = new Date().toLocaleString();

  const printWindow = window.open('', '_blank', 'width=800,height=900');
  if (!printWindow) {
    window.print();
    return;
  }

  const paymentsHtml = Object.entries(summary.paymentsBreakdown)
    .map(
      ([m, a]) =>
        `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e2e8f0;"><span>${m}</span><b>${currencySymbol}${a.toFixed(2)}</b></div>`
    )
    .join('');

  const cashiersHtml = Object.entries(summary.cashierBreakdown)
    .map(
      ([c, s]) =>
        `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e2e8f0;"><span>${c} (${s.count} txns)</span><b>${currencySymbol}${s.total.toFixed(2)}</b></div>`
    )
    .join('');

  const topItemsHtml = summary.topItems
    .map(
      (it, idx) =>
        `<tr>
          <td style="padding:6px;border-bottom:1px solid #e2e8f0;">${idx + 1}. ${it.name}</td>
          <td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:center;">${it.qty}</td>
          <td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:right;">${currencySymbol}${it.total.toFixed(2)}</td>
        </tr>`
    )
    .join('');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Daily Closing Report - ${summary.dateStr}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; color: #0f172a; max-width: 700px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
          .header h1 { margin: 0; font-size: 20px; font-weight: 900; letter-spacing: -0.5px; }
          .header p { margin: 3px 0 0; font-size: 11px; color: #64748b; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
          .stat-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; }
          .stat-label { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700; }
          .stat-val { font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 2px; }
          .section-title { font-size: 12px; font-weight: 800; text-transform: uppercase; margin: 16px 0 8px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 16px; }
          th { text-align: left; background: #f1f5f9; padding: 6px; font-weight: 700; }
          .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px dashed #cbd5e1; padding-top: 10px; }
          @media print {
            body { padding: 0; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${shopName}</h1>
          <p>DAILY SALES & INVENTORY CLOSING STATEMENT</p>
          <p><b>Date:</b> ${summary.dateStr} &bull; <b>Generated:</b> ${nowStr}</p>
        </div>

        <div class="grid">
          <div class="stat-card">
            <div class="stat-label">Total Revenue</div>
            <div class="stat-val" style="color: #059669;">${currencySymbol}${summary.totalRevenue.toFixed(2)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Invoices</div>
            <div class="stat-val">${summary.salesCount}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Units Deducted</div>
            <div class="stat-val">${summary.unitsSold} pcs</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Est. Gross Margin</div>
            <div class="stat-val">${currencySymbol}${summary.grossProfit.toFixed(2)}</div>
          </div>
        </div>

        <div class="section-title">Payment Collections</div>
        <div style="font-size: 11px; margin-bottom: 12px;">${paymentsHtml}</div>

        <div class="section-title">Cashier Performance</div>
        <div style="font-size: 11px; margin-bottom: 12px;">${cashiersHtml}</div>

        <div class="section-title">Top Selling Products</div>
        <table>
          <thead>
            <tr>
              <th>Product Name</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Total Revenue</th>
            </tr>
          </thead>
          <tbody>
            ${topItemsHtml || '<tr><td colspan="3" style="text-align:center;padding:12px;">No items sold on this date</td></tr>'}
          </tbody>
        </table>

        <div class="footer">
          <p>AL-Q ELECTRICALS &bull; End-of-Day Official Audit &bull; Generated from ShopLedger</p>
        </div>

        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

/**
 * Generate formatted Mailto Link for sending via Email
 */
export function generateEmailClosingMailto(
  summary: DailyClosingSummary,
  shop: Shop | null,
  recipientEmail?: string
): string {
  const shopName = shop?.name || 'AL-Q ELECTRICALS';
  const currencySymbol = shop?.currencySymbol || 'GH₵';
  const to = recipientEmail || shop?.settings?.closingReportEmail || 'wisdomosborn65@gmail.com';

  const subject = `[Daily Closing Report] ${shopName} - ${summary.dateStr} (${currencySymbol}${summary.totalRevenue.toFixed(2)})`;
  
  let body = `${shopName} - Daily Sales Closing Summary\n`;
  body += `Date: ${summary.dateStr}\n\n`;
  body += `TOTAL SALES REVENUE: ${currencySymbol}${summary.totalRevenue.toFixed(2)}\n`;
  body += `TOTAL INVOICES: ${summary.salesCount}\n`;
  body += `TOTAL UNITS DEDUCTED: ${summary.unitsSold}\n`;
  body += `EST. GROSS PROFIT: ${currencySymbol}${summary.grossProfit.toFixed(2)}\n\n`;

  body += `PAYMENT METHODS:\n`;
  for (const [m, a] of Object.entries(summary.paymentsBreakdown)) {
    body += `- ${m}: ${currencySymbol}${a.toFixed(2)}\n`;
  }
  body += `\n`;

  body += `STAFF / CASHIERS:\n`;
  for (const [name, stats] of Object.entries(summary.cashierBreakdown)) {
    body += `- ${name}: ${stats.count} sales, ${currencySymbol}${stats.total.toFixed(2)}\n`;
  }
  body += `\n`;

  body += `TOP PRODUCTS:\n`;
  summary.topItems.forEach((it, idx) => {
    body += `${idx + 1}. ${it.name} - ${it.qty} pcs (${currencySymbol}${it.total.toFixed(2)})\n`;
  });
  body += `\nVerified and closed via ShopLedger.`;

  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
