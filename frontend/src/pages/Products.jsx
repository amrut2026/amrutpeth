import { useEffect, useState } from 'react';
import api from '../api.js';
import Barcode from '../components/Barcode.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const empty = {
  categoryId: '', supplierId: '', name: '', sizeWeight: '', fssaiCode: '',
};

export default function Products() {
  const { user } = useAuth();
  const isDealer = user.role === 'DEALER';
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(empty);
  const [selectedId, setSelectedId] = useState(null);
  const [cloneSource, setCloneSource] = useState(null); // product being cloned from, if any
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');

  async function load() {
    const [p, c, s] = await Promise.all([api.get('/products'), api.get('/categories'), api.get('/suppliers')]);
    setProducts(p.data);
    setCategories(c.data);
    setSuppliers(s.data);
  }
  useEffect(() => { load(); }, []);

  const isEditing = selectedId !== null;
  const selectedProduct = products.find((p) => p.id === selectedId);

  function selectProduct(p) {
    setSelectedId(p.id);
    setCloneSource(null);
    setError('');
    setForm({
      categoryId: p.categoryId,
      supplierId: p.supplierId || '',
      name: p.name,
      sizeWeight: p.sizeWeight,
      fssaiCode: p.fssaiCode,
    });
  }

  // Pre-fills the create form with another product's details, but as a brand
  // new record: no id (so it POSTs, not PUTs), no supplier pre-selected (the
  // dealer must explicitly pick the target supplier), and a fresh barcode will
  // be generated server-side on save.
  function cloneProduct(p) {
    setSelectedId(null);
    setCloneSource(p);
    setError('');
    setForm({
      categoryId: p.categoryId,
      supplierId: '',
      name: p.name,
      sizeWeight: p.sizeWeight,
      fssaiCode: p.fssaiCode,
    });
  }

  function startNew() {
    setSelectedId(null);
    setCloneSource(null);
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
    (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.barcode.includes(search)) &&
    (!supplierFilter || p.supplierId === Number(supplierFilter))
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">
        Products <span className="text-base font-normal text-gray-500">(उत्पादने)</span>
      </h1>

      <div className={`grid grid-cols-1 ${isDealer ? 'lg:grid-cols-2' : ''} gap-6`}>
        {/* LEFT: product details form (create or edit) - DEALER only */}
        {isDealer && (
        <div className="bg-white p-4 rounded shadow h-fit sticky top-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">
              {isEditing
                ? `Edit Product #${selectedId} / उत्पादन संपादित करा #${selectedId}`
                : cloneSource
                  ? `Cloning "${cloneSource.name}" / प्रत तयार करत आहे "${cloneSource.name}"`
                  : 'New Product / नवीन उत्पादन'}
            </h2>
            {isEditing && (
              <button type="button" onClick={startNew} className="text-sm text-emerald-700 hover:underline">
                + New product instead / त्याऐवजी नवीन उत्पादन
              </button>
            )}
            {!isEditing && cloneSource && (
              <button type="button" onClick={startNew} className="text-sm text-gray-500 hover:underline">
                Cancel clone / प्रत रद्द करा
              </button>
            )}
          </div>
          {cloneSource && (
            <p className="text-xs text-amber-600 -mt-2 mb-3">
              Pick the destination supplier below and adjust any fields (e.g. pricing) before saving. /
              खालील गंतव्य पुरवठादार निवडा आणि जतन करण्यापूर्वी कोणतीही फील्ड (उदा. किंमत) समायोजित करा.
            </p>
          )}

          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select className="border rounded px-2 py-1 md:col-span-2" required
              value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Category... / श्रेणी...</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="border rounded px-2 py-1 md:col-span-2" required
              value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">Supplier... / पुरवठादार...</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input placeholder="Product Name / उत्पादनाचे नाव" className="border rounded px-2 py-1" required
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Size / Weight (आकार / वजन) (e.g. 200g)" className="border rounded px-2 py-1" required
              value={form.sizeWeight} onChange={(e) => setForm({ ...form, sizeWeight: e.target.value })} />
            <input placeholder="FSSAI Code / एफएसएसएआय कोड" className="border rounded px-2 py-1 md:col-span-2" required
              value={form.fssaiCode} onChange={(e) => setForm({ ...form, fssaiCode: e.target.value })} />

            <p className="md:col-span-2 text-xs text-gray-500">
              Pricing, MRP, dates, and batch name are set when this product is purchased, not here — see Purchases. /
              किंमत, एमआरपी, तारखा आणि बॅचचे नाव हे उत्पादन खरेदी करताना ठरवले जाते, इथे नाही — खरेदी विभाग पहा.
            </p>

            {isEditing && selectedProduct && (
              <div className="md:col-span-2 flex items-center gap-3 bg-gray-50 rounded p-2">
                <Barcode value={selectedProduct.barcode} />
                <p className="text-xs text-gray-500">
                  Barcode labels are printed from Purchases, once a purchase carrying this
                  product's MRP and retailer price is confirmed. /
                  या उत्पादनाची एमआरपी आणि किरकोळ विक्रेता किंमत असलेली खरेदी निश्चित झाल्यावर,
                  बारकोड लेबले खरेदी विभागातून छापली जातात.
                </p>
              </div>
            )}

            {error && <p className="md:col-span-2 text-red-600 text-sm">{error}</p>}

            <button disabled={saving} className="md:col-span-2 bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
              {saving
                ? 'Saving... / जतन करत आहे...'
                : isEditing
                  ? 'Save Changes / बदल जतन करा'
                  : cloneSource
                    ? 'Create Cloned Product / प्रत केलेले उत्पादन तयार करा'
                    : 'Create Product & Generate Barcode / उत्पादन तयार करा आणि बारकोड तयार करा'}
            </button>
          </form>
        </div>
        )}

        {/* RIGHT: product list, selectable for editing on the left (DEALER); read-only browse for others */}
        <div>
          {!isDealer && (
            <p className="text-sm text-gray-500 mb-3">
              Browsing the product catalog. Only a dealer can add or edit products. /
              उत्पादन सूची पाहत आहात. फक्त डीलर उत्पादने जोडू किंवा संपादित करू शकतो.
            </p>
          )}
          <div className="flex flex-col md:flex-row gap-3 mb-3">
            <input
              placeholder="Search by name or barcode... / नाव किंवा बारकोडने शोधा..."
              className="border rounded px-3 py-2 w-full"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="border rounded px-3 py-2 w-full md:w-64"
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}>
              <option value="">All suppliers / सर्व पुरवठादार</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="space-y-2 max-h-[75vh] overflow-y-auto pr-1">
            {filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => isDealer && selectProduct(p)}
                className={`w-full text-left bg-white p-3 rounded shadow flex items-center justify-between gap-3 border-2 ${
                  isDealer ? 'cursor-pointer' : ''
                } ${selectedId === p.id ? 'border-emerald-600' : 'border-transparent hover:border-gray-200'}`}>
                <div>
                  <div className="font-semibold">{p.name} <span className="text-xs text-gray-400">({p.sizeWeight})</span></div>
                  <div className="text-sm text-gray-500">{p.category?.name}</div>
                  <div className="text-xs text-gray-400">
                    Supplier / पुरवठादार: {p.supplier?.name || '—'} · Dealer / डीलर: {p.dealer?.name || '—'} · Barcode / बारकोड: {p.barcode}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isDealer && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); cloneProduct(p); }}
                      className="border border-emerald-700 text-emerald-700 px-3 py-2 rounded text-sm hover:bg-emerald-50">
                      Clone / प्रत
                    </button>
                  )}
                  {selectedId === p.id && <span className="text-emerald-700 text-sm font-medium">Editing / संपादन सुरू आहे</span>}
                </div>
              </div>
            ))}
            {filtered.length === 0 && <p className="text-gray-400">No products found. / उत्पादने आढळली नाहीत.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
