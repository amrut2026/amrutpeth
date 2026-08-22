import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Dealers() {
  const { user } = useAuth();
  const [dealers, setDealers] = useState([]);
  const [divisions, setDivisions] = useState([]);
  // organisationId is no longer picked here - the backend always creates
  // the dealer under the logged-in ORGANISATION user's own org.
  const [form, setForm] = useState({ name: '', address: '', contactNumber: '', gstNumber: '', divisionId: '', username: '', password: '' });
  const [bankAccounts, setBankAccounts] = useState([{ accountNumber: '', ifsc: '', bankName: '' }]);
  const [error, setError] = useState('');
  const [credEdit, setCredEdit] = useState(null); // dealer id currently setting/resetting a login
  const [credForm, setCredForm] = useState({ username: '', password: '' });
  const [credError, setCredError] = useState('');

  async function load() {
    const calls = [api.get('/dealers')];
    if (user.role === 'ORGANISATION') calls.push(api.get('/divisions'));
    const results = await Promise.all(calls);
    setDealers(results[0].data);
    if (user.role === 'ORGANISATION') setDivisions(results[1].data);
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
      await api.post('/dealers', { ...form, bankAccounts });
      setForm({ name: '', address: '', contactNumber: '', gstNumber: '', divisionId: '', username: '', password: '' });
      setBankAccounts([{ accountNumber: '', ifsc: '', bankName: '' }]);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create dealer');
    }
  }

  async function submitCredentials(e, dealerId) {
    e.preventDefault();
    setCredError('');
    try {
      await api.post(`/dealers/${dealerId}/credentials`, credForm);
      setCredEdit(null);
      setCredForm({ username: '', password: '' });
      load();
    } catch (err) {
      setCredError(err.response?.data?.error || 'Failed to save login');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Dealers</h1>

      {user.role === 'ORGANISATION' && (
        <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input placeholder="Name" className="border rounded px-2 py-1" required
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Address" className="border rounded px-2 py-1" required
              value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <input placeholder="Contact Number" className="border rounded px-2 py-1" required
              value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} />
            <input placeholder="GST Number (optional)" className="border rounded px-2 py-1"
              value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} />
            <select className="border rounded px-2 py-1" required
              value={form.divisionId} onChange={(e) => setForm({ ...form, divisionId: e.target.value })}>
              <option value="">Division...</option>
              {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {divisions.length === 0 && (
            <p className="text-xs text-amber-600 -mt-2">No divisions yet — add one under Divisions first.</p>
          )}

          <div>
            <div className="text-sm font-medium mb-2">Login (optional — lets this dealer sign in and see their own data)</div>
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

          <button className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">Create Dealer</button>
        </form>
      )}

      <div className="grid gap-4">
        {dealers.map((d) => {
          const login = d.users?.[0];
          return (
            <div key={d.id} className="bg-white p-4 rounded shadow">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold">{d.name} <span className="text-xs text-gray-400">#{d.id}</span></div>
                  <div className="text-sm text-gray-500">{d.address}</div>
                  <div className="text-sm text-gray-500">Ph: {d.contactNumber} · GST: {d.gstNumber || '—'}</div>
                  <div className="text-sm text-gray-500">Division: {d.division?.name || '—'}</div>
                  <div className="text-sm text-gray-500">Organisation: {d.organisation?.orgName || '—'}</div>
                </div>
                {user.role === 'ORGANISATION' && (
                  <div className="text-right">
                    {login ? (
                      <div className="text-sm text-gray-500">Login: <span className="font-medium text-gray-700">{login.username}</span></div>
                    ) : (
                      <div className="text-sm text-amber-600">No login yet</div>
                    )}
                    <button type="button" className="text-emerald-700 text-xs mt-1"
                      onClick={() => { setCredEdit(credEdit === d.id ? null : d.id); setCredForm({ username: login?.username || '', password: '' }); setCredError(''); }}>
                      {login ? 'Reset password' : 'Set login'}
                    </button>
                  </div>
                )}
              </div>

              {credEdit === d.id && (
                <form onSubmit={(e) => submitCredentials(e, d.id)} className="mt-3 bg-gray-50 border rounded p-3 space-y-2">
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
                {d.bankAccounts?.map((b) => `${b.bankName} - ${b.accountNumber} (${b.ifsc})`).join(' | ') || 'None'}
              </div>
            </div>
          );
        })}
        {dealers.length === 0 && <p className="text-gray-400">No dealers yet.</p>}
      </div>
    </div>
  );
}
