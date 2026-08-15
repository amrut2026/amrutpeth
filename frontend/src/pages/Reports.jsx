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
    ['dispatch', 'Products Dispatched / पाठवलेली उत्पादने'],
    ['receivables', 'Receivables from Retailers / किरकोळ विक्रेत्यांकडून येणी'],
    ['inventory', 'Product Inventory / उत्पादन साठा'],
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">
        Reports <span className="text-base font-normal text-gray-500">(अहवाल)</span>
      </h1>
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
              <th className="text-left p-2">Sale # / विक्री क्र.</th><th className="text-left p-2">Date / दिनांक</th>
              <th className="text-left p-2">Items / वस्तू</th><th className="text-left p-2">Total / एकूण</th>
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
              {dispatch.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={4}>No dispatches to retailers yet. / अद्याप किरकोळ विक्रेत्यांना पाठवलेले नाही.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'receivables' && (
        <div className="bg-white rounded shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100"><tr>
              <th className="text-left p-2">Voucher # / व्हाउचर क्र.</th><th className="text-left p-2">Retailer / किरकोळ विक्रेता</th>
              <th className="text-left p-2">Total / एकूण</th><th className="text-left p-2">Received / मिळाले</th>
              <th className="text-left p-2">Outstanding / थकबाकी</th>
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
              {receivables.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={5}>No outstanding receivables. / कोणतीही थकबाकी नाही.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'inventory' && (
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
              {inventory.map((r) => (
                <tr key={r.id} className={`border-t ${r.lowStock ? 'bg-red-50' : ''}`}>
                  <td className="p-2">{r.product?.name} ({r.product?.sizeWeight})</td>
                  <td className="p-2">{r.product?.barcode}</td>
                  <td className="p-2">{r.batchName || '-'}</td>
                  <td className="p-2">{r.expiryDate ? new Date(r.expiryDate).toLocaleDateString() : '-'}</td>
                  <td className="p-2">{r.mrp != null ? `₹${Number(r.mrp).toFixed(2)}` : '-'}</td>
                  <td className="p-2">{r.quantity}</td>
                  <td className="p-2">{r.reorderLevel}</td>
                  <td className="p-2">
                    {r.lowStock
                      ? <span className="text-red-600 font-semibold">⚠ Reorder now / आता पुन्हा मागवा</span>
                      : <span className="text-green-600">OK / ठीक आहे</span>}
                  </td>
                </tr>
              ))}
              {inventory.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={8}>No inventory yet. / अद्याप साठा नाही.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
