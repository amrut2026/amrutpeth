import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [inventory, setInventory] = useState([]);

  useEffect(() => {
    api.get('/reports/sales-summary').then((r) => setSummary(r.data));
    api.get('/reports/inventory').then((r) => setInventory(r.data));
  }, []);

  const lowStock = inventory.filter((i) => i.lowStock);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Welcome, {user.username}</h1>
      <p className="text-gray-500 mb-6">Role: {user.role}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-5 rounded shadow">
          <div className="text-gray-500 text-sm">Total sales</div>
          <div className="text-3xl font-bold">{summary?.count ?? '-'}</div>
        </div>
        <div className="bg-white p-5 rounded shadow">
          <div className="text-gray-500 text-sm">Revenue</div>
          <div className="text-3xl font-bold">₹{summary?.totalRevenue?.toFixed?.(2) ?? '0.00'}</div>
        </div>
        <div className="bg-white p-5 rounded shadow">
          <div className="text-gray-500 text-sm">Low stock items</div>
          <div className="text-3xl font-bold text-red-600">{lowStock.length}</div>
        </div>
      </div>

      {lowStock.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <h2 className="font-semibold text-red-700 mb-2">⚠ Reorder needed</h2>
          <ul className="text-sm text-red-700 space-y-1">
            {lowStock.map((i) => (
              <li key={i.id}>{i.product?.name} — qty {i.quantity} (reorder level {i.reorderLevel})</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
