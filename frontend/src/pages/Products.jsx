import { useEffect, useState } from 'react';
import api from '../api.js';
import Barcode from '../components/Barcode.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const empty = {
  categoryId: '', supplierId: '', name: '', sizeWeight: '', flavour: '', brand: '', cgst: '', sgst: '', fssaiCode: '',
};

// A dropdown backed by a shared vocabulary (ProductName/Unit/Flavour/Brand —
// see schema.prisma and products.js), with inline "+" (add a value not yet
// in the list) and "!" (rename the currently selected value) controls. Used
// for all four of Product Name, Size/Weight, Flavour, and Brand below — the
// only differences between them are which list/field/endpoint they're
// backed by, handled by the onAdd/onEdit callbacks the caller supplies.
// Internal add/edit mode resets on remount — callers force that by keying
// this component on whatever identifies the current form session (see
// formKey in Products() below), so leftover "add" or "rename" state from
// one product doesn't leak into the next.
function LookupField({ options, valueField, value, onChange, onAdd, onEdit, selectPlaceholder, addPlaceholder, required, disabled, disabledMessage }) {
  const [mode, setMode] = useState('view'); // 'view' | 'add' | 'edit'
  const [text, setText] = useState('');

  if (disabled) {
    return (
      <select className="border rounded px-2 py-1 w-full text-gray-400" disabled>
        <option>{disabledMessage}</option>
      </select>
    );
  }

  function startAdd() { setText(''); setMode('add'); }
  function startEdit() { if (!value) return; setText(value); setMode('edit'); }
  function cancel() { setMode('view'); setText(''); }
  async function confirm() {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (mode === 'add') await onAdd(trimmed);
    else await onEdit(value, trimmed);
    setMode('view');
    setText('');
  }

  if (mode !== 'view') {
    return (
      <div className="flex gap-1">
        <input autoFocus className="border rounded px-2 py-1 flex-1"
          placeholder={mode === 'add' ? addPlaceholder : `Rename "${value}"`}
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } }} />
        <button type="button" onClick={confirm} className="border rounded px-3 text-emerald-700 hover:bg-emerald-50">
          {mode === 'add' ? 'Add' : 'Save'}
        </button>
        <button type="button" onClick={cancel} className="border rounded px-3 text-gray-500 hover:bg-gray-50">✕</button>
      </div>
    );
  }

  return (
    <div className="flex gap-1">
      <select className="border rounded px-2 py-1 flex-1" required={required}
        value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{selectPlaceholder}</option>
        {options.map((o) => <option key={o.id} value={o[valueField]}>{o[valueField]}</option>)}
      </select>
      <button type="button" title="Add new / नवीन जोडा" onClick={startAdd}
        className="border rounded px-3 text-emerald-700 font-semibold hover:bg-emerald-50">+</button>
      <button type="button" title="Rename selected / निवडलेले नाव बदला" onClick={startEdit} disabled={!value}
        className="border rounded px-3 text-amber-700 font-semibold hover:bg-amber-50 disabled:opacity-30 disabled:cursor-not-allowed">!</button>
    </div>
  );
}

