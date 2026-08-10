import { useEffect, useState } from 'react';
import api from '../api.js';
import Barcode, { printBarcodeLabels } from '../components/Barcode.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const empty = {
  categoryId: '', name: '', sizeWeight: '', costPrice: '', sellingPrice: '', discount: '0', mrp: '',
  manufacturingDate: '', expiryDate: '', batchName: '', fssaiCode: '', initialQuantity: '0', reorderLevel: '10'
};

// Convert an ISO date string to yyyy-mm-dd for <input type="date">
function toDateInput(iso) {
  return iso ? String(iso).slice(0, 10) : '';
}

export default function Products() {
  const { user } = useAuth();
  const isAdmin = user.role === 'ADMIN';
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(empty);
  const [selectedId, setSelectedId] = useState(null);
  const [printQty, setPrintQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  async function load() {
    const [p, c] = await Promise.all([api.get('/products'), api.get('/categories')]);
    setProducts(p.data);
    setCategories(c.data);
  }
  useEffect(() => { load(); }, []);

  const isEditing = selectedId !== null;
  const selectedProduct = products.find((p) => p.id === selectedId);

  function selectProduct(p) {
    setSelectedId(p.id);
    setError('');
    setForm({
      categoryId: p.categoryId,
      name: p.name,
      sizeWeight: p.sizeWeight,
      costPrice: p.costPrice,
      sellingPrice: p.sellingPrice,
      discount: p.discount,
      mrp: p.mrp,
      manufacturingDate: toDateInput(p.manufacturingDate),
      expiryDate: toDateInput(p.expiryDate),
      batchName: p.batchName,
      fssaiCode: p.fssaiCode,
      initialQuantity: '',
      reorderLevel: '',
    });
  }

  function startNew() {
    setSelectedId(null);
    setForm(empty);
    setError('');
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (isEditing) {
        await api.put(`/products/${selectedId}`, form);
      } else {
        await api.post('/products', form);
      }
      await load();
      if (!isEditing) startNew();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save product');
    } finally {
      setSaving(false);
    }
  }

  const filtered = products.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.barcode.includes(search)
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Products</h1>

      <div className={`grid grid-cols-1 ${isAdmin ? 'lg:grid-cols-2' : ''} gap-6`}>
        {/* LEFT: product details form (create or edit) - ADMIN only */}
        {isAdmin && (
        <div className="bg-white p-4 rounded shadow h-fit sticky top-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">{isEditing ? `Edit Product #${selectedId}` : 'New Product'}</h2>
            {isEditing && (
              <button type="button" onClick={startNew} className="text-sm text-emerald-700 hover:underline">
                + New product instead
              </button>
            )}
          </div>

          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select className="border rounded px-2 py-1 md:col-span-2" required
              value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Category...</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input placeholder="Product Name" className="border rounded px-2 py-1" required
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Size / Weight (e.g. 200g)" className="border rounded px-2 py-1" required
              value={form.sizeWeight} onChange={(e) => setForm({ ...form, sizeWeight: e.target.value })} />
            <input placeholder="Batch Name" className="border rounded px-2 py-1" required
              value={form.batchName} onChange={(e) => setForm({ ...form, batchName: e.target.value })} />
            <input placeholder="FSSAI Code" className="border rounded px-2 py-1" required
              value={form.fssaiCode} onChange={(e) => setForm({ ...form, fssaiCode: e.target.value })} />

            <input type="number" step="0.01" placeholder="Cost Price" className="border rounded px-2 py-1" required
              value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} />
            <input type="number" step="0.01" placeholder="Selling Price" className="border rounded px-2 py-1" required
              value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} />
            <input type="number" step="0.01" placeholder="Discount" className="border rounded px-2 py-1"
              value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
            <input type="number" step="0.01" placeholder="MRP" className="border rounded px-2 py-1" required
              value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} />

            <div className="flex flex-col">
              <label className="text-xs text-gray-500">Manufacturing Date</label>
              <input type="date" className="border rounded px-2 py-1" required
                value={form.manufacturingDate} onChange={(e) => setForm({ ...form, manufacturingDate: e.target.value })} />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500">Expiry Date</label>
              <input type="date" className="border rounded px-2 py-1" required
                value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            </div>

            {!isEditing && (
              <>
                <input type="number" placeholder="Initial Stock Qty" className="border rounded px-2 py-1"
                  value={form.initialQuantity} onChange={(e) => setForm({ ...form, initialQuantity: e.target.value })} />
                <input type="number" placeholder="Reorder Level" className="border rounded px-2 py-1"
                  value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
              </>
            )}

            {isEditing && selectedProduct && (
              <div className="md:col-span-2 flex items-center gap-3 bg-gray-50 rounded p-2">
                <Barcode value={selectedProduct.barcode} />
                <div className="flex items-center gap-2">
                  <input type="number" min="1" value={printQty} onChange={(e) => setPrintQty(e.target.value)}
                    className="border rounded w-16 px-1 py-1 text-sm" />
                  <button type="button" onClick={() => printBarcodeLabels(selectedProduct, Number(printQty) || 1)}
                    className="bg-gray-800 text-white px-3 py-2 rounded text-sm hover:bg-gray-700">
                    Print Labels
                  </button>
                </div>
              </div>
            )}

            {error && <p className="md:col-span-2 text-red-600 text-sm">{error}</p>}

            <button disabled={saving} className="md:col-span-2 bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
              {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Product & Generate Barcode'}
            </button>
          </form>
        </div>
        )}

        {/* RIGHT: product list, selectable for editing on the left (ADMIN); read-only browse for others */}
        <div>
          {!isAdmin && (
            <p className="text-sm text-gray-500 mb-3">
              Browsing the product catalog. Only an admin can add or edit products.
            </p>
          )}
          <input
            placeholder="Search by name or barcode..."
            className="border rounded px-3 py-2 w-full mb-3"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="space-y-2 max-h-[75vh] overflow-y-auto pr-1">
            {filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => isAdmin && selectProduct(p)}
                className={`w-full text-left bg-white p-3 rounded shadow flex items-center justify-between gap-3 border-2 ${
                  isAdmin ? 'cursor-pointer' : ''
                } ${selectedId === p.id ? 'border-emerald-600' : 'border-transparent hover:border-gray-200'}`}>
                <div>
                  <div className="font-semibold">{p.name} <span className="text-xs text-gray-400">({p.sizeWeight})</span></div>
                  <div className="text-sm text-gray-500">
                    {p.category?.name} · MRP ₹{p.mrp} · Selling ₹{p.sellingPrice} · Batch {p.batchName}
                  </div>
                  <div className="text-xs text-gray-400">Barcode: {p.barcode}</div>
                </div>
                <div className="flex items-center gap-2">
                  {!isAdmin && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); printBarcodeLabels(p, 1); }}
                      className="bg-gray-800 text-white px-3 py-2 rounded text-sm hover:bg-gray-700">
                      Print
                    </button>
                  )}
                  {selectedId === p.id && <span className="text-emerald-700 text-sm font-medium">Editing</span>}
                </div>
              </div>
            ))}
            {filtered.length === 0 && <p className="text-gray-400">No products found.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}