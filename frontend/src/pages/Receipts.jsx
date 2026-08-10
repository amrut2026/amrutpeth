import { useEffect, useState } from 'react';
import api from '../api.js';

export default function Receipts() {
  const [receipts, setReceipts] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [form, setForm] = useState({ voucherId: '', amount: '', mode: 'CASH' });

  async function load() {
    const [r, v] = await Promise.all([api.get('/receipts'), api.get('/vouchers')]);
    setReceipts(r.data);
    setVouchers(v.data.filter((x) => x.status !== 'PAID'));
  }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    await api.post('/receipts', form);
    setForm({ voucherId: '', amount: '', mode: 'CASH' });
    load();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Receipts</h1>

      <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 grid grid-cols-1 md:grid-cols-4 gap-3">
        <select className="border rounded px-2 py-1" required
          value={form.voucherId} onChange={(e) => setForm({ ...form, voucherId: e.target.value })}>
          <option value="">Voucher...</option>
          {vouchers.map((v) => <option key={v.id} value={v.id}>#{v.id} · ₹{v.amount} ({v.status})</option>)}
        </select>
        <input type="number" step="0.01" placeholder="Amount received" className="border rounded px-2 py-1" required
          value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <select className="border rounded px-2 py-1"
          value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
          <option value="CASH">CASH</option>
          <option value="UPI">UPI</option>
          <option value="CARD">CARD</option>
        </select>
        <button className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">Record Receipt</button>
      </form>

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2">#</th>
              <th className="text-left p-2">Voucher</th>
              <th className="text-left p-2">Amount</th>
              <th className="text-left p-2">Mode</th>
              <th className="text-left p-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{r.id}</td>
                <td className="p-2">#{r.voucherId}</td>
                <td className="p-2">₹{Number(r.amount).toFixed(2)}</td>
                <td className="p-2">{r.mode}</td>
                <td className="p-2">{new Date(r.date).toLocaleDateString()}</td>
              </tr>
            ))}
            {receipts.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={5}>No receipts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
