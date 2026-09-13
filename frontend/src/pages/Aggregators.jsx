import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

// ADMIN-only screen for provisioning AGGREGATOR logins — a third-party
// integration (e.g. an aggregator storefront) acting on behalf of one
// specific dealer's retailers (see schema.prisma Role.AGGREGATOR). Same
// reasoning as Users.jsx (READONLY) for not building this on CrudTable —
// but unlike READONLY, an aggregator must be tied to a dealer, so the
// create form also needs a dealer picker and the table shows which dealer
// each login belongs to.
export default function Aggregators() {
  const { user } = useAuth();
  const canWrite = user.role === 'ADMIN';

  const [aggregators, setAggregators] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [form, setForm] = useState({ username: '', password: '', dealerId: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [resetId, setResetId] = useState(null); // aggregator id currently resetting a password
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');

  async function load() {
    try {
      const [{ data: aggData }, { data: dealerData }] = await Promise.all([
        api.get('/aggregators'),
        api.get('/dealers'),
      ]);
      setAggregators(aggData);
      setDealers(dealerData);
    } catch (err) {
      setError(err.response?.data?.error || `Failed to load aggregators (${err.response?.status || 'network error'})`);
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
      const { data } = await api.post('/aggregators', form);
      setAggregators((prev) => [data, ...prev]);
      setForm({ username: '', password: '', dealerId: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create aggregator / एग्रीगेटर तयार करण्यात अयशस्वी');
    } finally {
      setLoading(false);
    }
  }

  function openReset(a) {
    setResetId(resetId === a.id ? null : a.id);
    setResetPassword('');
    setResetError('');
  }

  async function submitReset(e) {
    e.preventDefault();
    setResetError('');
    try {
      await api.post(`/aggregators/${resetId}/reset-password`, { password: resetPassword });
      setResetId(null);
      setResetPassword('');
    } catch (err) {
      setResetError(err.response?.data?.error || 'Failed to reset password / पासवर्ड रीसेट करण्यात अयशस्वी');
    }
  }

  async function remove(a) {
    if (!window.confirm(`Delete aggregator login "${a.username}"? This can't be undone. / एग्रीगेटर लॉगिन "${a.username}" काढायचे? हे पूर्ववत करता येणार नाही.`)) return;
    try {
      await api.delete(`/aggregators/${a.id}`);
      setAggregators((prev) => prev.filter((x) => x.id !== a.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete aggregator / एग्रीगेटर काढण्यात अयशस्वी');
    }
  }

  if (!canWrite) {
    return <p className="text-gray-500">Not authorized. / अधिकृत नाही.</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">
        Aggregators
        <span className="block text-base font-normal text-gray-500">एग्रीगेटर्स</span>
      </h1>

      <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 space-y-4">
        <div className="text-sm font-medium">
          Create Aggregator Login
          <span className="block text-xs font-normal text-orange-700">एग्रीगेटर लॉगिन तयार करा</span>
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input placeholder="Username / वापरकर्तानाव" className="border rounded px-2 py-1" required autoComplete="off"
            value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input placeholder="Password / पासवर्ड" type="password" className="border rounded px-2 py-1" required autoComplete="new-password"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="border rounded px-2 py-1" required
            value={form.dealerId} onChange={(e) => setForm({ ...form, dealerId: e.target.value })}>
            <option value="">Select Dealer / वितरक निवडा</option>
            {dealers.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
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
              <th className="text-left p-2">Dealer / वितरक</th>
              <th className="text-left p-2">Actions / क्रिया</th>
            </tr>
          </thead>
          <tbody>
            {aggregators.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-2">{a.id}</td>
                <td className="p-2">{a.username}</td>
                <td className="p-2">{a.dealer?.name || '—'}</td>
                <td className="p-2">
                  <div className="flex items-center gap-3">
                    <button type="button" className="text-emerald-700 text-sm hover:underline" onClick={() => openReset(a)}>
                      Reset password / पासवर्ड रीसेट करा
                    </button>
                    <button type="button" className="text-red-600 text-sm hover:underline" onClick={() => remove(a)}>
                      Delete / काढा
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {aggregators.length === 0 && (
              <tr><td className="p-3 text-gray-400" colSpan={4}>No aggregator logins yet. / अद्याप एग्रीगेटर लॉगिन नाहीत.</td></tr>
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
