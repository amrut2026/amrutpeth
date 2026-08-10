import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

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

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Vouchers {user.role === 'RETAILER' ? '(Received)' : ''}</h1>

      {user.role === 'DEALER' && (
        <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 grid grid-cols-1 md:grid-cols-4 gap-3">
          <select className="border rounded px-2 py-1" required
            value={form.retailerId} onChange={(e) => setForm({ ...form, retailerId: e.target.value })}>
            <option value="">Retailer...</option>
            {retailers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input type="number" step="0.01" placeholder="Amount" className="border rounded px-2 py-1" required
            value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <input placeholder="Description" className="border rounded px-2 py-1 md:col-span-2"
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <button className="md:col-span-4 bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
            Generate Voucher
          </button>
        </form>
      )}

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2">#</th>
              <th className="text-left p-2">Retailer</th>
              <th className="text-left p-2">Amount</th>
              <th className="text-left p-2">Description</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {vouchers.map((v) => (
              <tr key={v.id} className="border-t">
                <td className="p-2">{v.id}</td>
                <td className="p-2">{v.retailer?.name || v.retailerId}</td>
                <td className="p-2">₹{Number(v.amount).toFixed(2)}</td>
                <td className="p-2">{v.description}</td>
                <td className="p-2">
                  <span className={
                    v.status === 'PAID' ? 'text-green-600' : v.status === 'PARTIALLY_PAID' ? 'text-amber-600' : 'text-red-600'
                  }>{v.status}</span>
                </td>
                <td className="p-2">{new Date(v.date).toLocaleDateString()}</td>
              </tr>
            ))}
            {vouchers.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={6}>No vouchers yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
