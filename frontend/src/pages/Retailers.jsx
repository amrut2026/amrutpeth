import { useState } from 'react';
import api from '../api.js';
import CrudTable from '../components/CrudTable.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Retailers() {
  const { user } = useAuth();
  const canWrite = user.role === 'DEALER';

  // Login credentials aren't part of the generic CrudTable form — a
  // retailer's login is created/reset through this separate mini-form,
  // opened from the Login column below, same as before. refreshSignal
  // tells CrudTable to reload its rows after a credentials change, since
  // that update happens outside CrudTable's own create/edit flow.
  const [credEdit, setCredEdit] = useState(null); // retailer id currently setting/resetting a login
  const [credHasLogin, setCredHasLogin] = useState(false);
  const [credForm, setCredForm] = useState({ username: '', password: '' });
  const [credError, setCredError] = useState('');
  const [refreshSignal, setRefreshSignal] = useState(0);

  function openCredForm(retailer) {
    const login = retailer.users?.[0];
    setCredEdit(credEdit === retailer.id ? null : retailer.id);
    setCredHasLogin(!!login);
    setCredForm({ username: login?.username || '', password: '' });
    setCredError('');
  }

  async function submitCredentials(e) {
    e.preventDefault();
    setCredError('');
    try {
      await api.post(`/retailers/${credEdit}/credentials`, credForm);
      setCredEdit(null);
      setCredForm({ username: '', password: '' });
      setRefreshSignal((n) => n + 1);
    } catch (err) {
      setCredError(err.response?.data?.error || 'Failed to save login / लॉगिन जतन करण्यात अयशस्वी');
    }
  }

  return (
    <div>
      <CrudTable
        title={
          <span>
            Retailers
            <span className="block text-xs font-normal text-orange-700">किरकोळ विक्रेते</span>
          </span>
        }
        endpoint="/retailers"
        canWrite={canWrite}
        editable
        refreshSignal={refreshSignal}
        // No dealerId field here, same as Suppliers — the backend always
        // assigns a new retailer to the logged-in dealer.
        fields={[
          { key: 'name', label: 'Name', required: true },
          { key: 'address', label: 'Address', required: true },
          { key: 'contactNumber', label: 'Contact Number', required: true },
          { key: 'gstNumber', label: 'GST Number (optional)' },
          { key: 'bankAccounts', label: 'Bank accounts', type: 'bankAccounts' },
        ]}
        columns={[
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Name' },
          { key: 'address', label: 'Address' },
          { key: 'contactNumber', label: 'Contact' },
          { key: 'gstNumber', label: 'GST' },
          { key: 'dealerName', label: 'Dealer', render: (r) => r.dealer?.name || '—' },
          {
            key: 'bankAccounts',
            label: 'Bank Accounts',
            render: (r) => r.bankAccounts?.map((b) => `${b.bankName} - ${b.accountNumber} (${b.ifsc})`).join(' | ') || 'None',
          },
          {
            key: 'login',
            label: 'Login',
            render: (r) => {
              const login = r.users?.[0];
              return (
                <div>
                  {login
                    ? <span className="font-medium text-gray-700">{login.username}</span>
                    : <span className="text-amber-600 text-xs">No login yet</span>}
                  {canWrite && (
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
            Retailer login
            <span className="block text-xs font-normal text-orange-700">किरकोळ विक्रेता लॉगिन</span>
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
