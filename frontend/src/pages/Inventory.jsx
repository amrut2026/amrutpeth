import { useEffect, useState } from 'react';
import api from '../api.js';

export default function Inventory() {
  const [rows, setRows] = useState([]);

  useEffect(() => { api.get('/inventory').then((r) => setRows(r.data)); }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Inventory</h1>
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2">Product</th>
              <th className="text-left p-2">Barcode</th>
              <th className="text-left p-2">Quantity</th>
              <th className="text-left p-2">Reorder Level</th>
              <th className="text-left p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t ${r.lowStock ? 'bg-red-50' : ''}`}>
                <td className="p-2">{r.product?.name} ({r.product?.sizeWeight})</td>
                <td className="p-2">{r.product?.barcode}</td>
                <td className="p-2">{r.quantity}</td>
                <td className="p-2">{r.reorderLevel}</td>
                <td className="p-2">
                  {r.lowStock
                    ? <span className="text-red-600 font-semibold">⚠ Reorder now</span>
                    : <span className="text-green-600">OK</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={5}>No inventory yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
