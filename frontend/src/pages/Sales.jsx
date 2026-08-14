import { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Sales() {
  const { user } = useAuth();
  const [sales, setSales] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [cart, setCart] = useState([]); // { product, quantity }
  const [barcodeInput, setBarcodeInput] = useState('');
  const [customerType, setCustomerType] = useState('CASH');
  const [customerRetailerId, setCustomerRetailerId] = useState('');
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [scanError, setScanError] = useState('');
  const scanRef = useRef(null);

  async function load() {
    const s = await api.get('/sales');
    setSales(s.data);
    if (user.role === 'DEALER') {
      const r = await api.get('/retailers');
      setRetailers(r.data);
    }
  }
  useEffect(() => { load(); scanRef.current?.focus(); }, []);

  // Handles both a hardware barcode-reader (acts like fast keyboard input + Enter)
  // and manual typing of a barcode followed by Enter.
  async function handleScan(e) {
    if (e.key !== 'Enter') return;
    const code = barcodeInput.trim();
    setBarcodeInput('');
    if (!code) return;
    setScanError('');
    try {
      const { data: product } = await api.get(`/products/lookup/${code}`);
      setCart((prev) => {
        const existing = prev.find((c) => c.product.id === product.id);
        if (existing) {
          return prev.map((c) => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c);
        }
        return [...prev, { product, quantity: 1 }];
      });
    } catch (err) {
      setScanError(err.response?.data?.error || `No product found for barcode ${code}`);
    }
  }

  // Dealers sell at their own computed Sell Price; retailers sell to their
  // end customers at the Retailer Selling Price (MRP net of the product's
  // discount %). Both are carried directly on the product record returned by
  // the barcode lookup.
  function unitPrice(product) {
    return Number(user.role === 'RETAILER' ? product.retailerSellingPrice : product.sellingPrice);
  }

  function updateQty(productId, qty) {
    setCart(cart.map((c) => c.product.id === productId ? { ...c, quantity: Number(qty) } : c));
  }

  function removeItem(productId) {
    setCart(cart.filter((c) => c.product.id !== productId));
  }

  const total = cart.reduce((s, c) => s + unitPrice(c.product) * c.quantity, 0);

  async function checkout() {
    if (cart.length === 0) return;
    const items = cart.map((c) => ({
      productId: c.product.id, quantity: c.quantity,
      price: unitPrice(c.product), discount: 0
    }));
    await api.post('/sales', {
      customerType, customerRetailerId: customerType === 'RETAILER' ? customerRetailerId : undefined,
      paymentMode, items
    });
    setCart([]);
    load();
    scanRef.current?.focus();
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2">
        <h1 className="text-2xl font-semibold mb-4">Sales / POS</h1>

        {user.role === 'DEALER' && (
          <div className="bg-white p-4 rounded shadow mb-4 flex items-center gap-4">
            <span className="text-sm font-medium">Customer:</span>
            <label className="flex items-center gap-1 text-sm">
              <input type="radio" checked={customerType === 'CASH'} onChange={() => setCustomerType('CASH')} /> Cash customer
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="radio" checked={customerType === 'RETAILER'} onChange={() => setCustomerType('RETAILER')} /> Retailer
            </label>
            {customerType === 'RETAILER' && (
              <select className="border rounded px-2 py-1 text-sm" value={customerRetailerId}
                onChange={(e) => setCustomerRetailerId(e.target.value)}>
                <option value="">Select retailer...</option>
                {retailers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
          </div>
        )}

        <div className="bg-white p-4 rounded shadow mb-4">
          <label className="text-xs text-gray-500">Scan or type barcode, then press Enter</label>
          <input
            ref={scanRef}
            className="border rounded px-3 py-2 w-full text-lg"
            placeholder="Scan barcode here..."
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={handleScan}
          />
          {scanError && <p className="text-red-600 text-sm mt-1">{scanError}</p>}
        </div>

        <div className="bg-white rounded shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-2">Product</th>
                <th className="text-left p-2">Price</th>
                <th className="text-left p-2">Qty</th>
                <th className="text-left p-2">Line Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((c) => (
                <tr key={c.product.id} className="border-t">
                  <td className="p-2">{c.product.name} ({c.product.sizeWeight})</td>
                  <td className="p-2">₹{unitPrice(c.product)}</td>
                  <td className="p-2">
                    <input type="number" min="1" className="border rounded w-16 px-1"
                      value={c.quantity} onChange={(e) => updateQty(c.product.id, e.target.value)} />
                  </td>
                  <td className="p-2">₹{(unitPrice(c.product) * c.quantity).toFixed(2)}</td>
                  <td className="p-2">
                    <button className="text-red-600 text-xs" onClick={() => removeItem(c.product.id)}>Remove</button>
                  </td>
                </tr>
              ))}
              {cart.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={5}>Cart is empty. Scan a product barcode to begin.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="bg-white p-4 rounded shadow sticky top-4">
          <h2 className="font-semibold mb-3">Checkout</h2>
          <div className="text-3xl font-bold mb-4">₹{total.toFixed(2)}</div>

          <label className="text-xs text-gray-500">Payment mode</label>
          <div className="flex gap-2 mb-4">
            {['CASH', 'UPI', 'CARD'].map((m) => (
              <button key={m}
                className={`flex-1 py-2 rounded text-sm border ${paymentMode === m ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white'}`}
                onClick={() => setPaymentMode(m)}>
                {m}
              </button>
            ))}
          </div>

          <button
            disabled={cart.length === 0 || (customerType === 'RETAILER' && !customerRetailerId)}
            onClick={checkout}
            className="w-full bg-emerald-700 text-white py-3 rounded font-semibold hover:bg-emerald-800 disabled:opacity-40">
            Complete Sale &amp; Print Bill
          </button>

          <p className="text-xs text-gray-400 mt-3">
            Tip: a card/UPI POS terminal can push a completed, paid transaction straight
            into this module via <code>POST /api/sales/pos-webhook</code>.
          </p>
        </div>

        <div className="mt-4">
          <h2 className="text-lg font-semibold mb-2">Recent Sales</h2>
          <div className="bg-white rounded shadow overflow-x-auto lg:max-h-[calc(100vh-24rem)] lg:overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">Customer</th>
                  <th className="text-left p-2">Payment</th>
                  <th className="text-left p-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="p-2">{s.id}</td>
                    <td className="p-2">{new Date(s.date).toLocaleString()}</td>
                    <td className="p-2">{s.customerType}{s.posTransactionRef ? ` · ${s.posTransactionRef}` : ''}</td>
                    <td className="p-2">{s.paymentMode}</td>
                    <td className="p-2">₹{Number(s.totalAmount).toFixed(2)}</td>
                  </tr>
                ))}
                {sales.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={5}>No sales yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
