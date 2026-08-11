import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Retailers() {
  const { user } = useAuth();
  const [retailers, setRetailers] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [form, setForm] = useState({ name: '', address: '', contactNumber: '', gstNumber: '', primaryDealerId: '', username: '', password: '' });
  const [bankAccounts, setBankAccounts] = useState([{ accountNumber: '', ifsc: '', bankName: '' }]);
  const [error, setError] = useState('');
  const [credEdit, setCredEdit] = useState(null); // retailer id currently setting/resetting a login
  const [credForm, setCredForm] = useState({ username: '', password: '' });
  const [credError, setCredError] = useState('');

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
    setError('');
    try {
      await api.post('/retailers', { ...form, bankAccounts });
      setForm({ name: '', address: '', contactNumber: '', gstNumber: '', primaryDealerId: '', username: '', password: '' });
      setBankAccounts([{ accountNumber: '', ifsc: '', bankName: '' }]);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create retailer');
    }
  }

  async function submitCredentials(e, retailerId) {
    e.preventDefault();
    setCredError('');
    try {
      await api.post(`/retailers/${retailerId}/credentials`, credForm);
      setCredEdit(null);
      setCredForm({ username: '', password: '' });
      load();
    } catch (err) {
      setCredError(err.response?.data?.error || 'Failed to save login');
    }
  }

  const canCreate = user.role === 'ADMIN' || user.role === 'DEALER';

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Retailers</h1>

      {canCreate && (
        <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

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
            <div className="text-sm font-medium mb-2">Login (optional — lets this retailer sign in and see their own data)</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input placeholder="Username" className="border rounded px-2 py-1" autoComplete="off"
                value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <input placeholder="Password" type="password" className="border rounded px-2 py-1" autoComplete="new-password"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
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
        {retailers.map((r) => {
          const login = r.users?.[0];
          return (
            <div key={r.id} className="bg-white p-4 rounded shadow">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold">{r.name} <span className="text-xs text-gray-400">#{r.id}</span></div>
                  <div className="text-sm text-gray-500">{r.address}</div>
                  <div className="text-sm text-gray-500">Ph: {r.contactNumber} · GST: {r.gstNumber}</div>
                </div>
                {canCreate && (
                  <div className="text-right">
                    {login ? (
                      <div className="text-sm text-gray-500">Login: <span className="font-medium text-gray-700">{login.username}</span></div>
                    ) : (
                      <div className="text-sm text-amber-600">No login yet</div>
                    )}
                    <button type="button" className="text-emerald-700 text-xs mt-1"
                      onClick={() => { setCredEdit(credEdit === r.id ? null : r.id); setCredForm({ username: login?.username || '', password: '' }); setCredError(''); }}>
                      {login ? 'Reset password' : 'Set login'}
                    </button>
                  </div>
                )}
              </div>

              {credEdit === r.id && (
                <form onSubmit={(e) => submitCredentials(e, r.id)} className="mt-3 bg-gray-50 border rounded p-3 space-y-2">
                  {credError && <div className="text-sm text-red-600">{credError}</div>}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input placeholder="Username" className="border rounded px-2 py-1" autoComplete="off"
                      value={credForm.username} onChange={(e) => setCredForm({ ...credForm, username: e.target.value })}
                      disabled={!!login} />
                    <input placeholder="New password" type="password" className="border rounded px-2 py-1" required autoComplete="new-password"
                      value={credForm.password} onChange={(e) => setCredForm({ ...credForm, password: e.target.value })} />
                  </div>
                  <div className="flex gap-2">
                    <button className="bg-emerald-700 text-white px-3 py-1 rounded text-sm hover:bg-emerald-800">Save</button>
                    <button type="button" className="text-gray-500 text-sm" onClick={() => setCredEdit(null)}>Cancel</button>
                  </div>
                </form>
              )}

              <div className="mt-2 text-sm">
                <span className="font-medium">Bank accounts: </span>
                {r.bankAccounts?.map((b) => `${b.bankName} - ${b.accountNumber} (${b.ifsc})`).join(' | ') || 'None'}
              </div>
            </div>
          );
        })}
        {retailers.length === 0 && <p className="text-gray-400">No retailers yet.</p>}
      </div>
    </div>
  );
}
