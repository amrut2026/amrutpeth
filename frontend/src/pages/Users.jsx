import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

// ADMIN-only screen for provisioning READONLY oversight logins — the one
// role with no owning entity (Dealer/Retailer/Organisation) to hang a "Set
// login" button off of, so it gets its own small page instead of folding
// into CrudTable. Deliberately not built on CrudTable: there's no editable
// field set beyond username (password changes go through the separate
// reset-password mini-form, same pattern as Dealers/Retailers/Organisation),
// and no isActive column on User to drive an activatable toggle — removal
// here is a hard delete (see users.js for why that's safe for this role).
export default function Users() {
  const { user } = useAuth();
  const canWrite = user.role === 'ADMIN';

  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [resetId, setResetId] = useState(null); // user id currently resetting a password
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/users');
      setUsers(data);
    } catch (err) {
      // Previously swallowed silently — a 404 (route not mounted) or 403
      // (role check) left the table looking merely "empty" with no signal
      // that the request had actually failed.
      setError(err.response?.data?.error || `Failed to load users (${err.response?.status || 'network error'})`);
    }
  }

  useEffect(() => {
    if (canWrite) load();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/users', form);
      setUsers((prev) => [data, ...prev]);
      setForm({ username: '', password: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user / वापरकर्ता तयार करण्यात अयशस्वी');
    } finally {
      setLoading(false);
    }
  }

  function openReset(u) {
    setResetId(resetId === u.id ? null : u.id);
    setResetPassword('');
    setResetError('');
  }

  async function submitReset(e) {
    e.preventDefault();
    setResetError('');
    try {
      await api.post(`/users/${resetId}/reset-password`, { password: resetPassword });
      setResetId(null);
      setResetPassword('');
    } catch (err) {
      setResetError(err.response?.data?.error || 'Failed to reset password / पासवर्ड रीसेट करण्यात अयशस्वी');
    }
  }

  async function remove(u) {
    if (!window.confirm(`Delete login "${u.username}"? This can't be undone. / लॉगिन "${u.username}" काढायचे? हे पूर्ववत करता येणार नाही.`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete user / वापरकर्ता काढण्यात अयशस्वी');
    }
  }

  if (!canWrite) {
    return <p className="text-gray-500">Not authorized. / अधिकृत नाही.</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">
        Read-Only Users
        <span className="block text-base font-normal text-gray-500">फक्त पहा वापरकर्ते</span>
      </h1>

      <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 space-y-4">
        <div className="text-sm font-medium">
          Create Read-Only Login
          <span className="block text-xs font-normal text-orange-700">फक्त पहा लॉगिन तयार करा</span>
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input placeholder="Username / वापरकर्तानाव" className="border rounded px-2 py-1" required autoComplete="off"
            value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input placeholder="Password / पासवर्ड" type="password" className="border rounded px-2 py-1" required autoComplete="new-password"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <button disabled={loading} className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
          {loading ? 'Saving... / जतन करत आहे...' : 'Create / तयार करा'}
        </button>
      </form>

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2">ID / आयडी</th>
              <th className="text-left p-2">Username / वापरकर्तानाव</th>
              <th className="text-left p-2">Actions / क्रिया</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-2">{u.id}</td>
                <td className="p-2">{u.username}</td>
                <td className="p-2">
                  <div className="flex items-center gap-3">
                    <button type="button" className="text-emerald-700 text-sm hover:underline" onClick={() => openReset(u)}>
                      Reset password / पासवर्ड रीसेट करा
                    </button>
                    <button type="button" className="text-red-600 text-sm hover:underline" onClick={() => remove(u)}>
                      Delete / काढा
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td className="p-3 text-gray-400" colSpan={3}>No read-only logins yet. / अद्याप फक्त-पहा लॉगिन नाहीत.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {resetId && (
        <form onSubmit={submitReset} className="mt-4 bg-white border rounded shadow p-4 max-w-md space-y-3">
          <div className="text-sm font-medium">
            Reset password
            <span className="block text-xs font-normal text-orange-700">पासवर्ड रीसेट करा</span>
          </div>
          {resetError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{resetError}</div>}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">New Password / नवीन पासवर्ड</label>
            <input
              placeholder="Password"
              type="password"
              className="border rounded px-2 py-1"
              required
              autoComplete="new-password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button className="bg-emerald-700 text-white px-3 py-1 rounded text-sm hover:bg-emerald-800">
              Save / जतन करा
            </button>
            <button type="button" className="text-gray-500 text-sm" onClick={() => setResetId(null)}>
              Cancel / रद्द करा
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
