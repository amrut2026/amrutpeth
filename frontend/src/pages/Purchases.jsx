import { useEffect, useState } from 'react';
import api from '../api.js';

export default function Purchases() {
  const [purchases, setPurchases] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [items, setItems] = useState([{ productId: '', quantity: '', rate: '' }]);

  async function load() {
    const [p, prod, sup] = await Promise.all([api.get('/purchases'), api.get('/products'), api.get('/suppliers')]);
    setPurchases(p.data);
    setProducts(prod.data);
    setSuppliers(sup.data);
  }
  useEffect(() => { load(); }, []);

  function updateItem(i, key, val) {
    const copy = [...items];
    copy[i][key] = val;
    setItems(copy);
  }

  async function submit(e) {
    e.preventDefault();
    await api.post('/purchases', { supplierId, items });
    setSupplierId('');
    setItems([{ productId: '', quantity: '', rate: '' }]);
    load();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Purchases / Stock Inwards</h1>

      <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 space-y-3">
        <select className="border rounded px-2 py-1 w-full md:w-1/2" required
          value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Supplier / Manufacturer...</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {suppliers.length === 0 && (
          <p className="text-xs text-amber-600">No suppliers yet — ask an admin to add one under Suppliers.</p>
        )}

        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-3 gap-2">
            <select className="border rounded px-2 py-1" required
              value={it.productId} onChange={(e) => updateItem(i, 'productId', e.target.value)}>
              <option value="">Product...</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sizeWeight})</option>)}
            </select>
            <input type="number" placeholder="Quantity" className="border rounded px-2 py-1" required
              value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} />
            <input type="number" step="0.01" placeholder="Rate" className="border rounded px-2 py-1" required
              value={it.rate} onChange={(e) => updateItem(i, 'rate', e.target.value)} />
          </div>
        ))}
        <button type="button" className="text-emerald-700 text-sm"
          onClick={() => setItems([...items, { productId: '', quantity: '', rate: '' }])}>
          + Add another item
        </button>
        <div>
          <button className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">Record Purchase</button>
        </div>
      </form>

      <div className="grid gap-3">
        {purchases.map((p) => (
          <div key={p.id} className="bg-white p-4 rounded shadow">
            <div className="font-semibold">{p.supplier?.name} <span className="text-xs text-gray-400">{new Date(p.date).toLocaleString()}</span></div>
            <ul className="text-sm text-gray-600 mt-1">
              {p.items.map((it) => (
                <li key={it.id}>{it.product?.name} — qty {it.quantity} @ ₹{it.rate}</li>
              ))}
            </ul>
          </div>
        ))}
        {purchases.length === 0 && <p className="text-gray-400">No purchases recorded yet.</p>}
      </div>
    </div>
  );
}
