import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Dealers() {
  const { user } = useAuth();
  const [dealers, setDealers] = useState([]);
  const [form, setForm] = useState({ name: '', address: '', contactNumber: '', gstNumber: '' });
  const [bankAccounts, setBankAccounts] = useState([{ accountNumber: '', ifsc: '', bankName: '' }]);

  async function load() {
    const { data } = await api.get('/dealers');
    setDealers(data);
  }
  useEffect(() => { load(); }, []);

  function updateBank(i, key, val) {
    const copy = [...bankAccounts];
    copy[i][key] = val;
    setBankAccounts(copy);
  }

  async function submit(e) {
    e.preventDefault();
    await api.post('/dealers', { ...form, bankAccounts });
    setForm({ name: '', address: '', contactNumber: '', gstNumber: '' });
    setBankAccounts([{ accountNumber: '', ifsc: '', bankName: '' }]);
    load();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Dealers</h1>

      {user.role === 'ADMIN' && (
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

          <button className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">Create Dealer</button>
        </form>
      )}

      <div className="grid gap-4">
        {dealers.map((d) => (
          <div key={d.id} className="bg-white p-4 rounded shadow">
            <div className="flex justify-between">
              <div>
                <div className="font-semibold">{d.name} <span className="text-xs text-gray-400">#{d.id}</span></div>
                <div className="text-sm text-gray-500">{d.address}</div>
                <div className="text-sm text-gray-500">Ph: {d.contactNumber} · GST: {d.gstNumber}</div>
              </div>
            </div>
            <div className="mt-2 text-sm">
              <span className="font-medium">Bank accounts: </span>
              {d.bankAccounts?.map((b) => `${b.bankName} - ${b.accountNumber} (${b.ifsc})`).join(' | ') || 'None'}
            </div>
          </div>
        ))}
        {dealers.length === 0 && <p className="text-gray-400">No dealers yet.</p>}
      </div>
    </div>
  );
}
