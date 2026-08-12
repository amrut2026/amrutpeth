import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

// Small helper to render an English label with its Marathi translation
// underneath, above a form field.
function FieldLabel({ en, mr }) {
  return (
    <label className="text-xs text-gray-500 flex flex-col leading-tight">
      <span>{en}</span>
      <span className="text-orange-700">{mr}</span>
    </label>
  );
}

export default function Purchases() {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [myDealer, setMyDealer] = useState(null);
  const [supplierId, setSupplierId] = useState('');
  const [error, setError] = useState('');
  const emptyItem = {
    productId: '', quantity: '', rate: '', dealerCommission: '', sellingPrice: '', discount: '0', mrp: '',
    manufacturingDate: '', expiryDate: '', batchName: ''
  };
  const [items, setItems] = useState([{ ...emptyItem }]);

  async function load() {
    const calls = [api.get('/purchases'), api.get('/products')];
    if (user.role === 'DEALER') calls.push(api.get('/suppliers'));
    if (user.role === 'RETAILER') calls.push(api.get(`/retailers/${user.retailerId}`));

    const results = await Promise.all(calls);
    setPurchases(results[0].data);
    setProducts(results[1].data);
    if (user.role === 'DEALER') setSuppliers(results[2].data);
    if (user.role === 'RETAILER') setMyDealer(results[2].data.dealer);
  }
  useEffect(() => { load(); }, []);

  function updateItem(i, key, val) {
    const copy = [...items];
    copy[i][key] = val;

    // Sell Price = Cost Price + (Dealer Commission % * Cost Price) / 100,
    // rounded to 1 digit after the decimal. It's derived, so it's recalculated
    // whenever Cost Price or Dealer Commission changes, and the field itself
    // is never directly editable.
    if (key === 'rate' || key === 'dealerCommission') {
      const costPrice = parseFloat(copy[i].rate);
      const commission = parseFloat(copy[i].dealerCommission);
      copy[i].sellingPrice = (!isNaN(costPrice) && !isNaN(commission))
        ? (costPrice + (commission * costPrice) / 100).toFixed(1)
        : '';
    }

    setItems(copy);
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    // Sell Price is a disabled field, so the browser won't natively validate it —
    // check it here since it only gets computed once Cost Price and Dealer
    // Commission are both filled in.
    if (items.some((it) => !it.sellingPrice)) {
      setError('Enter Cost Price and Dealer Commission for every item so Sell Price can be calculated / प्रत्येक वस्तूसाठी क्रय किंमत आणि डीलर कमिशन भरा जेणेकरून विक्री किंमत आपोआप मोजली जाईल');
      return;
    }
    // Retailers always buy from their own primary dealer — the backend derives this
    // server-side, so nothing source-related needs to be sent for them.
    const payload = user.role === 'DEALER' ? { supplierId, items } : { items };
    try {
      await api.post('/purchases', payload);
      setSupplierId('');
      setItems([{ ...emptyItem }]);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record purchase / खरेदी नोंदवण्यात अयशस्वी');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Purchases / Stock Inwards</h1>
      <p className="text-sm text-orange-700 mb-4">खरेदी / साठा आवक</p>

      <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 space-y-3">
        {user.role === 'DEALER' && (
          <>
            <FieldLabel en="Supplier / Manufacturer" mr="पुरवठादार / उत्पादक" />
            <select className="border rounded px-2 py-1 w-full md:w-1/2" required
              value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Supplier / Manufacturer... / पुरवठादार / उत्पादक निवडा...</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {suppliers.length === 0 && (
              <p className="text-xs text-amber-600">
                No suppliers yet — ask an admin to add one under Suppliers.
                <span className="block">अद्याप कोणताही पुरवठादार नाही — प्रशासकाला 'पुरवठादार' विभागात एक जोडण्यास सांगा.</span>
              </p>
            )}
          </>
        )}

        {user.role === 'RETAILER' && (
          <>
            <FieldLabel en="Your Dealer" mr="तुमचा डीलर" />
            <select className="border rounded px-2 py-1 w-full md:w-1/2 bg-gray-100 text-gray-700" disabled
              value={myDealer?.id || ''}>
              <option value={myDealer?.id || ''}>{myDealer ? myDealer.name : 'Loading your dealer... / तुमचा डीलर लोड होत आहे...'}</option>
            </select>
            <p className="text-xs text-gray-400">
              Retailers can only purchase from their own dealer.
              <span className="block">किरकोळ विक्रेते फक्त त्यांच्या स्वतःच्या डीलरकडूनच खरेदी करू शकतात.</span>
            </p>
          </>
        )}

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

        {items.map((it, i) => (
          <div key={i} className="border rounded p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="flex flex-col gap-1">
                <FieldLabel en="Product" mr="उत्पादन" />
                <select className="border rounded px-2 py-1" required
                  value={it.productId} onChange={(e) => updateItem(i, 'productId', e.target.value)}>
                  <option value="">Product... / उत्पादन निवडा...</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sizeWeight})</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel en="Quantity" mr="प्रमाण" />
                <input type="number" placeholder="Quantity / प्रमाण" className="border rounded px-2 py-1" required
                  value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel en="Batch Name" mr="बॅच नाव" />
                <input placeholder="Batch Name / बॅच नाव" className="border rounded px-2 py-1" required
                  value={it.batchName} onChange={(e) => updateItem(i, 'batchName', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="flex flex-col gap-1">
                <FieldLabel en="Cost Price" mr="क्रय किंमत" />
                <input type="number" step="0.01" placeholder="Cost Price" className="border rounded px-2 py-1" required
                  value={it.rate} onChange={(e) => updateItem(i, 'rate', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel en="Dealer Commission (%)" mr="डीलर कमिशन (%)" />
                <input type="number" step="0.01" placeholder="Dealer Commission (%)" className="border rounded px-2 py-1" required
                  value={it.dealerCommission} onChange={(e) => updateItem(i, 'dealerCommission', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel en="Sell Price" mr="विक्री किंमत" />
                <input type="number" placeholder="Sell Price" className="border rounded px-2 py-1 bg-gray-100 text-gray-700" disabled required
                  value={it.sellingPrice} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel en="MRP" mr="कमाल किरकोळ किंमत (एमआरपी)" />
                <input type="number" step="0.01" placeholder="MRP" className="border rounded px-2 py-1" required
                  value={it.mrp} onChange={(e) => updateItem(i, 'mrp', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel en="Product Discount" mr="उत्पादन सवलत" />
                <input type="number" step="0.01" placeholder="Product Discount" className="border rounded px-2 py-1"
                  value={it.discount} onChange={(e) => updateItem(i, 'discount', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <FieldLabel en="Manufacturing Date" mr="उत्पादन तारीख" />
                <input type="date" className="border rounded px-2 py-1" required
                  value={it.manufacturingDate} onChange={(e) => updateItem(i, 'manufacturingDate', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel en="Expiry Date" mr="कालबाह्यता तारीख" />
                <input type="date" className="border rounded px-2 py-1" required
                  value={it.expiryDate} onChange={(e) => updateItem(i, 'expiryDate', e.target.value)} />
              </div>
            </div>
          </div>
        ))}
        <button type="button" className="text-emerald-700 text-sm"
          onClick={() => setItems([...items, { ...emptyItem }])}>
          + Add another item / आणखी एक वस्तू जोडा
        </button>
        <div>
          <button className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
            Record Purchase / खरेदी नोंदवा
          </button>
        </div>
      </form>

      <div className="grid gap-3">
        {purchases.map((p) => (
          <div key={p.id} className="bg-white p-4 rounded shadow">
            <div className="font-semibold">{p.supplier?.name || p.sourceDealer?.name} <span className="text-xs text-gray-400">{new Date(p.date).toLocaleString()}</span></div>
            <ul className="text-sm text-gray-600 mt-1">
              {p.items.map((it) => (
                <li key={it.id}>
                  {it.product?.name} — qty {it.quantity} @ cost ₹{it.rate}, commission {it.dealerCommission}%, sell ₹{it.sellingPrice}, discount ₹{it.discount} (batch {it.batchName}, MRP ₹{it.mrp}, exp {new Date(it.expiryDate).toLocaleDateString()})
                </li>
              ))}
            </ul>
          </div>
        ))}
        {purchases.length === 0 && (
          <p className="text-gray-400">
            No purchases recorded yet.
            <span className="block text-xs">अद्याप कोणतीही खरेदी नोंदवलेली नाही.</span>
          </p>
        )}
      </div>
    </div>
  );
}
