import { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Sales() {
  const { user } = useAuth();
  const [sales, setSales] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [availableItems, setAvailableItems] = useState([]); // batches from /sales/available-items
  const [cart, setCart] = useState([]); // { inventoryId, product, batchName, mrp, sellingPrice, retailerSellingPrice, quantity, available }
  const [barcodeInput, setBarcodeInput] = useState('');
  const [customerType, setCustomerType] = useState('CASH');
  const [customerRetailerId, setCustomerRetailerId] = useState('');
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [scanError, setScanError] = useState('');
  const [pendingBatches, setPendingBatches] = useState(null); // batches to choose from when a scan matches >1
  const [submitting, setSubmitting] = useState(false);
  const scanRef = useRef(null);

  async function load() {
    const [s, inv] = await Promise.all([api.get('/sales'), api.get('/sales/available-items')]);
    setSales(s.data);
    setAvailableItems(inv.data);
    if (user.role === 'DEALER') {
      const r = await api.get('/retailers');
      setRetailers(r.data);
    }
  }
  useEffect(() => { load(); scanRef.current?.focus(); }, []);

  // Dealers selling to a walk-in (CASH) customer, and retailers selling to
  // their end customer, both sell at retailerSellingPrice. A dealer selling
  // on to a retailer sells at sellingPrice (wholesale). This mirrors the
  // backend's price resolution exactly (see sales.js createSale) — it's
  // display-only here, the actual charge is always resolved server-side
  // from the chosen batch.
  function unitPrice(item) {
    if (user.role === 'RETAILER') return Number(item.retailerSellingPrice);
    return Number(customerType === 'RETAILER' ? item.sellingPrice : item.retailerSellingPrice);
  }

  function addToCart(inv, qty = 1) {
    setCart((prev) => {
      const existing = prev.find((c) => c.inventoryId === inv.id);
      if (existing) {
        const nextQty = Math.min(existing.quantity + qty, inv.quantity);
        return prev.map((c) => c.inventoryId === inv.id ? { ...c, quantity: nextQty } : c);
      }
      return [...prev, {
        inventoryId: inv.id,
        product: inv.product,
        batchName: inv.batchName,
        mrp: inv.mrp,
        sellingPrice: inv.sellingPrice,
        retailerSellingPrice: inv.retailerSellingPrice,
        available: inv.quantity,
        quantity: Math.min(qty, inv.quantity),
      }];
    });
  }

  // Handles both a hardware barcode-reader (acts like fast keyboard input + Enter)
  // and manual typing of a barcode followed by Enter. Batches are matched
  // locally against the already-fetched available-items list (in-stock
  // batches only), rather than a separate product lookup — this is also
  // where multi-batch products get caught and routed to the batch picker
  // instead of being added straight to the cart.
  function handleScan(e) {
    if (e.key !== 'Enter') return;
    const code = barcodeInput.trim();
    setBarcodeInput('');
    if (!code) return;
    setScanError('');

    const matches = availableItems.filter((inv) => inv.product?.barcode === code);
    if (matches.length === 0) {
      setScanError(`No in-stock product found for barcode ${code}`);
      return;
    }
    if (matches.length === 1) {
      addToCart(matches[0]);
      return;
    }
    // Multiple batches in stock for this product — require an explicit
    // choice, no default pre-selected.
    setPendingBatches(matches);
  }

  function chooseBatch(inv) {
    addToCart(inv);
    setPendingBatches(null);
    scanRef.current?.focus();
  }

  function cancelBatchChoice() {
    setPendingBatches(null);
    scanRef.current?.focus();
  }

  function updateQty(inventoryId, qty) {
    setCart(cart.map((c) => {
      if (c.inventoryId !== inventoryId) return c;
      const clamped = Math.max(1, Math.min(Number(qty) || 1, c.available));
      return { ...c, quantity: clamped };
    }));
  }

  function removeItem(inventoryId) {
    setCart(cart.filter((c) => c.inventoryId !== inventoryId));
  }

  const total = cart.reduce((s, c) => s + unitPrice(c) * c.quantity, 0);

  async function printBill(saleId) {
    try {
      const res = await api.get(`/sales/${saleId}/bill`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(blobUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    } catch (err) {
      console.error('Failed to load bill:', err);
      alert('Sale was completed, but the bill could not be loaded. You can open it later from Recent Sales.');
    }
  }

  async function checkout() {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const items = cart.map((c) => ({ inventoryId: c.inventoryId, quantity: c.quantity }));
      const { data: sale } = await api.post('/sales', {
        customerType,
        customerRetailerId: customerType === 'RETAILER' ? customerRetailerId : undefined,
        paymentMode,
        items,
      });
      setCart([]);
      await load();
      scanRef.current?.focus();
      await printBill(sale.id);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to complete sale');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2">
        <h1 className="text-2xl font-semibold mb-4">Sales / POS <span className="text-gray-400 font-normal">/ विक्री / पॉस</span></h1>

        {user.role === 'DEALER' && (
          <div className="bg-white p-4 rounded shadow mb-4 flex items-center gap-4">
            <span className="text-sm font-medium">Customer <span className="text-gray-400">/ ग्राहक</span>:</span>
            <label className="flex items-center gap-1 text-sm">
              <input type="radio" checked={customerType === 'CASH'} onChange={() => setCustomerType('CASH')} />
              Cash customer <span className="text-gray-400">/ रोख ग्राहक</span>
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="radio" checked={customerType === 'RETAILER'} onChange={() => setCustomerType('RETAILER')} />
              Retailer <span className="text-gray-400">/ किरकोळ विक्रेता</span>
            </label>
            {customerType === 'RETAILER' && (
              <select className="border rounded px-2 py-1 text-sm" value={customerRetailerId}
                onChange={(e) => setCustomerRetailerId(e.target.value)}>
                <option value="">Select retailer... / किरकोळ विक्रेता निवडा...</option>
                {retailers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
          </div>
        )}

        <div className="bg-white p-4 rounded shadow mb-4">
          <label className="text-xs text-gray-500">Scan or type barcode, then press Enter <span className="text-gray-400">/ बारकोड स्कॅन करा किंवा टाइप करा, नंतर एंटर दाबा</span></label>
          <input
            ref={scanRef}
            className="border rounded px-3 py-2 w-full text-lg"
            placeholder="Scan barcode here..."
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={handleScan}
          />
          {scanError && <p className="text-red-600 text-sm mt-1">{scanError}</p>}

          {pendingBatches && (
            <div className="mt-3 border rounded p-3 bg-amber-50">
              <p className="text-sm font-medium mb-2">
                Multiple batches available for {pendingBatches[0].product?.name} — choose one
                <span className="text-gray-500"> / एकापेक्षा जास्त बॅच उपलब्ध आहेत — एक निवडा</span>:
              </p>
              <table className="w-full text-sm mb-2">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="p-1">Batch / बॅच</th>
                    <th className="p-1">Expiry / एक्सपायरी</th>
                    <th className="p-1">In Stock / साठा</th>
                    <th className="p-1">Price / किंमत</th>
                    <th className="p-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingBatches.map((inv) => (
                    <tr key={inv.id} className="border-t">
                      <td className="p-1">{inv.batchName || '-'}</td>
                      <td className="p-1">{inv.expiryDate ? new Date(inv.expiryDate).toLocaleDateString() : '-'}</td>
                      <td className="p-1">{inv.quantity}</td>
                      <td className="p-1">₹{unitPrice(inv).toFixed(2)}</td>
                      <td className="p-1">
                        <button className="text-emerald-700 font-medium text-xs" onClick={() => chooseBatch(inv)}>Add</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="text-xs text-gray-500" onClick={cancelBatchChoice}>Cancel / रद्द करा</button>
            </div>
          )}
        </div>

        <div className="bg-white rounded shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-2">Product <span className="text-gray-400 font-normal">/ उत्पादन</span></th>
                <th className="text-left p-2">Batch <span className="text-gray-400 font-normal">/ बॅच</span></th>
                <th className="text-left p-2">Price <span className="text-gray-400 font-normal">/ किंमत</span></th>
                <th className="text-left p-2">Qty <span className="text-gray-400 font-normal">/ प्रमाण</span></th>
                <th className="text-left p-2">Line Total <span className="text-gray-400 font-normal">/ एकूण</span></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((c) => {
                const price = unitPrice(c);
                const mrp = c.mrp != null ? Number(c.mrp) : null;
                return (
                  <tr key={c.inventoryId} className="border-t">
                    <td className="p-2">{c.product.name} ({c.product.sizeWeight})</td>
                    <td className="p-2">{c.batchName || '-'}</td>
                    <td className="p-2">
                      ₹{price.toFixed(2)}
                      {mrp != null && mrp > price && (
                        <span className="text-gray-400 line-through ml-1 text-xs">₹{mrp.toFixed(2)}</span>
                      )}
                    </td>
                    <td className="p-2">
                      <input type="number" min="1" max={c.available} className="border rounded w-16 px-1"
                        value={c.quantity} onChange={(e) => updateQty(c.inventoryId, e.target.value)} />
                    </td>
                    <td className="p-2">₹{(price * c.quantity).toFixed(2)}</td>
                    <td className="p-2">
                      <button className="text-red-600 text-xs" onClick={() => removeItem(c.inventoryId)}>Remove / काढा</button>
                    </td>
                  </tr>
                );
              })}
              {cart.length === 0 && (
                <tr><td className="p-3 text-gray-400" colSpan={6}>
                  Cart is empty. Scan a product barcode to begin.
                  <span className="block text-xs">कार्ट रिकामी आहे. सुरू करण्यासाठी उत्पादनाचा बारकोड स्कॅन करा.</span>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="bg-white p-4 rounded shadow sticky top-4">
          <h2 className="font-semibold mb-3">Checkout <span className="text-gray-400 font-normal">/ चेकआउट</span></h2>
          <div className="text-3xl font-bold mb-4">₹{total.toFixed(2)}</div>

          <label className="text-xs text-gray-500">Payment mode <span className="text-gray-400">/ पैसे भरण्याची पद्धत</span></label>
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
            disabled={cart.length === 0 || submitting || (customerType === 'RETAILER' && !customerRetailerId)}
            onClick={checkout}
            className="w-full bg-emerald-700 text-white py-3 rounded font-semibold hover:bg-emerald-800 disabled:opacity-40">
            {submitting ? 'Processing... / प्रक्रिया सुरू आहे...' : (
              <>Complete Sale &amp; Print Bill <span className="block text-xs font-normal opacity-90">विक्री पूर्ण करा आणि बिल छापा</span></>
            )}
          </button>

          <p className="text-xs text-gray-400 mt-3">
            Tip: a card/UPI POS terminal can push a completed, paid transaction straight
            into this module via <code>POST /api/sales/pos-webhook</code>.
          </p>
        </div>

        <div className="mt-4">
          <h2 className="text-lg font-semibold mb-2">Recent Sales <span className="text-gray-400 font-normal">/ अलीकडील विक्री</span></h2>
          <div className="bg-white rounded shadow overflow-x-auto lg:max-h-[calc(100vh-24rem)] lg:overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Date <span className="text-gray-400 font-normal">/ दिनांक</span></th>
                  <th className="text-left p-2">Customer <span className="text-gray-400 font-normal">/ ग्राहक</span></th>
                  <th className="text-left p-2">Payment <span className="text-gray-400 font-normal">/ पैसे भरणे</span></th>
                  <th className="text-left p-2">Total <span className="text-gray-400 font-normal">/ एकूण</span></th>
                  <th></th>
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
                    <td className="p-2">
                      <button className="text-emerald-700 text-xs" onClick={() => printBill(s.id)}>Print / छापा</button>
                    </td>
                  </tr>
                ))}
                {sales.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={6}>No sales yet. / अद्याप विक्री नाही.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
