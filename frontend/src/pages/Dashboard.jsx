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
      <h1 className="text-2xl font-semibold mb-1">
        Welcome / स्वागत आहे, {user.username}
      </h1>
      <p className="text-gray-500 mb-6">Role / भूमिका: {user.role}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-5 rounded shadow">
          <div className="text-gray-500 text-sm">Total sales / एकूण विक्री</div>
          <div className="text-3xl font-bold">{summary?.count ?? '-'}</div>
        </div>
        <div className="bg-white p-5 rounded shadow">
          <div className="text-gray-500 text-sm">Revenue / महसूल</div>
          <div className="text-3xl font-bold">₹{summary?.totalRevenue?.toFixed?.(2) ?? '0.00'}</div>
        </div>
        <div className="bg-white p-5 rounded shadow">
          <div className="text-gray-500 text-sm">Low stock items / कमी साठा असलेल्या वस्तू</div>
          <div className="text-3xl font-bold text-red-600">{lowStock.length}</div>
        </div>
      </div>

      {lowStock.length > 0 && (
        <div>
          <h2 className="font-semibold text-red-700 mb-2">⚠ Reorder needed / पुनर्क्रम आवश्यक</h2>
          <div className="bg-white rounded shadow overflow-x-auto overflow-y-auto max-h-[75vh]">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr>
                  <th className="text-left p-2">Product <span className="text-gray-400 font-normal">/ उत्पादन</span></th>
                  <th className="text-left p-2">Barcode <span className="text-gray-400 font-normal">/ बारकोड</span></th>
                  <th className="text-left p-2">Batch <span className="text-gray-400 font-normal">/ बॅच</span></th>
                  <th className="text-left p-2">Expiry <span className="text-gray-400 font-normal">/ एक्सपायरी</span></th>
                  <th className="text-left p-2">MRP <span className="text-gray-400 font-normal">/ एमआरपी</span></th>
                  <th className="text-left p-2">Quantity <span className="text-gray-400 font-normal">/ प्रमाण</span></th>
                  <th className="text-left p-2">Reorder Level <span className="text-gray-400 font-normal">/ पुनर्क्रम पातळी</span></th>
                  <th className="text-left p-2">Status <span className="text-gray-400 font-normal">/ स्थिती</span></th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map((r) => (
                  <tr key={r.id} className="border-t bg-red-50">
                    <td className="p-2">{r.product?.name} ({r.product?.sizeWeight})</td>
                    <td className="p-2">{r.product?.barcode}</td>
                    <td className="p-2">{r.batchName || '-'}</td>
                    <td className="p-2">{r.expiryDate ? new Date(r.expiryDate).toLocaleDateString() : '-'}</td>
                    <td className="p-2">{r.mrp != null ? `₹${Number(r.mrp).toFixed(2)}` : '-'}</td>
                    <td className="p-2">{r.quantity}</td>
                    <td className="p-2">{r.reorderLevel}</td>
                    <td className="p-2"><span className="text-red-600 font-semibold">⚠ Reorder now / आता पुन्हा मागवा</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
