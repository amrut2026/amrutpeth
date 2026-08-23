import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

// Vouchers is view (+ create, for DEALER) only. Paying down a PAYABLE
// (supplier) voucher happens on the Payments screen instead — the same
// split already used on the retailer side, where Vouchers.jsx is
// view-only and Receipts.jsx ("Payments (Pay Dealer)") is where the
// actual payment gets recorded against a RECEIVABLE voucher.

function balanceRemaining(v) {
  const paid = (v.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  return Number(v.amount) - paid;
}

// Buckets a list of same-type vouchers by their counterparty name — supplier
// for PAYABLE, retailer for RECEIVABLE — so each renders as its own
// subsection under the Payable/Receivable section. Sorted alphabetically by
// counterparty so the layout doesn't reshuffle as new vouchers arrive.
function groupByCounterparty(vouchers, isPayable) {
  const map = new Map();
  for (const v of vouchers) {
    const key = isPayable
      ? (v.supplier?.name || `Supplier #${v.supplierId}`)
      : (v.retailer?.name || `Retailer #${v.retailerId}`);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function VoucherTable({ vouchers }) {
  const subtotal = vouchers.reduce((sum, v) => sum + Number(v.amount), 0);
  const subtotalRemaining = vouchers.reduce((sum, v) => sum + balanceRemaining(v), 0);
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-100">
        <tr>
          <th className="text-left p-2">#</th>
          <th className="text-left p-2">Amount / रक्कम</th>
          <th className="text-left p-2">Description / वर्णन</th>
          <th className="text-left p-2">Status / स्थिती</th>
          <th className="text-left p-2">Date / दिनांक</th>
        </tr>
      </thead>
      <tbody>
        {vouchers.map((v) => {
          const remaining = balanceRemaining(v);
          return (
            <tr key={v.id} className="border-t">
              <td className="p-2">{v.id}</td>
              <td className="p-2">₹{Number(v.amount).toFixed(2)}</td>
              <td className="p-2">{v.description}</td>
              <td className="p-2">
                <span className={
                  v.status === 'PAID' ? 'text-green-600' : v.status === 'PARTIALLY_PAID' ? 'text-amber-600' : 'text-red-600'
                }>{v.status}</span>
                {v.status !== 'PAID' && v.status !== 'OPEN' && (
                  <div className="text-xs text-gray-400">₹{remaining.toFixed(2)} remaining</div>
                )}
              </td>
              <td className="p-2">{new Date(v.date).toLocaleDateString()}</td>
            </tr>
          );
        })}
        <tr className="border-t bg-gray-50 font-medium">
          <td className="p-2">Subtotal <span className="text-xs font-normal text-gray-400">/ उपएकूण</span></td>
          <td className="p-2">₹{subtotal.toFixed(2)}</td>
          <td className="p-2" colSpan={2}>
            {subtotalRemaining > 0 && (
              <span className="text-xs font-normal text-gray-500">₹{subtotalRemaining.toFixed(2)} remaining / शिल्लक</span>
            )}
          </td>
          <td className="p-2"></td>
        </tr>
      </tbody>
    </table>
  );
}

// One top-level section — Payable or Receivable — broken into a subsection
// per counterparty. Renders nothing at all if there are no vouchers of this
// type, rather than an empty section header: a RETAILER, for instance, can
// never have a PAYABLE voucher of their own, so that whole section simply
// doesn't appear for that role instead of showing up empty every time.
function VoucherSection({ title, titleMr, vouchers, isPayable }) {
  if (!vouchers.length) return null;
  const groups = groupByCounterparty(vouchers, isPayable);
  const total = vouchers.reduce((sum, v) => sum + Number(v.amount), 0);
  const totalRemaining = vouchers.reduce((sum, v) => sum + balanceRemaining(v), 0);
  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">
          {title} <span className="text-sm font-normal text-gray-500">({titleMr})</span>
        </h2>
        <div className="text-sm">
          <span className="text-gray-500">Total</span> <span className="text-gray-400">/ एकूण:</span>{' '}
          <span className="font-semibold">₹{total.toFixed(2)}</span>
          {totalRemaining > 0 && (
            <span className="text-gray-500"> (₹{totalRemaining.toFixed(2)} remaining / शिल्लक)</span>
          )}
        </div>
      </div>
      <div className="space-y-4">
        {groups.map(([counterparty, group]) => (
          <div key={counterparty}>
            <div className="text-sm font-medium text-gray-600 mb-1">{counterparty}</div>
            <div className="bg-white rounded shadow overflow-x-auto">
              <VoucherTable vouchers={group} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Vouchers() {
  const { user } = useAuth();
  const [vouchers, setVouchers] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [form, setForm] = useState({ retailerId: '', amount: '', description: '' });

  async function load() {
    const v = await api.get('/vouchers');
    setVouchers(v.data);
    if (user.role === 'DEALER') {
      const r = await api.get('/retailers');
      setRetailers(r.data);
    }
  }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    await api.post('/vouchers', form);
    setForm({ retailerId: '', amount: '', description: '' });
    load();
  }

  const payableVouchers = vouchers.filter((v) => v.type === 'PAYABLE');
  const receivableVouchers = vouchers.filter((v) => v.type !== 'PAYABLE');

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">
        Vouchers <span className="text-base font-normal text-gray-500">(व्हाउचर)</span>
      </h1>

      {user.role === 'DEALER' && (
        <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 grid grid-cols-1 md:grid-cols-4 gap-3">
          <select className="border rounded px-2 py-1" required
            value={form.retailerId} onChange={(e) => setForm({ ...form, retailerId: e.target.value })}>
            <option value="">Retailer... / किरकोळ विक्रेता...</option>
            {retailers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input type="number" step="0.01" placeholder="Amount / रक्कम" className="border rounded px-2 py-1" required
            value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <input placeholder="Description / वर्णन" className="border rounded px-2 py-1 md:col-span-2"
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <button className="md:col-span-4 bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
            Generate Voucher / व्हाउचर तयार करा
          </button>
        </form>
      )}

      <VoucherSection
        title="Payable Vouchers (to Supplier)" titleMr="पुरवठादाराला देय व्हाउचर"
        vouchers={payableVouchers} isPayable
      />
      <VoucherSection
        title="Receivable Vouchers (from Retailer)" titleMr="किरकोळ विक्रेत्याकडून प्राप्य व्हाउचर"
        vouchers={receivableVouchers} isPayable={false}
      />

      {vouchers.length === 0 && (
        <div className="bg-white rounded shadow p-3 text-gray-400 text-sm">
          No vouchers yet. / अद्याप व्हाउचर नाहीत.
        </div>
      )}
    </div>
  );
}
