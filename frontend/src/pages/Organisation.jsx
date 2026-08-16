import { useEffect, useState, Fragment } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

const empty = { org_name: '', org_address: '', org_contact: '', org_type: 'MAHAMANDAL', username: '', password: '' };

export default function Organisation() {
  const { user } = useAuth();
  const canWrite = user.role === 'ADMIN';

  const [orgs, setOrgs] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  // Credentials for an existing organisation are set/reset separately from
  // the create/edit form above — same pattern as Dealers/Retailers.
  const [credEdit, setCredEdit] = useState(null); // orgId currently setting/resetting a login
  const [credForm, setCredForm] = useState({ username: '', password: '' });
  const [credError, setCredError] = useState('');

  async function load() {
    const { data } = await api.get('/organisations');
    setOrgs(data);
  }
  useEffect(() => { load(); }, []);

  function startEdit(o) {
    setEditingId(o.orgId);
    setForm({ org_name: o.orgName, org_address: o.orgAddress, org_contact: o.orgContact, org_type: o.orgType, username: '', password: '' });
    setError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(empty);
    setError('');
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        // Editing existing org details only — login is managed via the
        // per-row Set login / Reset password action below, not here.
        await api.put(`/organisations/${editingId}`, {
          org_name: form.org_name, org_address: form.org_address, org_contact: form.org_contact, org_type: form.org_type
        });
      } else {
        await api.post('/organisations', form);
      }
      setForm(empty);
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || (editingId
        ? 'Could not update organisation / संस्था अद्ययावत करता आली नाही'
        : 'Could not create organisation'));
    }
  }

  async function submitCredentials(e, orgId) {
    e.preventDefault();
    setCredError('');
    try {
      await api.post(`/organisations/${orgId}/credentials`, credForm);
      setCredEdit(null);
      setCredForm({ username: '', password: '' });
      load();
    } catch (err) {
      setCredError(err.response?.data?.error || 'Failed to save login / लॉगिन जतन करण्यात अयशस्वी');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">
        Organisation (Mahamandal) <span className="text-base font-normal text-gray-500">(संस्था / महामंडळ)</span>
      </h1>

      {canWrite && (
        <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 space-y-4">
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

          {/* Login is only offered while creating a new organisation — for an
              existing one it's set/reset per-row further down, same as
              Dealers/Retailers. */}
          {!editingId && (
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
          )}

          <div className="flex items-center gap-3">
            <button className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
              {editingId ? 'Save Changes / बदल जतन करा' : 'Create Organisation / संस्था तयार करा'}
            </button>
            {editingId && (
              <button type="button" onClick={cancelEdit} className="text-gray-600 text-sm px-3 py-2 rounded hover:bg-gray-100">
                Cancel / रद्द करा
              </button>
            )}
            {error && <span className="text-red-600 text-sm">{error}</span>}
          </div>
        </form>
      )}

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2">ID / आयडी</th>
              <th className="text-left p-2">Name / नाव</th>
              <th className="text-left p-2">Address / पत्ता</th>
              <th className="text-left p-2">Contact / संपर्क</th>
              <th className="text-left p-2">Type / प्रकार</th>
              {canWrite && <th className="text-left p-2">Login / लॉगिन</th>}
              {canWrite && <th className="text-left p-2">Actions / क्रिया</th>}
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => {
              const login = o.users?.[0];
              return (
                <Fragment key={o.orgId}>
                  <tr key={o.orgId} className={`border-t ${editingId === o.orgId ? 'bg-emerald-50' : ''}`}>
                    <td className="p-2">{o.orgId}</td>
                    <td className="p-2">{o.orgName}</td>
                    <td className="p-2">{o.orgAddress}</td>
                    <td className="p-2">{o.orgContact}</td>
                    <td className="p-2">{o.orgType}</td>
                    {canWrite && (
                      <td className="p-2">
                        {login ? (
                          <span className="text-gray-700">{login.username}</span>
                        ) : (
                          <span className="text-amber-600">No login yet / अद्याप लॉगिन नाही</span>
                        )}
                      </td>
                    )}
                    {canWrite && (
                      <td className="p-2">
                        <div className="flex items-center gap-3">
                          <button type="button" onClick={() => startEdit(o)} className="text-emerald-700 text-sm hover:underline">
                            Edit / संपादित करा
                          </button>
                          <button type="button" className="text-emerald-700 text-sm hover:underline"
                            onClick={() => { setCredEdit(credEdit === o.orgId ? null : o.orgId); setCredForm({ username: login?.username || '', password: '' }); setCredError(''); }}>
                            {login ? 'Reset password / पासवर्ड रीसेट करा' : 'Set login / लॉगिन सेट करा'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                  {credEdit === o.orgId && (
                    <tr key={`${o.orgId}-cred`} className="border-t bg-gray-50">
                      <td className="p-3" colSpan={7}>
                        <form onSubmit={(e) => submitCredentials(e, o.orgId)} className="space-y-2">
                          {credError && <div className="text-sm text-red-600">{credError}</div>}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input placeholder="Username / वापरकर्तानाव" className="border rounded px-2 py-1" autoComplete="off"
                              value={credForm.username} onChange={(e) => setCredForm({ ...credForm, username: e.target.value })}
                              disabled={!!login} />
                            <input placeholder="New password / नवीन पासवर्ड" type="password" className="border rounded px-2 py-1" required autoComplete="new-password"
                              value={credForm.password} onChange={(e) => setCredForm({ ...credForm, password: e.target.value })} />
                          </div>
                          <div className="flex gap-2">
                            <button className="bg-emerald-700 text-white px-3 py-1 rounded text-sm hover:bg-emerald-800">Save / जतन करा</button>
                            <button type="button" className="text-gray-500 text-sm" onClick={() => setCredEdit(null)}>Cancel / रद्द करा</button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {orgs.length === 0 && (
              <tr><td className="p-3 text-gray-400" colSpan={canWrite ? 7 : 5}>No organisations yet. / अद्याप संस्था नाहीत.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
