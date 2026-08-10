import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Retailers() {
  const { user } = useAuth();
  const [retailers, setRetailers] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [form, setForm] = useState({ name: '', address: '', contactNumber: '', gstNumber: '', primaryDealerId: '' });
  const [bankAccounts, setBankAccounts] = useState([{ accountNumber: '', ifsc: '', bankName: '' }]);

  async function load() {
    const { data } = await api.get('/retailers');
    setRetailers(data);
    if (user.role === 'ADMIN') {
      const d = await api.get('/dealers');
      setDealers(d.data);
    }
  }
  useEffect(() => { load(); }, []);

  function updateBank(i, key, val) {
    const copy = [...bankAccounts];
    copy[i][key] = val;
    setBankAccounts(copy);
  }

  async function submit(e) {
    e.preventDefault();
    await api.post('/retailers', { ...form, bankAccounts });
    setForm({ name: '', address: '', contactNumber: '', gstNumber: '', primaryDealerId: '' });
    setBankAccounts([{ accountNumber: '', ifsc: '', bankName: '' }]);
    load();
  }

  const canCreate = user.role === 'ADMIN' || user.role === 'DEALER';

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Retailers</h1>

      {canCreate && (
        <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input placeholder="Name" className="border rounded px-2 py-1" required
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Address" className="border rounded px-2 py-1" required
              value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <input placeholder="Contact Number" className="border rounded px-2 py-1" required
              value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} />
            <input placeholder="GST Number" className="border rounded px-2 py-1" required
              value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} />
            {user.role === 'ADMIN' && (
              <select className="border rounded px-2 py-1" required
                value={form.primaryDealerId} onChange={(e) => setForm({ ...form, primaryDealerId: e.target.value })}>
                <option value="">Primary Dealer...</option>
                {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>

          <div>
            <div className="text-sm font-medium mb-2">Bank accounts</div>
            {bankAccounts.map((b, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 mb-2">
                <input placeholder="Account Number" className="border rounded px-2 py-1"
                  value={b.accountNumber} onChange={(e) => updateBank(i, 'accountNumber', e.target.value)} />
                <input placeholder="IFSC Code" className="border rounded px-2 py-1"
                  value={b.ifsc} onChange={(e) => updateBank(i, 'ifsc', e.target.value)} />
                <input placeholder="Bank Name" className="border rounded px-2 py-1"
                  value={b.bankName} onChange={(e) => updateBank(i, 'bankName', e.target.value)} />
              </div>
            ))}
            <button type="button" className="text-emerald-700 text-sm"
              onClick={() => setBankAccounts([...bankAccounts, { accountNumber: '', ifsc: '', bankName: '' }])}>
              + Add another bank account
            </button>
          </div>

          <button className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">Create Retailer</button>
        </form>
      )}

      <div className="grid gap-4">
        {retailers.map((r) => (
          <div key={r.id} className="bg-white p-4 rounded shadow">
            <div className="font-semibold">{r.name} <span className="text-xs text-gray-400">#{r.id}</span></div>
            <div className="text-sm text-gray-500">{r.address}</div>
            <div className="text-sm text-gray-500">Ph: {r.contactNumber} · GST: {r.gstNumber}</div>
            <div className="mt-2 text-sm">
              <span className="font-medium">Bank accounts: </span>
              {r.bankAccounts?.map((b) => `${b.bankName} - ${b.accountNumber} (${b.ifsc})`).join(' | ') || 'None'}
            </div>
          </div>
        ))}
        {retailers.length === 0 && <p className="text-gray-400">No retailers yet.</p>}
      </div>
    </div>
  );
}
