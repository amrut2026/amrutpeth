import { useEffect, useState } from 'react';
import api from '../api.js';

export default function Inventory() {
  const [rows, setRows] = useState([]);

  useEffect(() => { api.get('/inventory').then((r) => setRows(r.data)); }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Inventory <span className="text-gray-400 font-normal">/ इन्व्हेंटरी</span></h1>
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
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
            {/* Inventory is now tracked per batch — a product with stock from
                two different accepted purchases shows as two rows here, each
                with its own batch name, expiry, and quantity. */}
            {rows.map((r) => (
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
            {rows.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={8}>No inventory yet. / अद्याप इन्व्हेंटरी नाही.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
