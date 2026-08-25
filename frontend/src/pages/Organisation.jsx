import { useState } from 'react';
import api from '../api.js';
import CrudTable from '../components/CrudTable.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Organisation() {
  const { user } = useAuth();
  const canWrite = user.role === 'ADMIN';

  // Creating a new organisation (with optional login) stays a separate
  // form, same reasoning as Dealers.jsx: its field set (org_type, login)
  // doesn't match what PUT /organisations/:id accepts, so folding it into
  // CrudTable's generic add-form would expose fields that silently
  // wouldn't save on edit.
  const [form, setForm] = useState({ org_name: '', org_address: '', org_contact: '', org_type: 'MAHAMANDAL', username: '', password: '' });
  const [error, setError] = useState('');

  // Credentials for an existing organisation are set/reset separately from
  // the create/edit form — same pattern as Dealers/Retailers.
  const [credEdit, setCredEdit] = useState(null); // orgId currently setting/resetting a login
  const [credHasLogin, setCredHasLogin] = useState(false);
  const [credForm, setCredForm] = useState({ username: '', password: '' });
  const [credError, setCredError] = useState('');

  // Bumped after the create form or the credentials form succeeds, so
  // CrudTable reloads its own rows — both happen outside CrudTable's own
  // create/edit flow.
  const [refreshSignal, setRefreshSignal] = useState(0);

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/organisations', form);
      setForm({ org_name: '', org_address: '', org_contact: '', org_type: 'MAHAMANDAL', username: '', password: '' });
      setRefreshSignal((n) => n + 1);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create organisation / संस्था तयार करता आली नाही');
    }
  }

  function openCredForm(org) {
    const login = org.users?.[0];
    setCredEdit(credEdit === org.orgId ? null : org.orgId);
    setCredHasLogin(!!login);
    setCredForm({ username: login?.username || '', password: '' });
    setCredError('');
  }

  async function submitCredentials(e) {
    e.preventDefault();
    setCredError('');
    try {
      await api.post(`/organisations/${credEdit}/credentials`, credForm);
      setCredEdit(null);
      setCredForm({ username: '', password: '' });
      setRefreshSignal((n) => n + 1);
    } catch (err) {
      setCredError(err.response?.data?.error || 'Failed to save login / लॉगिन जतन करण्यात अयशस्वी');
    }
  }

  return (
    <div>
      {canWrite && (
        <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 space-y-4">
          <div className="text-sm font-medium">
            Create Organisation
            <span className="block text-xs font-normal text-orange-700">संस्था तयार करा</span>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input placeholder="Organisation Name / संस्थेचे नाव" className="border rounded px-2 py-1" required
              value={form.org_name} onChange={(e) => setForm({ ...form, org_name: e.target.value })} />
            <input placeholder="Address / पत्ता" className="border rounded px-2 py-1" required
              value={form.org_address} onChange={(e) => setForm({ ...form, org_address: e.target.value })} />
            <input placeholder="Contact Number / संपर्क क्रमांक" className="border rounded px-2 py-1" required
              value={form.org_contact} onChange={(e) => setForm({ ...form, org_contact: e.target.value })} />
            <select className="border rounded px-2 py-1"
              value={form.org_type} onChange={(e) => setForm({ ...form, org_type: e.target.value })}>
              <option value="MAHAMANDAL">MAHAMANDAL / महामंडळ</option>
              <option value="FEDERATION">FEDERATION / फेडरेशन</option>
              <option value="ASSOCIATION">ASSOCIATION / संघटना</option>
            </select>
          </div>

          <div>
            <div className="text-sm font-medium mb-2">
              Login (optional — lets this organisation sign in and see its own data)
              <span className="block text-xs font-normal text-orange-700">
                लॉगिन (ऐच्छिक — यामुळे ही संस्था स्वतः साइन इन करून स्वतःचा डेटा पाहू शकते)
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input placeholder="Username / वापरकर्तानाव" className="border rounded px-2 py-1" autoComplete="off"
                value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <input placeholder="Password / पासवर्ड" type="password" className="border rounded px-2 py-1" autoComplete="new-password"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>

          <button className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
            Create Organisation / संस्था तयार करा
          </button>
        </form>
      )}

      <CrudTable
        title={
          <span>
            Organisation (Mahamandal)
            <span className="block text-xs font-normal text-orange-700">संस्था / महामंडळ</span>
          </span>
        }
        endpoint="/organisations"
        refreshSignal={refreshSignal}
        editable
        // Organisations are only ever created through the form above
        // (ADMIN only, POST /organisations) — CrudTable's own add-form
        // would duplicate it and expose the login fields, which
        // PUT /organisations/:id doesn't accept.
        canCreate={false}
        canWrite={canWrite}
        // Field keys match the row's own property names (orgName,
        // orgAddress, ...) so CrudTable's startEdit can populate the form
        // correctly from an existing row. transformSubmit below converts
        // them to the snake_case body PUT /organisations/:id expects.
        fields={[
          { key: 'orgName', label: 'Organisation Name / संस्थेचे नाव', required: true },
          { key: 'orgAddress', label: 'Address / पत्ता', required: true },
          { key: 'orgContact', label: 'Contact Number / संपर्क क्रमांक', required: true },
          {
            key: 'orgType',
            label: 'Type / प्रकार',
            type: 'select',
            options: [
              { value: 'MAHAMANDAL', label: 'MAHAMANDAL / महामंडळ' },
              { value: 'FEDERATION', label: 'FEDERATION / फेडरेशन' },
              { value: 'ASSOCIATION', label: 'ASSOCIATION / संघटना' },
            ],
          },
        ]}
        transformSubmit={(f) => ({
          org_name: f.orgName,
          org_address: f.orgAddress,
          org_contact: f.orgContact,
          org_type: f.orgType,
        })}
        columns={[
          { key: 'orgId', label: 'ID / आयडी' },
          { key: 'orgName', label: 'Name / नाव' },
          { key: 'orgAddress', label: 'Address / पत्ता' },
          { key: 'orgContact', label: 'Contact / संपर्क' },
          { key: 'orgType', label: 'Type / प्रकार' },
          // Hidden entirely for non-ADMIN viewers, same as the original
          // hand-rolled table (not just the Set/Reset button).
          ...(canWrite ? [{
            key: 'login',
            label: 'Login / लॉगिन',
            render: (r) => {
              const login = r.users?.[0];
              return (
                <div>
                  {login
                    ? <span className="text-gray-700">{login.username}</span>
                    : <span className="text-amber-600">No login yet / अद्याप लॉगिन नाही</span>}
                  <button
                    type="button"
                    className="block text-emerald-700 text-xs mt-1 hover:underline"
                    onClick={() => openCredForm(r)}
                  >
                    {login ? 'Reset password / पासवर्ड रीसेट करा' : 'Set login / लॉगिन सेट करा'}
                  </button>
                </div>
              );
            },
          }] : []),
        ]}
      />

      {credEdit && (
        <form onSubmit={submitCredentials} className="mt-4 bg-white border rounded shadow p-4 max-w-md space-y-3">
          <div className="text-sm font-medium">
            Organisation login
            <span className="block text-xs font-normal text-orange-700">संस्था लॉगिन</span>
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
