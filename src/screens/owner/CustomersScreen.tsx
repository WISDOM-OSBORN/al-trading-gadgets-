import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Customer, CustomerPayment, PaymentMethod } from '../../types';
import { db } from '../../db';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  Users,
  Search,
  DollarSign,
  PlusCircle,
  Phone,
  AlertCircle,
  CheckCircle2,
  X,
} from 'lucide-react';

export const CustomersScreen: React.FC = () => {
  const { currentShop, currentUser } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOwedOnly, setFilterOwedOnly] = useState(true);

  // Pay modal state
  const [payingCustomer, setPayingCustomer] = useState<Customer | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Cash');
  const [payNote, setPayNote] = useState('');
  const [isSubmittingPay, setIsSubmittingPay] = useState(false);

  const loadCustomers = async () => {
    if (!currentShop) return;
    const all = await db.customers.where('shopId').equals(currentShop.id).toArray();
    setCustomers(all);
  };

  useEffect(() => {
    loadCustomers();
    const handleUpdate = () => {
      loadCustomers();
    };
    window.addEventListener('shopledger_sales_updated', handleUpdate);
    return () => {
      window.removeEventListener('shopledger_sales_updated', handleUpdate);
    };
  }, [currentShop]);

  const filtered = customers.filter((c) => {
    const q = searchQuery.toLowerCase().trim();
    const matches =
      !q || c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q));
    if (!matches) return false;
    if (filterOwedOnly && (!c.balanceOwed || c.balanceOwed <= 0)) return false;
    return true;
  });

  const totalOwed = customers.reduce((s, c) => s + (c.balanceOwed || 0), 0);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingCustomer || !currentShop || !currentUser || payAmount <= 0) return;

    try {
      setIsSubmittingPay(true);
      const now = Date.now();

      await db.transaction('rw', [db.customers, db.customerPayments, db.auditLogs], async () => {
        const newBalance = Math.max(0, (payingCustomer.balanceOwed || 0) - payAmount);
        await db.customers.update(payingCustomer.id, {
          balanceOwed: newBalance,
          updatedAt: now,
        });

        const paymentRecord: CustomerPayment = {
          id: `pay-${Date.now()}`,
          shopId: currentShop.id,
          customerId: payingCustomer.id,
          customerName: payingCustomer.name,
          amount: payAmount,
          method: payMethod,
          note: payNote,
          userId: currentUser.uid,
          userName: currentUser.name,
          createdAt: now,
        };
        await db.customerPayments.add(paymentRecord);

        await db.auditLogs.add({
          id: `audit-${Date.now()}`,
          shopId: currentShop.id,
          action: 'sale_created',
          entity: 'customerPayments',
          entityId: paymentRecord.id,
          userId: currentUser.uid,
          userName: currentUser.name,
          meta: {
            customerName: payingCustomer.name,
            amount: payAmount,
            method: payMethod,
          },
          createdAt: now,
        });
      });

      setPayingCustomer(null);
      setPayAmount(0);
      setPayNote('');
      await loadCustomers();
    } finally {
      setIsSubmittingPay(false);
    }
  };

  return (
    <div className="pb-24 pt-1 max-w-4xl mx-auto px-2 sm:px-4 space-y-3">
      {/* Header & KPI */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-4 sm:p-5 shadow-xs flex items-center justify-between">
        <div>
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <Users className="w-4 h-4 text-emerald-400" />
            Customer Credit & Debtors
          </span>
          <h2 className="text-2xl font-black mt-1">
            {formatCurrency(totalOwed, currentShop?.currency)}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Total outstanding balances owed by customers</p>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search customers by name or phone number..."
            className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setFilterOwedOnly(true)}
            className={`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer ${
              filterOwedOnly
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            Owing Money ({customers.filter((c) => (c.balanceOwed || 0) > 0).length})
          </button>
          <button
            onClick={() => setFilterOwedOnly(false)}
            className={`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer ${
              !filterOwedOnly
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            All Customers ({customers.length})
          </button>
        </div>
      </div>

      {/* Customers List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs divide-y divide-slate-100 dark:divide-slate-800">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No customers found. Customers are automatically saved when credit sales or customer names are entered.
          </div>
        ) : (
          filtered.map((cust) => {
            const owes = (cust.balanceOwed || 0) > 0;

            return (
              <div
                key={cust.id}
                className="p-3 sm:p-4 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                    {cust.name}
                  </h3>
                  {cust.phone && (
                    <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3" />
                      <span>{cust.phone}</span>
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Customer since {formatDateTime(cust.createdAt)}
                  </p>
                </div>

                <div className="text-right shrink-0 flex items-center gap-3">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Balance Owed</span>
                    <p
                      className={`font-black text-sm sm:text-base ${
                        owes ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'
                      }`}
                    >
                      {formatCurrency(cust.balanceOwed || 0, currentShop?.currency)}
                    </p>
                  </div>

                  {owes && (
                    <button
                      onClick={() => {
                        setPayingCustomer(cust);
                        setPayAmount(cust.balanceOwed || 0);
                        setPayMethod('Cash');
                        setPayNote('');
                      }}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition cursor-pointer shadow-xs"
                    >
                      Receive Pay
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Record Payment Modal */}
      {payingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800 mb-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Receive Debt Payment
              </h3>
              <button
                onClick={() => setPayingCustomer(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Customer: <span className="font-bold text-slate-800 dark:text-slate-200">{payingCustomer.name}</span>
            </p>
            <p className="text-xs text-slate-500">
              Current Outstanding: <span className="font-bold text-rose-600">{formatCurrency(payingCustomer.balanceOwed || 0, currentShop?.currency)}</span>
            </p>

            <form onSubmit={handleRecordPayment} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Payment Amount Received ({currentShop?.currency}) *
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.01"
                  max={payingCustomer.balanceOwed || undefined}
                  required
                  value={payAmount === 0 ? '' : payAmount}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPayAmount(val === '' ? 0 : parseFloat(val) || 0);
                  }}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-sm"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Payment Method
                </label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                >
                  <option value="Cash">Cash</option>
                  <option value="Mobile Money">Mobile Money</option>
                  <option value="Card">Card</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Reference / Note
                </label>
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="e.g. Receipt #402 / Cash at counter"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPayingCustomer(null)}
                  className="flex-1 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={payAmount <= 0 || isSubmittingPay}
                  className="flex-1 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {isSubmittingPay ? 'Recording...' : 'Clear Debt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
