import { useEffect, useState } from 'react';
import api from '../api.js';
import CrudTable from '../components/CrudTable.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Dealers() {
  const { user } = useAuth();
  const [divisions, setDivisions] = useState([]);
  // organisationId is no longer picked here - the backend always creates
  // the dealer under the logged-in ORGANISATION user's own org.
  const [form, setForm] = useState({ name: '', address: '', contactNumber: '', gstNumber: '', divisionId: '', username: '', password: '' });
  const [bankAccounts, setBankAccounts] = useState([{ accountNumber: '', ifsc: '', bankName: '' }]);
  const [error, setError] = useState('');

  // Login credentials aren't part of CrudTable's generic edit form (PUT
  // /dealers/:id doesn't accept them) — set/reset happens through this
  // separate mini-form instead, same pattern as Retailers.jsx.
  const [credEdit, setCredEdit] = useState(null); // dealer id currently setting/resetting a login
  const [credHasLogin, setCredHasLogin] = useState(false);
  const [credForm, setCredForm] = useState({ username: '', password: '' });
  const [credError, setCredError] = useState('');

  // Bumped after the create form or the credentials form succeeds, so
  // CrudTable reloads its own rows — both changes happen outside
  // CrudTable's own create/edit flow.
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    if (user.role === 'ORGANISATION') {
      api.get('/divisions').then((res) => setDivisions(res.data));
    }
  }, []);

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
      setRefreshSignal((n) => n + 1);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create dealer / डीलर तयार करण्यात अयशस्वी');
    }
  }

  function openCredForm(dealer) {
    const login = dealer.users?.[0];
    setCredEdit(credEdit === dealer.id ? null : dealer.id);
    setCredHasLogin(!!login);
    setCredForm({ username: login?.username || '', password: '' });
    setCredError('');
  }

  async function submitCredentials(e) {
    e.preventDefault();
    setCredError('');
    try {
      await api.post(`/dealers/${credEdit}/credentials`, credForm);
      setCredEdit(null);
      setCredForm({ username: '', password: '' });
      setRefreshSignal((n) => n + 1);
    } catch (err) {
      setCredError(err.response?.data?.error || 'Failed to save login / लॉगिन जतन करण्यात अयशस्वी');
    }
  }

  return (
    <div>
      {user.role === 'ORGANISATION' && (
        <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 space-y-4">
          <div className="text-sm font-medium">
            Create Dealer
            <span className="block text-xs font-normal text-orange-700">डीलर तयार करा</span>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input placeholder="Name / नाव" className="border rounded px-2 py-1" required
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Address / पत्ता" className="border rounded px-2 py-1" required
              value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <input placeholder="Contact Number / संपर्क क्रमांक" className="border rounded px-2 py-1" required
              value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} />
            <input placeholder="GST Number (optional) / GST क्रमांक (ऐच्छिक)" className="border rounded px-2 py-1"
              value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} />
            <select className="border rounded px-2 py-1" required
              value={form.divisionId} onChange={(e) => setForm({ ...form, divisionId: e.target.value })}>
              <option value="">Division... / विभाग...</option>
              {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {divisions.length === 0 && (
            <p className="text-xs text-amber-600 -mt-2">No divisions yet — add one under Divisions first. / अद्याप विभाग नाहीत — आधी विभाग विभागात एक जोडा.</p>
          )}

          <div>
            <div className="text-sm font-medium mb-2">
              Login (optional — lets this dealer sign in and see their own data)
              <span className="block text-xs font-normal text-orange-700">लॉगिन (ऐच्छिक — यामुळे डीलर स्वतः साइन इन करून स्वतःचा डेटा पाहू शकतो)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input placeholder="Username / वापरकर्तानाव" className="border rounded px-2 py-1" autoComplete="off"
                value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <input placeholder="Password / पासवर्ड" type="password" className="border rounded px-2 py-1" autoComplete="new-password"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-2">Bank accounts / बँक खाती</div>
            {bankAccounts.map((b, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 mb-2">
                <input placeholder="Account Number / खाते क्रमांक" className="border rounded px-2 py-1"
                  value={b.accountNumber} onChange={(e) => updateBank(i, 'accountNumber', e.target.value)} />
                <input placeholder="IFSC Code / आयएफएससी कोड" className="border rounded px-2 py-1"
                  value={b.ifsc} onChange={(e) => updateBank(i, 'ifsc', e.target.value)} />
                <input placeholder="Bank Name / बँकेचे नाव" className="border rounded px-2 py-1"
                  value={b.bankName} onChange={(e) => updateBank(i, 'bankName', e.target.value)} />
              </div>
            ))}
            <button type="button" className="text-emerald-700 text-sm"
              onClick={() => setBankAccounts([...bankAccounts, { accountNumber: '', ifsc: '', bankName: '' }])}>
              + Add another bank account / आणखी एक बँक खाते जोडा
            </button>
          </div>

          <button className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
            Create Dealer / डीलर तयार करा
          </button>
        </form>
      )}

      <CrudTable
        title={
          <span>
            Dealers
            <span className="block text-xs font-normal text-orange-700">डीलर्स</span>
          </span>
        }
        endpoint="/dealers"
        refreshSignal={refreshSignal}
        editable
        // Dealers are only ever created through the form above (ORGANISATION
        // only, POST /dealers) — CrudTable's own add-form would duplicate it
        // and expose fields (division, bank accounts, login) that PUT
        // /dealers/:id doesn't accept, so it's turned off here regardless
        // of role.
        canCreate={false}
        // Editing is ORGANISATION-only, for any dealer under its own org
        // (see dealers.js PUT /:id). DEALER can no longer edit its own
        // record from here.
        canWrite={user.role === 'ORGANISATION'}
        fields={[
          { key: 'name', label: 'Name / नाव', required: true },
          { key: 'address', label: 'Address / पत्ता', required: true },
          { key: 'contactNumber', label: 'Contact Number / संपर्क क्रमांक', required: true },
          { key: 'gstNumber', label: 'GST Number (optional) / GST क्रमांक (ऐच्छिक)' },
        ]}
        columns={[
          { key: 'id', label: 'ID / आयडी' },
          { key: 'name', label: 'Name / नाव' },
          { key: 'address', label: 'Address / पत्ता' },
          { key: 'contactNumber', label: 'Contact / संपर्क' },
          { key: 'gstNumber', label: 'GST' },
          { key: 'divisionName', label: 'Division / विभाग', render: (r) => r.division?.name || '—' },
          { key: 'organisationName', label: 'Organisation / संस्था', render: (r) => r.organisation?.orgName || '—' },
          {
            key: 'bankAccounts',
            label: 'Bank Accounts / बँक खाती',
            render: (r) => r.bankAccounts?.map((b) => `${b.bankName} - ${b.accountNumber} (${b.ifsc})`).join(' | ') || 'None',
          },
          {
            key: 'login',
            label: 'Login / लॉगिन',
            render: (r) => {
              const login = r.users?.[0];
              return (
                <div>
                  {login
                    ? <span className="font-medium text-gray-700">{login.username}</span>
                    : <span className="text-amber-600 text-xs">No login yet / अद्याप लॉगिन नाही</span>}
                  {user.role === 'ORGANISATION' && (
                    <button
                      type="button"
                      className="block text-emerald-700 text-xs mt-1 hover:underline"
                      onClick={() => openCredForm(r)}
                    >
                      {login ? 'Reset password / पासवर्ड रीसेट करा' : 'Set login / लॉगिन सेट करा'}
                    </button>
                  )}
                </div>
              );
            },
          },
        ]}
      />

      {credEdit && (
        <form onSubmit={submitCredentials} className="mt-4 bg-white border rounded shadow p-4 max-w-md space-y-3">
          <div className="text-sm font-medium">
            Dealer login
            <span className="block text-xs font-normal text-orange-700">डीलर लॉगिन</span>
          </div>
          {credError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{credError}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Username / वापरकर्तानाव</label>
              <input
                placeholder="Username"
                className="border rounded px-2 py-1"
                autoComplete="off"
                value={credForm.username}
                onChange={(e) => setCredForm({ ...credForm, username: e.target.value })}
                disabled={credHasLogin}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">
                {credHasLogin ? 'New Password / नवीन पासवर्ड' : 'Password / पासवर्ड'}
              </label>
              <input
                placeholder="Password"
                type="password"
                className="border rounded px-2 py-1"
                required
                autoComplete="new-password"
                value={credForm.password}
                onChange={(e) => setCredForm({ ...credForm, password: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="bg-emerald-700 text-white px-3 py-1 rounded text-sm hover:bg-emerald-800">
              Save / जतन करा
            </button>
            <button type="button" className="text-gray-500 text-sm" onClick={() => setCredEdit(null)}>
              Cancel / रद्द करा
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
