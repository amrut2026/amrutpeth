import { useEffect, useState } from 'react';
import api from '../api.js';

const empty = { org_name: '', org_address: '', org_contact: '', org_type: 'MAHAMANDAL' };

export default function Organisation() {
  const [orgs, setOrgs] = useState([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/organisations');
    setOrgs(data);
  }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/organisations', form);
      setForm(empty);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create organisation');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Organisation (Mahamandal)</h1>

      <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input placeholder="Organisation Name" className="border rounded px-2 py-1" required
          value={form.org_name} onChange={(e) => setForm({ ...form, org_name: e.target.value })} />
        <input placeholder="Address" className="border rounded px-2 py-1" required
          value={form.org_address} onChange={(e) => setForm({ ...form, org_address: e.target.value })} />
        <input placeholder="Contact Number" className="border rounded px-2 py-1" required
          value={form.org_contact} onChange={(e) => setForm({ ...form, org_contact: e.target.value })} />
        <select className="border rounded px-2 py-1"
          value={form.org_type} onChange={(e) => setForm({ ...form, org_type: e.target.value })}>
          <option value="MAHAMANDAL">MAHAMANDAL</option>
          <option value="FEDERATION">FEDERATION</option>
          <option value="ASSOCIATION">ASSOCIATION</option>
        </select>
        <button className="md:col-span-4 bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
          Create Organisation
        </button>
        {error && <p className="md:col-span-4 text-red-600 text-sm">{error}</p>}
      </form>

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2">ID</th>
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">Address</th>
              <th className="text-left p-2">Contact</th>
              <th className="text-left p-2">Type</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.orgId} className="border-t">
                <td className="p-2">{o.orgId}</td>
                <td className="p-2">{o.orgName}</td>
                <td className="p-2">{o.orgAddress}</td>
                <td className="p-2">{o.orgContact}</td>
                <td className="p-2">{o.orgType}</td>
              </tr>
            ))}
            {orgs.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={5}>No organisations yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
