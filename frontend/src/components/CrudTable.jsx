import { useEffect, useState } from 'react';
import api from '../api.js';

// Generic list+create component driven by a field config.
// fields: [{ key, label, type: 'text'|'number'|'date'|'select', options? }]
// canWrite: if false, the create form is hidden and only the list is shown (read-only view).
export default function CrudTable({ title, endpoint, fields, columns, transformSubmit, canWrite = true }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get(endpoint);
    setRows(data);
  }

  useEffect(() => { load(); }, [endpoint]);

  const emptyBankRow = { accountNumber: '', ifsc: '', bankName: '' };

  function bankRows(key) {
    return form[key]?.length ? form[key] : [emptyBankRow];
  }

  function updateBankRow(key, i, field, val) {
    const rows = bankRows(key).map((row, idx) => (idx === i ? { ...row, [field]: val } : row));
    setForm({ ...form, [key]: rows });
  }

  function addBankRow(key) {
    setForm({ ...form, [key]: [...bankRows(key), { ...emptyBankRow }] });
  }

  function removeBankRow(key, i) {
    const rows = bankRows(key).filter((_, idx) => idx !== i);
    setForm({ ...form, [key]: rows.length ? rows : [{ ...emptyBankRow }] });
  }

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const cleaned = { ...form };
      fields.forEach((f) => {
        if (f.type === 'bankAccounts' && cleaned[f.key]) {
          cleaned[f.key] = cleaned[f.key].filter(
            (row) => row.accountNumber || row.ifsc || row.bankName
          );
        }
      });
      const payload = transformSubmit ? transformSubmit(cleaned) : cleaned;
      await api.post(endpoint, payload);
      setForm({});
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">{title}</h1>

      {canWrite && (
        <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          {fields.map((f) => {
            if (f.type === 'bankAccounts') {
              return (
                <div key={f.key} className="md:col-span-3">
                  <div className="text-xs text-gray-500 mb-1">{f.label}</div>
                  {bankRows(f.key).map((b, i) => (
                    <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2 items-center">
                      <input placeholder="Account Number" className="border rounded px-2 py-1"
                        value={b.accountNumber} onChange={(e) => updateBankRow(f.key, i, 'accountNumber', e.target.value)} />
                      <input placeholder="IFSC Code" className="border rounded px-2 py-1"
                        value={b.ifsc} onChange={(e) => updateBankRow(f.key, i, 'ifsc', e.target.value)} />
                      <input placeholder="Bank Name" className="border rounded px-2 py-1"
                        value={b.bankName} onChange={(e) => updateBankRow(f.key, i, 'bankName', e.target.value)} />
                      {bankRows(f.key).length > 1 && (
                        <button type="button" className="text-red-600 text-xs justify-self-start"
                          onClick={() => removeBankRow(f.key, i)}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="text-emerald-700 text-sm"
                    onClick={() => addBankRow(f.key)}>
                    + Add another bank account
                  </button>
                </div>
              );
            }
            return (
              <div key={f.key} className="flex flex-col">
                <label className="text-xs text-gray-500 mb-1">{f.label}</label>
                {f.type === 'select' ? (
                  <select
                    className="border rounded px-2 py-1"
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    required={f.required}>
                    <option value="">Select...</option>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input
                    className="border rounded px-2 py-1"
                    type={f.type || 'text'}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    required={f.required}
                  />
                )}
              </div>
            );
          })}
          <div className="md:col-span-3 flex items-center gap-3">
            <button disabled={loading} className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
              {loading ? 'Saving...' : `Add ${title.replace(/s$/, '')}`}
            </button>
            {error && <span className="text-red-600 text-sm">{error}</span>}
          </div>
        </form>
      )}

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>{columns.map((c) => <th key={c.key} className="text-left p-2">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                {columns.map((c) => (
                  <td key={c.key} className="p-2">{c.render ? c.render(r) : r[c.key]}</td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="p-3 text-gray-400" colSpan={columns.length}>No records yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
