import { useEffect, useState } from 'react';
import api from '../api.js';

export default function Reports() {
  const [tab, setTab] = useState('dispatch');
  const [dispatch, setDispatch] = useState([]);
  const [receivables, setReceivables] = useState([]);
  const [inventory, setInventory] = useState([]);

  useEffect(() => {
    api.get('/reports/dispatch').then((r) => setDispatch(r.data));
    api.get('/reports/receivables').then((r) => setReceivables(r.data));
    api.get('/reports/inventory').then((r) => setInventory(r.data));
  }, []);

  const tabs = [
    ['dispatch', 'Products Dispatched'],
    ['receivables', 'Receivables from Retailers'],
    ['inventory', 'Product Inventory'],
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Reports</h1>
      <div className="flex gap-2 mb-4">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded text-sm ${tab === key ? 'bg-emerald-700 text-white' : 'bg-white border'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'dispatch' && (
        <div className="bg-white rounded shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100"><tr>
              <th className="text-left p-2">Sale #</th><th className="text-left p-2">Date</th>
              <th className="text-left p-2">Items</th><th className="text-left p-2">Total</th>
            </tr></thead>
            <tbody>
              {dispatch.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-2">{s.id}</td>
                  <td className="p-2">{new Date(s.date).toLocaleDateString()}</td>
                  <td className="p-2">{s.items.map((i) => `${i.product.name} x${i.quantity}`).join(', ')}</td>
                  <td className="p-2">₹{Number(s.totalAmount).toFixed(2)}</td>
                </tr>
              ))}
              {dispatch.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={4}>No dispatches to retailers yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'receivables' && (
        <div className="bg-white rounded shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100"><tr>
              <th className="text-left p-2">Voucher #</th><th className="text-left p-2">Retailer</th>
              <th className="text-left p-2">Total</th><th className="text-left p-2">Received</th>
              <th className="text-left p-2">Outstanding</th>
            </tr></thead>
            <tbody>
              {receivables.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className="p-2">{v.id}</td>
                  <td className="p-2">{v.retailer?.name}</td>
                  <td className="p-2">₹{Number(v.amount).toFixed(2)}</td>
                  <td className="p-2">₹{v.received.toFixed(2)}</td>
                  <td className="p-2 font-semibold text-red-600">₹{v.outstanding.toFixed(2)}</td>
                </tr>
              ))}
              {receivables.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={5}>No outstanding receivables.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'inventory' && (
        <div className="bg-white rounded shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100"><tr>
              <th className="text-left p-2">Product</th><th className="text-left p-2">Qty</th>
              <th className="text-left p-2">Reorder Level</th><th className="text-left p-2">Status</th>
            </tr></thead>
            <tbody>
              {inventory.map((r) => (
                <tr key={r.id} className={`border-t ${r.lowStock ? 'bg-red-50' : ''}`}>
                  <td className="p-2">{r.product?.name}</td>
                  <td className="p-2">{r.quantity}</td>
                  <td className="p-2">{r.reorderLevel}</td>
                  <td className="p-2">{r.lowStock ? <span className="text-red-600">⚠ Reorder</span> : <span className="text-green-600">OK</span>}</td>
                </tr>
              ))}
              {inventory.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={4}>No inventory yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