export default function Products() {
  const { user } = useAuth();
  const isDealer = user.role === 'DEALER';
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [productNames, setProductNames] = useState([]);
  const [units, setUnits] = useState([]);
  const [flavours, setFlavours] = useState([]);
  const [brands, setBrands] = useState([]);
  const [form, setForm] = useState(empty);
  const [selectedId, setSelectedId] = useState(null);
  const [cloneSource, setCloneSource] = useState(null); // product being cloned from, if any
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  // Bumped on every selectProduct/cloneProduct/startNew — used as a React
  // `key` on each LookupField below so its internal add/edit mode resets
  // when the form switches to a different product, instead of leaking a
  // half-finished "rename" across products.
  const [formKey, setFormKey] = useState(0);

  async function load() {
    const [p, c, s, u, b] = await Promise.all([
      api.get('/products'), api.get('/categories'), api.get('/suppliers'),
      api.get('/products/units'), api.get('/products/brands'),
    ]);
    setProducts(p.data);
    setCategories(c.data);
    setSuppliers(s.data);
    setUnits(u.data);
    setBrands(b.data);
  }
  useEffect(() => { load(); }, []);

  // Product Name and Flavour are both scoped to a category (see
  // schema.prisma ProductName/Flavour) — refetch both dropdowns' vocabulary
  // whenever the selected category changes, instead of loading every
  // category's names/flavours up front.
  useEffect(() => {
    if (!form.categoryId) { setProductNames([]); setFlavours([]); return; }
    api.get('/products/names', { params: { categoryId: form.categoryId } }).then((res) => setProductNames(res.data));
    api.get('/products/flavours', { params: { categoryId: form.categoryId } }).then((res) => setFlavours(res.data));
  }, [form.categoryId]);

  // Generic add/rename handlers for a lookup dropdown — see LookupField
  // above. `extraBody` carries whatever the create endpoint needs beyond
  // the value itself (categoryId, for names/flavours).
  function lookupHandlers(endpoint, valueField, list, setList, formField, extraBody = {}) {
    return {
      add: async (text) => {
        const { data } = await api.post(endpoint, { [valueField]: text, ...extraBody });
        setList((prev) => (prev.some((x) => x.id === data.id) ? prev : [...prev, data].sort((a, b) => a[valueField].localeCompare(b[valueField]))));
        setForm((f) => ({ ...f, [formField]: data[valueField] }));
      },
      edit: async (oldValue, text) => {
        const row = list.find((x) => x[valueField] === oldValue);
        if (!row) return;
        const { data } = await api.put(`${endpoint}/${row.id}`, { [valueField]: text });
        setList((prev) => prev.map((x) => (x.id === row.id ? data : x)).sort((a, b) => a[valueField].localeCompare(b[valueField])));
        setForm((f) => (f[formField] === oldValue ? { ...f, [formField]: data[valueField] } : f));
      },
    };
  }
  const nameHandlers = lookupHandlers('/products/names', 'name', productNames, setProductNames, 'name', { categoryId: form.categoryId });
  const unitHandlers = lookupHandlers('/products/units', 'value', units, setUnits, 'sizeWeight');
  const flavourHandlers = lookupHandlers('/products/flavours', 'value', flavours, setFlavours, 'flavour', { categoryId: form.categoryId });
  const brandHandlers = lookupHandlers('/products/brands', 'value', brands, setBrands, 'brand');

  // A product saved before a dropdown existed (or holding a value that's
  // since been renamed elsewhere) might carry a value that isn't in the
  // fetched list — keep it selectable rather than silently blanking the
  // field out.
  function withFallback(list, valueField, currentValue) {
    return currentValue && !list.some((x) => x[valueField] === currentValue)
      ? [{ id: 'current', [valueField]: currentValue }, ...list]
      : list;
  }
  const nameOptions = withFallback(productNames, 'name', form.name);
  const unitOptions = withFallback(units, 'value', form.sizeWeight);
  const flavourOptions = withFallback(flavours, 'value', form.flavour);
  const brandOptions = withFallback(brands, 'value', form.brand);

  const isEditing = selectedId !== null;
  const selectedProduct = products.find((p) => p.id === selectedId);

  function selectProduct(p) {
    setSelectedId(p.id);
    setCloneSource(null);
    setError('');
    setFormKey((k) => k + 1);
    setForm({
      categoryId: p.categoryId,
      supplierId: p.supplierId || '',
      name: p.name,
      sizeWeight: p.sizeWeight,
      flavour: p.flavour || '',
      brand: p.brand || '',
      cgst: String(p.cgst),
      sgst: String(p.sgst),
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
    setFormKey((k) => k + 1);
    setForm({
      categoryId: p.categoryId,
      supplierId: '',
      name: p.name,
      sizeWeight: p.sizeWeight,
      flavour: p.flavour || '',
      brand: p.brand || '',
      cgst: String(p.cgst),
      sgst: String(p.sgst),
      fssaiCode: p.fssaiCode,
    });
  }

  function startNew() {
    setSelectedId(null);
    setCloneSource(null);
    setForm(empty);
    setError('');
    setFormKey((k) => k + 1);
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
              value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">Supplier... / पुरवठादार...</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className="border rounded px-2 py-1 md:col-span-2" required
              value={form.categoryId}
              onChange={(e) => {
                const categoryId = e.target.value;
                const cat = categories.find((c) => String(c.id) === String(categoryId));
                // CGST/SGST default to the newly selected category's own
                // rate — editable below if that default isn't right for
                // this particular product. Name and Flavour are both
                // category-scoped vocabularies, so a value picked under the
                // old category doesn't carry over.
                setForm({
                  ...form, categoryId, name: '', flavour: '',
                  cgst: cat ? String(cat.cgst) : '',
                  sgst: cat ? String(cat.sgst) : '',
                });
              }}>
              <option value="">Category... / श्रेणी...</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            {!form.categoryId ? (
              <select className="border rounded px-2 py-1 w-full text-gray-400 md:col-span-2" disabled>
                <option>Select a category first / प्रथम श्रेणी निवडा</option>
              </select>
            ) : (
              <div className="md:col-span-2">
                <LookupField key={`name-${formKey}-${form.categoryId}`}
                  options={nameOptions} valueField="name" value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                  onAdd={nameHandlers.add} onEdit={nameHandlers.edit}
                  selectPlaceholder="Product Name... / उत्पादनाचे नाव..." addPlaceholder="New product name / नवीन उत्पादनाचे नाव"
                  required />
              </div>
            )}

            {!form.categoryId ? (
              <select className="border rounded px-2 py-1 w-full text-gray-400 md:col-span-2" disabled>
                <option>Select a category first / प्रथम श्रेणी निवडा</option>
              </select>
            ) : (
              <div className="md:col-span-2">
                <LookupField key={`flavour-${formKey}-${form.categoryId}`}
                  options={flavourOptions} valueField="value" value={form.flavour}
                  onChange={(v) => setForm({ ...form, flavour: v })}
                  onAdd={flavourHandlers.add} onEdit={flavourHandlers.edit}
                  selectPlaceholder="Flavour (optional) / फ्लेवर (ऐच्छिक)" addPlaceholder="New flavour / नवीन फ्लेवर" />
              </div>
            )}

            <div className="md:col-span-2">
              <LookupField key={`unit-${formKey}`}
                options={unitOptions} valueField="value" value={form.sizeWeight}
                onChange={(v) => setForm({ ...form, sizeWeight: v })}
                onAdd={unitHandlers.add} onEdit={unitHandlers.edit}
                selectPlaceholder="Size / Weight... / आकार / वजन..." addPlaceholder="New size/weight (e.g. 200g)"
                required />
            </div>

            <div className="md:col-span-2">
              <LookupField key={`brand-${formKey}`}
                options={brandOptions} valueField="value" value={form.brand}
                onChange={(v) => setForm({ ...form, brand: v })}
                onAdd={brandHandlers.add} onEdit={brandHandlers.edit}
                selectPlaceholder="Brand (optional) / ब्रँड (ऐच्छिक)" addPlaceholder="New brand / नवीन ब्रँड" />
            </div>

            <input placeholder="FSSAI Code / एफएसएसएआय कोड" className="border rounded px-2 py-1 md:col-span-2" required
              value={form.fssaiCode} onChange={(e) => setForm({ ...form, fssaiCode: e.target.value })} />

            <div>
              <label className="text-xs text-gray-500 block mb-1">CGST % (from category, editable) / सीजीएसटी %</label>
              <input type="number" step="0.01" min="0" className="border rounded px-2 py-1 w-full" required
                value={form.cgst} onChange={(e) => setForm({ ...form, cgst: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">SGST % (from category, editable) / एसजीएसटी %</label>
              <input type="number" step="0.01" min="0" className="border rounded px-2 py-1 w-full" required
                value={form.sgst} onChange={(e) => setForm({ ...form, sgst: e.target.value })} />
            </div>

            <p className="md:col-span-2 text-xs text-gray-500">
              Pricing, MRP, dates, and batch name are set when this product is purchased, not here — see Purchases. /
              किंमत, एमआरपी, तारखा आणि बॅचचे नाव हे उत्पादन खरेदी करताना ठरवले जाते, इथे नाही — खरेदी विभाग पहा.
            </p>

            {isEditing && selectedProduct && (
              <div className="md:col-span-2 flex items-center gap-3 bg-gray-50 rounded p-2">
                <Barcode value={selectedProduct.barcode}
                  name={selectedProduct.name} sizeWeight={selectedProduct.sizeWeight}
                  flavour={selectedProduct.flavour} brand={selectedProduct.brand} />
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
                  <div className="font-semibold">
                    {p.name} <span className="text-xs text-gray-400">({p.sizeWeight})</span>
                    {p.brand && <span className="text-xs text-gray-400"> · {p.brand}</span>}
                    {p.flavour && <span className="text-xs text-gray-400"> · {p.flavour}</span>}
                  </div>
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
