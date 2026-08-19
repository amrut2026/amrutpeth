import { Fragment, useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

// Vouchers is view (+ create, for DEALER) only. Paying down a PAYABLE
// (supplier) voucher happens on the Payments screen instead — the same
// split already used on the retailer side, where Vouchers.jsx is
// view-only and Receipts.jsx ("Payments (Pay Dealer)") is where the
// actual payment gets recorded against a RECEIVABLE voucher.
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

  function balanceRemaining(v) {
    const paid = (v.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
    return Number(v.amount) - paid;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">
        Vouchers <span className="text-base font-normal text-gray-500">(व्हाउचर)</span>
        {user.role === 'RETAILER' ? ' (Received / मिळालेले)' : ''}
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

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2">#</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Party</th>
              <th className="text-left p-2">Amount / रक्कम</th>
              <th className="text-left p-2">Description / वर्णन</th>
              <th className="text-left p-2">Status / स्थिती</th>
              <th className="text-left p-2">Date / दिनांक</th>
            </tr>
          </thead>
          <tbody>
            {vouchers.map((v) => {
              const isPayable = v.type === 'PAYABLE';
              const partyName = isPayable ? (v.supplier?.name || v.supplierId) : (v.retailer?.name || v.retailerId);
              const remaining = balanceRemaining(v);
              return (
                <Fragment key={v.id}>
                  <tr className="border-t">
                    <td className="p-2">{v.id}</td>
                    <td className="p-2">
                      <span className={isPayable ? 'text-amber-700' : 'text-emerald-700'}>
                        {isPayable ? 'Payable (Supplier)' : 'Receivable (Retailer)'}
                      </span>
                    </td>
                    <td className="p-2">{partyName}</td>
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
                </Fragment>
              );
            })}
            {vouchers.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={7}>No vouchers yet. / अद्याप व्हाउचर नाहीत.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
