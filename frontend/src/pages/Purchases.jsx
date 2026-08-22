import { useEffect, useState } from 'react';
import api from '../api.js';
import { printBarcodeLabelsBatch } from '../components/Barcode.jsx';
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

// Formats a date (Date object, ISO string, or yyyy-mm[-dd]) as mm-yyyy for
// display, regardless of the browser/OS locale.
function formatMMYYYY(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${mm}-${yyyy}`;
}

// Converts a stored date (ISO string, etc.) into the yyyy-mm value an
// <input type="month"> expects, for loading a purchase back into the form.
function toMonthInputValue(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}`;
}

// Sell Price = Cost Price + (Dealer Commission % * Cost Price) / 100, rounded
// to 1 digit. Computed fresh from the item's own rate/commission every time,
// rather than stored, so it can never go stale.
function computeSellingPrice(it) {
  const costPrice = parseFloat(it.rate);
  const commission = parseFloat(it.dealerCommission);
  return (!isNaN(costPrice) && !isNaN(commission))
    ? (costPrice + (commission * costPrice) / 100).toFixed(1)
    : '';
}

// Retailer Selling Price = MRP - (Product Discount % * MRP) / 100, rounded to
// 2 digits. Computed fresh from the item's own mrp/discount every time.
function computeRetailerPrice(it) {
  const mrp = parseFloat(it.mrp);
  const discountPct = parseFloat(it.discount);
  return (!isNaN(mrp) && !isNaN(discountPct))
    ? (mrp - (discountPct * mrp) / 100).toFixed(2)
    : '';
}

// Summary for a recorded purchase's item table: item count, total quantity,
// and total amount. The price used for the total depends on who's looking
// at it, not the purchase itself — a DEALER's total is their own cost
// (rate, from the supplier); a RETAILER's total is THEIR cost (sellingPrice
// on the PurchaseItem, which is the dealer's wholesale price to them — see
// purchases.js/sales.js comments on PurchaseItem.sellingPrice). For a
// RETAILER, that field stays null until the dealer actually dispatches the
// order (a retailer only ever submits productId+quantity up front), so the
// total is reported as incomplete/pending until every line has it.
function purchaseTotals(purchase, role) {
  const items = purchase?.items || [];
  const priceKey = role === 'DEALER' ? 'rate' : 'sellingPrice';
  const itemCount = items.length;
  const totalQuantity = items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
  const totalAmount = items.reduce((sum, it) => {
    const price = it[priceKey];
    return sum + (price != null ? Number(price) * Number(it.quantity || 0) : 0);
  }, 0);
  const isComplete = itemCount > 0 && items.every((it) => it[priceKey] != null);
  return { itemCount, totalQuantity, totalAmount, isComplete };
}

export default function Purchases() {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [myDealer, setMyDealer] = useState(null);
  const [supplierId, setSupplierId] = useState('');
  const [error, setError] = useState('');
  const [editingPurchaseId, setEditingPurchaseId] = useState(null);
  const emptyItem = {
    productId: '', quantity: '', rate: '', dealerCommission: '', discount: '0', mrp: '',
    manufacturingDate: '', expiryDate: '', batchName: ''
  };
  const [items, setItems] = useState([{ ...emptyItem }]);

  // Purchase lookup: pick a purchase by ID and edit its quantities inline
  // while it's still PENDING or IN_REVIEW (before inventory is credited).
  const [selectedPurchaseId, setSelectedPurchaseId] = useState('');
  const [quantityEdits, setQuantityEdits] = useState({});
  const [quantityError, setQuantityError] = useState('');
  const [savingQuantities, setSavingQuantities] = useState(false);

  // DEALER-only: correct Cost Price / Dealer Commission / MRP / Discount on
  // an already-CONFIRMED purchase (a mistake caught after inventory's
  // already been credited and the voucher already raised — see
  // purchases.js PATCH /:id/prices, which also cascades the correction
  // into any retailer sale already fulfilled from the same batch).
  // sellingPrice/retailerSellingPrice are shown recalculated live from
  // these edits, same formulas as the create form, but the server always
  // recomputes them itself rather than trusting what's submitted.
  const [editingPrices, setEditingPrices] = useState(false);
  const [priceEdits, setPriceEdits] = useState({});
  const [priceError, setPriceError] = useState('');
  const [savingPrices, setSavingPrices] = useState(false);
  const [priceSuccessMessage, setPriceSuccessMessage] = useState('');

  // Set right after a dealer confirms a purchase (and reopenable from a
  // confirmed purchase's card) to ask how many labels to print per item,
  // then print them with that batch's MRP / retailer selling price.
  const [printPrompt, setPrintPrompt] = useState(null); // { purchase, quantities: { [itemId]: string } }

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

  // Default the lookup dropdown to the most recent purchase, and keep it
  // pointed at a valid purchase if the list changes.
  useEffect(() => {
    if (purchases.length && !purchases.some((p) => String(p.id) === selectedPurchaseId)) {
      setSelectedPurchaseId(String(purchases[0].id));
    }
  }, [purchases]);

  const selectedPurchase = purchases.find((p) => String(p.id) === selectedPurchaseId);
  const isSelectedEditable = !!selectedPurchase &&
    (!selectedPurchase.status || selectedPurchase.status === 'PENDING' || selectedPurchase.status === 'IN_REVIEW');

  // Reset the quantity inputs to match the newly selected purchase. Only
  // re-runs when the selected ID changes (not on every background reload),
  // so it doesn't clobber quantities the user is mid-edit on.
  useEffect(() => {
    if (!selectedPurchase) { setQuantityEdits({}); return; }
    const edits = {};
    selectedPurchase.items.forEach((it) => { edits[it.id] = String(it.quantity); });
    setQuantityEdits(edits);
    setQuantityError('');
    setEditingPrices(false);
    setPriceEdits({});
    setPriceError('');
    setPriceSuccessMessage('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPurchaseId]);

  function startEditPrices() {
    if (!selectedPurchase) return;
    const edits = {};
    selectedPurchase.items.forEach((it) => {
      edits[it.id] = {
        rate: it.rate != null ? String(it.rate) : '',
        dealerCommission: it.dealerCommission != null ? String(it.dealerCommission) : '',
        mrp: it.mrp != null ? String(it.mrp) : '',
        discount: it.discount != null ? String(it.discount) : '0',
      };
    });
    setPriceEdits(edits);
    setPriceError('');
    setPriceSuccessMessage('');
    setEditingPrices(true);
  }

  function updatePriceEdit(itemId, key, val) {
    setPriceEdits((prev) => ({ ...prev, [itemId]: { ...prev[itemId], [key]: val } }));
  }

  function cancelEditPrices() {
    setEditingPrices(false);
    setPriceEdits({});
    setPriceError('');
  }

  async function savePrices() {
    if (!selectedPurchase) return;
    setPriceError('');
    const payloadItems = selectedPurchase.items.map((it) => ({
      id: it.id,
      rate: priceEdits[it.id]?.rate,
      dealerCommission: priceEdits[it.id]?.dealerCommission,
      mrp: priceEdits[it.id]?.mrp,
      discount: priceEdits[it.id]?.discount,
    }));
    if (payloadItems.some((it) => it.rate === '' || it.dealerCommission === '' || it.mrp === '' || it.discount === '')) {
      setPriceError('Cost Price, Dealer Commission, MRP, and Discount % are required for every item / प्रत्येक वस्तूसाठी क्रय किंमत, डीलर कमिशन, एमआरपी आणि सवलत % आवश्यक आहे');
      return;
    }
    setSavingPrices(true);
    try {
      const { data } = await api.patch(`/purchases/${selectedPurchase.id}/prices`, { items: payloadItems });
      await load();
      setEditingPrices(false);
      setPriceEdits({});
      setPriceSuccessMessage(
        data.affectedSaleCount > 0
          ? `Prices updated — also corrected ${data.affectedSaleCount} downstream retailer sale(s) and their voucher(s). / किंमती अद्ययावत केल्या — ${data.affectedSaleCount} किरकोळ विक्रेत्यांच्या विक्री आणि व्हाउचरमध्येही दुरुस्ती केली.`
          : 'Prices updated. / किंमती अद्ययावत केल्या.'
      );
    } catch (err) {
      setPriceError(err.response?.data?.error || 'Failed to update pricing / किंमत अद्ययावत करण्यात अयशस्वी');
    } finally {
      setSavingPrices(false);
    }
  }

  async function printPurchaseOrder(purchaseId) {
    try {
      const res = await api.get(`/purchases/${purchaseId}/bill`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(blobUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    } catch (err) {
      console.error('Failed to load purchase order:', err);
      alert('Could not load the purchase order PDF.');
    }
  }

  async function saveQuantities() {
    if (!selectedPurchase) return;
    setQuantityError('');
    const payloadItems = selectedPurchase.items.map((it) => ({
      id: it.id,
      quantity: Number(quantityEdits[it.id]),
    }));
    if (payloadItems.some((it) => !it.quantity || isNaN(it.quantity) || it.quantity <= 0)) {
      setQuantityError('Quantity must be a number greater than zero for every item / प्रत्येक वस्तूसाठी प्रमाण शून्यापेक्षा जास्त संख्या असावी');
      return;
    }
    setSavingQuantities(true);
    try {
      await api.patch(`/purchases/${selectedPurchase.id}/quantities`, { items: payloadItems });
      await load();
    } catch (err) {
      setQuantityError(err.response?.data?.error || 'Failed to update quantity / प्रमाण अद्ययावत करण्यात अयशस्वी');
    } finally {
      setSavingQuantities(false);
    }
  }

  function updateSupplier(val) {
    setSupplierId(val);
    // Previously chosen products may not belong to the new supplier, so clear them.
    setItems(items.map((it) => ({ ...it, productId: '' })));
  }

  function updateItem(i, key, val) {
    setItems(items.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));
  }

  function removeItemRow(i) {
    setItems(items.length > 1 ? items.filter((_, idx) => idx !== i) : [{ ...emptyItem }]);
  }

  // Sets the current entry aside (it now only shows, read-only-as-a-card, in
  // the preview table below — still editable there) and opens a fresh blank
  // card for the next product. No-ops if the current card has no product
  // picked yet, so you can't stack empty drafts.
  function addAnotherItem() {
    const current = items[items.length - 1];
    if (!current.productId) return;
    setItems([...items, { ...emptyItem }]);
  }

  // Loads an IN_REVIEW purchase's items into the entry form so they can be
  // corrected or added to, then saved back with PUT instead of POST.
  function startEditPurchase(p) {
    setEditingPurchaseId(p.id);
    setError('');
    if (user.role === 'DEALER') {
      setSupplierId(p.supplierId ? String(p.supplierId) : '');
      setItems(p.items.map((it) => ({
        productId: String(it.productId),
        quantity: String(it.quantity),
        rate: String(it.rate),
        dealerCommission: String(it.dealerCommission),
        discount: String(it.discount),
        mrp: String(it.mrp),
        manufacturingDate: toMonthInputValue(it.manufacturingDate),
        expiryDate: toMonthInputValue(it.expiryDate),
        batchName: it.batchName || '',
      })));
    } else {
      // Retailer items only ever carry productId + quantity — the rest of
      // emptyItem's shape stays blank since the form doesn't collect it.
      setItems(p.items.map((it) => ({ ...emptyItem, productId: String(it.productId), quantity: String(it.quantity) })));
    }
  }

  function cancelEditPurchase() {
    setEditingPurchaseId(null);
    setSupplierId('');
    setItems([{ ...emptyItem }]);
    setError('');
  }

  // Purchase status workflow: PENDING -> (Mark for Review) -> IN_REVIEW ->
  // (Confirm Purchase for a dealer / Received for a retailer) -> CONFIRMED or RECEIVED.
  async function markForReview(purchaseId) {
    await api.patch(`/purchases/${purchaseId}/status`, { status: 'IN_REVIEW' });
    load();
  }

  // For a DEALER, IN_REVIEW always moves to CONFIRMED. For a RETAILER,
  // IN_REVIEW moves to ORDERED (placing the order with their dealer — see
  // purchases.js, this is also what creates the mirror Sale on the
  // dealer's side); IN_TRANSIT (after the dealer dispatches it) moves to
  // RECEIVED.
  async function completePurchase(purchaseId, currentStatus) {
    const nextStatus = user.role === 'DEALER'
      ? 'CONFIRMED'
      : (currentStatus === 'IN_TRANSIT' ? 'RECEIVED' : 'ORDERED');
    const { data } = await api.patch(`/purchases/${purchaseId}/status`, { status: nextStatus });
    load();
    // Only a dealer's own CONFIRMED purchase is a stock-inwards event worth
    // labeling — a retailer receiving stock doesn't print product barcodes.
    if (user.role === 'DEALER' && nextStatus === 'CONFIRMED') {
      openPrintPrompt(data);
    }
  }

  // Opens the print-quantity prompt for a CONFIRMED purchase, defaulting
  // each item's label count to the quantity purchased. Also reachable later
  // from that purchase's card, to reprint without reconfirming — this is the
  // only place in the app barcode labels are printed from, since Product
  // itself carries no MRP/price (only a purchase batch does).
  function openPrintPrompt(purchase) {
    setPrintPrompt({
      purchase,
      quantities: Object.fromEntries(purchase.items.map((it) => [it.id, String(it.quantity)])),
    });
  }

  function updatePrintQty(itemId, val) {
    setPrintPrompt((pp) => (pp ? { ...pp, quantities: { ...pp.quantities, [itemId]: val } } : pp));
  }

  function submitPrintPrompt() {
    printBarcodeLabelsBatch(
      printPrompt.purchase.items.map((it) => ({
        name: it.product?.name,
        sizeWeight: it.product?.sizeWeight,
        flavour: it.product?.flavour,
        brand: it.product?.brand,
        barcode: it.product?.barcode,
        quantity: Number(printPrompt.quantities[it.id]) || 1,
        mrp: it.mrp,
        retailerSellingPrice: it.retailerSellingPrice,
      })),
      `Print Barcodes - Purchase #${printPrompt.purchase.id}`
    );
    setPrintPrompt(null);
  }

  function statusAction(p) {
    const status = p.status || 'PENDING';
    if (status === 'PENDING') {
      return (
        <button type="button" onClick={() => markForReview(p.id)}
          className="text-xs bg-amber-100 text-amber-800 px-3 py-1.5 rounded hover:bg-amber-200">
          Mark for Review<span className="block">पुनरावलोकनासाठी चिन्हांकित करा</span>
        </button>
      );
    }
    if (status === 'IN_REVIEW') {
      return (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => startEditPurchase(p)}
            className="text-xs bg-white border border-emerald-700 text-emerald-700 px-3 py-1.5 rounded hover:bg-emerald-50">
            Edit<span className="block">संपादित करा</span>
          </button>
          <button type="button" onClick={() => completePurchase(p.id, status)}
            className="text-xs bg-emerald-700 text-white px-3 py-1.5 rounded hover:bg-emerald-800">
            {user.role === 'DEALER' ? (
              <>Confirm Purchase<span className="block">खरेदीची पुष्टी करा</span></>
            ) : (
              <>Place Order<span className="block">ऑर्डर द्या</span></>
            )}
          </button>
        </div>
      );
    }
    // RETAILER-only: order has been placed and is waiting on the dealer to
    // dispatch it (see Sales.jsx, Dispatch action) — nothing for the
    // retailer to do here yet.
    if (status === 'ORDERED') {
      return (
        <span className="text-xs bg-amber-50 text-amber-800 font-medium px-3 py-1.5 rounded border border-amber-200">
          Order Placed — awaiting dealer<span className="block">ऑर्डर दिली — डीलरची प्रतीक्षा</span>
        </span>
      );
    }
    // RETAILER-only: the dealer has dispatched it — retailer confirms receipt.
    if (status === 'IN_TRANSIT') {
      return (
        <button type="button" onClick={() => completePurchase(p.id, status)}
          className="text-xs bg-emerald-700 text-white px-3 py-1.5 rounded hover:bg-emerald-800">
          Mark Received<span className="block">प्राप्त झाले असे चिन्हांकित करा</span>
        </button>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <span className={`text-xs font-medium px-3 py-1.5 rounded border ${
          status === 'MODIFIED' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}>
          {status === 'CONFIRMED' ? 'Confirmed / पुष्टी झाली'
            : status === 'MODIFIED' ? 'Modified / सुधारित'
            : 'Received / प्राप्त झाले'}
        </span>
        {user.role === 'DEALER' && (status === 'CONFIRMED' || status === 'MODIFIED') && (
          <button type="button" onClick={() => openPrintPrompt(p)}
            className="text-xs bg-white border border-gray-400 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-50">
            Print Labels<span className="block">लेबल छापा</span>
          </button>
        )}
      </div>
    );
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    let payloadItems;
    if (user.role === 'RETAILER') {
      // Only product + quantity — see the simplified item card above.
      if (items.some((it) => !it.productId || !it.quantity)) {
        setError('Select a product and quantity for every item / प्रत्येक वस्तूसाठी उत्पादन आणि प्रमाण निवडा');
        return;
      }
      payloadItems = items.map((it) => ({ productId: it.productId, quantity: it.quantity }));
    } else {
      // Sell Price and Retailer Selling Price are computed fresh from each item's
      // other fields right here, rather than trusting a stored value, so
      // validation always reflects what's actually on screen.
      const computedItems = items.map((it) => ({
        ...it,
        sellingPrice: computeSellingPrice(it),
        retailerSellingPrice: computeRetailerPrice(it),
      }));
      if (computedItems.some((it) => !it.sellingPrice || !it.retailerSellingPrice)) {
        setError('Enter Cost Price, Dealer Commission, MRP and Product Discount for every item so Sell Price and Retailer Selling Price can be calculated / प्रत्येक वस्तूसाठी क्रय किंमत, डीलर कमिशन, एमआरपी आणि उत्पादन सवलत भरा जेणेकरून विक्री किंमत आणि किरकोळ विक्री किंमत आपोआप मोजली जाईल');
        return;
      }
      payloadItems = computedItems;
    }

    // Retailers always buy from their own primary dealer — the backend derives this
    // server-side, so nothing source-related needs to be sent for them.
    const payload = user.role === 'DEALER' ? { supplierId, items: payloadItems } : { items: payloadItems };
    try {
      if (editingPurchaseId) {
        await api.put(`/purchases/${editingPurchaseId}`, payload);
      } else {
        await api.post('/purchases', payload);
      }
      setSupplierId('');
      setItems([{ ...emptyItem }]);
      setEditingPurchaseId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || (editingPurchaseId
        ? 'Failed to update purchase / खरेदी अद्ययावत करण्यात अयशस्वी'
        : 'Failed to record purchase / खरेदी नोंदवण्यात अयशस्वी'));
    }
  }

  // Dealer purchases are tied to a single supplier for the whole purchase, so
  // the product dropdown only offers products from that supplier. Retailers
  // don't pick a supplier (they always buy from their own primary dealer), so
  // their product list is unfiltered.
  const availableProducts = user.role === 'DEALER'
    ? products.filter((p) => supplierId && p.supplierId === Number(supplierId))
    : products;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Purchases / Stock Inwards</h1>
      <p className="text-sm text-orange-700 mb-4">खरेदी / साठा आवक</p>

      {printPrompt && (
        <div className="bg-white rounded shadow p-4 mb-4 border border-emerald-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">
              Print Barcode Labels — Purchase #{printPrompt.purchase.id}
              <span className="block text-xs font-normal text-orange-700">खरेदी #{printPrompt.purchase.id} साठी लेबल छापा</span>
            </h3>
            <button type="button" onClick={() => setPrintPrompt(null)} className="text-xs text-gray-500 hover:underline">
              Skip / वगळा
            </button>
          </div>
          <div className="divide-y">
            {printPrompt.purchase.items.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{it.product?.name} <span className="text-xs text-gray-400">({it.product?.sizeWeight})</span></div>
                  <div className="text-xs text-gray-400">Batch {it.batchName} · MRP ₹{it.mrp} · Retailer ₹{it.retailerSellingPrice} · Purchased {it.quantity}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <FieldLabel en="Labels to print" mr="छापायची लेबल्स" />
                  <input type="number" min="1" className="border rounded w-20 px-2 py-1"
                    value={printPrompt.quantities[it.id]}
                    onChange={(e) => updatePrintQty(it.id, e.target.value)} />
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={submitPrintPrompt}
            className="mt-3 bg-emerald-700 text-white text-sm px-4 py-2 rounded hover:bg-emerald-800">
            Print Labels / लेबल छापा
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <form onSubmit={submit} className="bg-white p-4 rounded shadow space-y-3">
          {editingPurchaseId && (
            <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2 flex items-center justify-between gap-2">
              <span>
                Editing Purchase #{editingPurchaseId}
                <span className="block text-xs">खरेदी #{editingPurchaseId} संपादित करत आहे</span>
              </span>
              <button type="button" onClick={cancelEditPurchase} className="text-xs underline text-amber-800 hover:text-amber-900">
                Cancel
              </button>
            </div>
          )}
          {user.role === 'DEALER' && (
            <>
              <FieldLabel en="Supplier / Manufacturer" mr="पुरवठादार / उत्पादक" />
              <select className="border rounded px-2 py-1 w-full md:w-1/2" required
                value={supplierId} onChange={(e) => updateSupplier(e.target.value)}>
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

        <div className="space-y-4">
          {items.map((it, i) => {
            if (i !== items.length - 1) return null; // earlier items are already added — only the current entry shows as a card
            return (
              <div key={i} className="border rounded p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">
                    {items.length > 1 ? `Item ${i + 1}` : 'Item'} / वस्तू {i + 1}
                  </span>
                  {items.length > 1 && (
                    <button type="button" className="text-red-600 text-xs" onClick={() => removeItemRow(i)}>
                      Back to previous item / मागील वस्तूकडे परत जा
                    </button>
                  )}
                </div>

              {/* Line: Product */}
              <div className="flex flex-col gap-1">
                <FieldLabel en="Product" mr="उत्पादन" />
                <select className="border rounded px-2 py-1 w-full" required
                  disabled={user.role === 'DEALER' && !supplierId}
                  value={it.productId} onChange={(e) => updateItem(i, 'productId', e.target.value)}>
                  <option value="">Product... / उत्पादन निवडा...</option>
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {user.role === 'RETAILER'
                        ? `${p.name} - ${p.sizeWeight} / ${p.supplier?.name || '—'}`
                        : `${p.name} (${p.sizeWeight})`}
                    </option>
                  ))}
                </select>
                {user.role === 'DEALER' && !supplierId && (
                  <p className="text-xs text-amber-600 mt-1">Select a supplier first. <span className="block">प्रथम पुरवठादार निवडा.</span></p>
                )}
              </div>

              {/* Quantity is the only other field a RETAILER enters — everything
                  else below (batch, dates, cost, MRP, discount, retailer
                  price) is the dealer's own business detail and gets filled
                  in later when the dealer dispatches the order, not here. */}
              {user.role === 'RETAILER' ? (
                <div className="flex flex-col gap-1 w-32">
                  <FieldLabel en="Quantity" mr="प्रमाण" />
                  <input type="number" placeholder="Quantity" className="border rounded px-2 py-1 w-full" required
                    value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} />
                </div>
              ) : (
                <>
                  {/* Line: Quantity, Batch Name, Manufacturing Date, Expiry Date */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="flex flex-col gap-1">
                      <FieldLabel en="Quantity" mr="प्रमाण" />
                      <input type="number" placeholder="Quantity" className="border rounded px-2 py-1 w-full" required
                        value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <FieldLabel en="Batch Name" mr="बॅच नाव" />
                      <input placeholder="Batch Name" className="border rounded px-2 py-1 w-full" required
                        value={it.batchName} onChange={(e) => updateItem(i, 'batchName', e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <FieldLabel en="Manufacturing (mm-yyyy)" mr="उत्पादन तारीख" />
                      <input type="month" className="border rounded px-2 py-1 w-full" required
                        value={it.manufacturingDate} onChange={(e) => updateItem(i, 'manufacturingDate', e.target.value)} />
                      {it.manufacturingDate && (
                        <p className="text-xs text-gray-400">{formatMMYYYY(it.manufacturingDate)}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <FieldLabel en="Expiry (mm-yyyy)" mr="कालबाह्यता तारीख" />
                      <input type="month" className="border rounded px-2 py-1 w-full" required
                        value={it.expiryDate} onChange={(e) => updateItem(i, 'expiryDate', e.target.value)} />
                      {it.expiryDate && (
                        <p className="text-xs text-gray-400">{formatMMYYYY(it.expiryDate)}</p>
                      )}
                    </div>
                  </div>

                  {/* Line: Cost Price, Commission, Sell Price */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="flex flex-col gap-1">
                      <FieldLabel en="Cost Price" mr="क्रय किंमत" />
                      <input type="number" step="0.01" placeholder="Cost Price" className="border rounded px-2 py-1 w-full" required
                        value={it.rate} onChange={(e) => updateItem(i, 'rate', e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <FieldLabel en="Commission (%)" mr="डीलर कमिशन (%)" />
                      <input type="number" step="0.01" placeholder="Commission (%)" className="border rounded px-2 py-1 w-full" required
                        value={it.dealerCommission} onChange={(e) => updateItem(i, 'dealerCommission', e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <FieldLabel en="Sell Price" mr="विक्री किंमत" />
                      <input type="number" placeholder="Sell Price" className="border rounded px-2 py-1 w-full bg-gray-100 text-gray-700" disabled required
                        value={computeSellingPrice(it)} />
                    </div>
                  </div>

                  {/* Line: MRP, Discount %, Retailer Selling Price */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="flex flex-col gap-1">
                      <FieldLabel en="MRP" mr="एमआरपी" />
                      <input type="number" step="0.01" placeholder="MRP" className="border rounded px-2 py-1 w-full" required
                        value={it.mrp} onChange={(e) => updateItem(i, 'mrp', e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <FieldLabel en="Discount (%)" mr="सवलत (%)" />
                      <input type="number" step="0.01" min="0" max="100" placeholder="Discount (%)" className="border rounded px-2 py-1 w-full"
                        value={it.discount} onChange={(e) => updateItem(i, 'discount', e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <FieldLabel en="Retailer Selling Price" mr="किरकोळ विक्री किंमत" />
                      <input type="number" placeholder="Retailer Selling Price" className="border rounded px-2 py-1 w-full bg-gray-100 text-gray-700" disabled required
                        value={computeRetailerPrice(it)} />
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
        
        {/* Live preview of items in this purchase, same table layout used when viewing
            an existing purchase. Quantity is editable here — same pattern as editing a
            PENDING/IN_REVIEW purchase's quantity — and stays synced with the form above.
            RETAILER only ever has Product + Qty to show — everything else is the
            dealer's business detail, filled in later at dispatch. */}
        {items.some((it) => it.productId) && user.role === 'RETAILER' && (
          <div className="mt-2">
            <p className="text-xs font-medium text-gray-500 mb-1">
              Items in this Purchase<span className="block text-orange-700">या खरेदीतील वस्तू</span>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-1">Product / उत्पादन</th>
                    <th className="text-left p-1">Qty / प्रमाण</th>
                    <th className="text-left p-1">Original Qty / मूळ प्रमाण</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    if (!it.productId) return null;
                    const product = products.find((p) => String(p.id) === String(it.productId));
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-1">{product?.name || '—'}</td>
                        <td className="p-1">
                          <input type="number" min="1" className="border rounded px-1 py-0.5 w-20"
                            value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} />
                        </td>
                        {/* Readonly — always mirrors Qty while the purchase is
                            being created. The server sets originalQuantity to
                            match whatever quantity is submitted; this is just
                            showing the retailer what that baseline will be. */}
                        <td className="p-1 text-gray-500">{it.quantity || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {items.some((it) => it.productId) && user.role === 'DEALER' && (
          <div className="mt-2">
            <p className="text-xs font-medium text-gray-500 mb-1">
              Items in this Purchase<span className="block text-orange-700">या खरेदीतील वस्तू</span>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-1">Product / उत्पादन</th>
                    <th className="text-left p-1">Qty / प्रमाण</th>
                    <th className="text-left p-1">Batch / बॅच</th>
                    <th className="text-left p-1">Cost / क्रय</th>
                    <th className="text-left p-1">Commission / कमिशन</th>
                    <th className="text-left p-1">Sell Price / विक्री किंमत</th>
                    <th className="text-left p-1">MRP / एमआरपी</th>
                    <th className="text-left p-1">Discount / सवलत</th>
                    <th className="text-left p-1">Retailer Price / किरकोळ किंमत</th>
                    <th className="text-left p-1">Mfg (mm-yyyy) / उत्पादन तारीख</th>
                    <th className="text-left p-1">Exp (mm-yyyy) / कालबाह्यता</th>
                  </tr>
                </thead>
                                <tbody>
                  {items.map((it, i) => {
                    if (!it.productId) return null;
                    const product = products.find((p) => String(p.id) === String(it.productId));
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-1">{product?.name || '—'}</td>
                        <td className="p-1">
                          <input type="number" min="1" className="border rounded px-1 py-0.5 w-20"
                            value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} />
                        </td>
                        <td className="p-1">
                          <input type="text" className="border rounded px-1 py-0.5 w-28"
                            value={it.batchName} onChange={(e) => updateItem(i, 'batchName', e.target.value)} />
                        </td>
                        <td className="p-1">
                          <input type="number" step="0.01" min="0" className="border rounded px-1 py-0.5 w-24"
                            value={it.rate} onChange={(e) => updateItem(i, 'rate', e.target.value)} />
                        </td>
                        <td className="p-1">
                          <input type="number" step="0.01" min="0" className="border rounded px-1 py-0.5 w-20"
                            value={it.dealerCommission} onChange={(e) => updateItem(i, 'dealerCommission', e.target.value)} />
                        </td>
                        <td className="p-1 bg-gray-50 text-gray-700">{computeSellingPrice(it) ? `₹${computeSellingPrice(it)}` : '—'}</td>
                        <td className="p-1">
                          <input type="number" step="0.01" min="0" className="border rounded px-1 py-0.5 w-24"
                            value={it.mrp} onChange={(e) => updateItem(i, 'mrp', e.target.value)} />
                        </td>
                        <td className="p-1">
                          <input type="number" step="0.01" min="0" max="100" className="border rounded px-1 py-0.5 w-20"
                            value={it.discount} onChange={(e) => updateItem(i, 'discount', e.target.value)} />
                        </td>
                        <td className="p-1 bg-gray-50 text-gray-700">{computeRetailerPrice(it) ? `₹${computeRetailerPrice(it)}` : '—'}</td>
                        <td className="p-1">
                          <input type="month" className="border rounded px-1 py-0.5 w-32"
                            value={it.manufacturingDate} onChange={(e) => updateItem(i, 'manufacturingDate', e.target.value)} />
                          {it.manufacturingDate && (
                            <span className="block text-xs text-gray-400">{formatMMYYYY(it.manufacturingDate)}</span>
                          )}
                        </td>
                        <td className="p-1">
                          <input type="month" className="border rounded px-1 py-0.5 w-32"
                            value={it.expiryDate} onChange={(e) => updateItem(i, 'expiryDate', e.target.value)} />
                          {it.expiryDate && (
                            <span className="block text-xs text-gray-400">{formatMMYYYY(it.expiryDate)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <button type="button" className="text-emerald-700 text-sm"
          onClick={() => setItems([...items, { ...emptyItem }])}>
          + Add another item / आणखी एक वस्तू जोडा
        </button>
        <div>
          <button className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
            {editingPurchaseId ? 'Save Changes / बदल जतन करा' : 'Record Purchase / खरेदी नोंदवा'}
          </button>
        </div>
      </form>

      <div className="lg:sticky lg:top-4">
          {/* Purchase lookup: pick a purchase by ID and view/edit it. This is
              now the only view of a purchase on this side of the screen —
              the full history list has been removed. */}
          <div className="bg-white rounded shadow p-4">
            <FieldLabel en="View / Edit Purchase" mr="खरेदी पहा / संपादित करा" />
            <select className="border rounded px-2 py-1 w-full mt-1"
              value={selectedPurchaseId} onChange={(e) => setSelectedPurchaseId(e.target.value)}>
              <option value="">Select a purchase... / खरेदी निवडा...</option>
              {purchases.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.id} — {p.supplier?.name || p.sourceDealer?.name || '—'} — {new Date(p.date).toLocaleDateString()} — {p.status || 'PENDING'}
                </option>
              ))}
            </select>

            {selectedPurchase ? (
              <div className="mt-3">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div>
                    <div className="font-semibold">{selectedPurchase.supplier?.name || selectedPurchase.sourceDealer?.name}</div>
                    <div className="text-xs text-gray-400">{new Date(selectedPurchase.date).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {user.role === 'DEALER' && (
                      <button type="button" onClick={() => printPurchaseOrder(selectedPurchase.id)}
                        className="text-xs bg-white border border-gray-400 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-50">
                        Print Purchase Order<span className="block">खरेदी ऑर्डर छापा</span>
                      </button>
                    )}
                    {user.role === 'DEALER' && (selectedPurchase.status === 'CONFIRMED' || selectedPurchase.status === 'MODIFIED') && !editingPrices && (
                      <button type="button" onClick={startEditPrices}
                        className="text-xs bg-white border border-emerald-700 text-emerald-700 px-3 py-1.5 rounded hover:bg-emerald-50">
                        Correct Prices<span className="block">किंमती दुरुस्त करा</span>
                      </button>
                    )}
                    {statusAction(selectedPurchase)}
                  </div>
                </div>

                {priceSuccessMessage && (
                  <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 mb-2">{priceSuccessMessage}</div>
                )}

                {(() => {
                  const { itemCount, totalQuantity, totalAmount, isComplete } = purchaseTotals(selectedPurchase, user.role);
                  return (
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-2">
                      <div>
                        <span className="text-gray-500">Items</span> <span className="text-gray-400">/ वस्तू:</span>{' '}
                        <span className="font-medium">{itemCount}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Total Qty</span> <span className="text-gray-400">/ एकूण प्रमाण:</span>{' '}
                        <span className="font-medium">{totalQuantity}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Total</span> <span className="text-gray-400">/ एकूण:</span>{' '}
                        {isComplete ? (
                          <span className="font-medium">₹{totalAmount.toFixed(2)}</span>
                        ) : (
                          <span className="font-medium text-amber-700">
                            Pending dealer fulfillment <span className="text-amber-600">/ डीलरच्या पूर्ततेची प्रतीक्षा</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {user.role === 'RETAILER' ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left p-1">Product / उत्पादन</th>
                          <th className="text-left p-1">Original Qty / मूळ प्रमाण</th>
                          <th className="text-left p-1">Qty / प्रमाण</th>
                          <th className="text-left p-1">Batch / बॅच</th>
                          <th className="text-left p-1">MRP / एमआरपी</th>
                          <th className="text-left p-1">Retailer Price / किरकोळ किंमत</th>
                          <th className="text-left p-1">Exp (mm-yyyy) / कालबाह्यता</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPurchase.items.map((it) => {
                          // Highlights a line the dealer fulfilled (or is
                          // currently dispatching) for a different quantity
                          // than what was originally ordered — that edit on
                          // the dealer's Sales screen cascades back to this
                          // PurchaseItem's quantity (see sales.js PATCH
                          // /:id/items), so it shows up here too, most
                          // relevantly right before Mark Received.
                          const qtyChanged = it.originalQuantity != null && it.quantity !== it.originalQuantity;
                          return (
                            <tr key={it.id} className={`border-t ${qtyChanged ? 'bg-amber-50' : ''}`}>
                              <td className="p-1">{it.product?.name}</td>
                              <td className="p-1 text-gray-500">{it.originalQuantity ?? '—'}</td>
                              <td className="p-1">
                                {isSelectedEditable ? (
                                  <input type="number" min="1" className="border rounded px-1 py-0.5 w-20"
                                    value={quantityEdits[it.id] ?? ''}
                                    onChange={(e) => setQuantityEdits((prev) => ({ ...prev, [it.id]: e.target.value }))} />
                                ) : it.quantity}
                              </td>
                              {/* batch/MRP/price/expiry are only known once the dealer
                                  has dispatched the order (IN_TRANSIT/RECEIVED) — blank
                                  until then, since a retailer never enters them. */}
                              <td className="p-1">{it.batchName || '—'}</td>
                              <td className="p-1">{it.mrp != null ? `₹${it.mrp}` : '—'}</td>
                              <td className="p-1">{it.retailerSellingPrice != null ? `₹${it.retailerSellingPrice}` : '—'}</td>
                              <td className="p-1">{it.expiryDate ? formatMMYYYY(it.expiryDate) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left p-1">Product / उत्पादन</th>
                          <th className="text-left p-1">Qty / प्रमाण</th>
                          <th className="text-left p-1">Batch / बॅच</th>
                          <th className="text-left p-1">Cost / क्रय</th>
                          <th className="text-left p-1">Commission / कमिशन</th>
                          <th className="text-left p-1">Sell Price / विक्री किंमत</th>
                          <th className="text-left p-1">MRP / एमआरपी</th>
                          <th className="text-left p-1">Discount / सवलत</th>
                          <th className="text-left p-1">Retailer Price / किरकोळ किंमत</th>
                          <th className="text-left p-1">Mfg (mm-yyyy) / उत्पादन तारीख</th>
                          <th className="text-left p-1">Exp (mm-yyyy) / कालबाह्यता</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPurchase.items.map((it) => {
                          const edit = priceEdits[it.id];
                          const liveSellingPrice = editingPrices && edit ? computeSellingPrice(edit) : null;
                          const liveRetailerPrice = editingPrices && edit ? computeRetailerPrice(edit) : null;
                          return (
                            <tr key={it.id} className="border-t">
                              <td className="p-1">{it.product?.name}</td>
                              <td className="p-1">
                                {isSelectedEditable ? (
                                  <input type="number" min="1" className="border rounded px-1 py-0.5 w-20"
                                    value={quantityEdits[it.id] ?? ''}
                                    onChange={(e) => setQuantityEdits((prev) => ({ ...prev, [it.id]: e.target.value }))} />
                                ) : it.quantity}
                              </td>
                              <td className="p-1">{it.batchName}</td>
                              <td className="p-1">
                                {editingPrices ? (
                                  <input type="number" step="0.01" min="0" className="border rounded px-1 py-0.5 w-20"
                                    value={edit?.rate ?? ''}
                                    onChange={(e) => updatePriceEdit(it.id, 'rate', e.target.value)} />
                                ) : `₹${it.rate}`}
                              </td>
                              <td className="p-1">
                                {editingPrices ? (
                                  <input type="number" step="0.01" min="0" className="border rounded px-1 py-0.5 w-16"
                                    value={edit?.dealerCommission ?? ''}
                                    onChange={(e) => updatePriceEdit(it.id, 'dealerCommission', e.target.value)} />
                                ) : `${it.dealerCommission}%`}
                              </td>
                              <td className="p-1">₹{editingPrices ? (liveSellingPrice || '—') : it.sellingPrice}</td>
                              <td className="p-1">
                                {editingPrices ? (
                                  <input type="number" step="0.01" min="0" className="border rounded px-1 py-0.5 w-20"
                                    value={edit?.mrp ?? ''}
                                    onChange={(e) => updatePriceEdit(it.id, 'mrp', e.target.value)} />
                                ) : `₹${it.mrp}`}
                              </td>
                              <td className="p-1">
                                {editingPrices ? (
                                  <input type="number" step="0.01" min="0" className="border rounded px-1 py-0.5 w-16"
                                    value={edit?.discount ?? ''}
                                    onChange={(e) => updatePriceEdit(it.id, 'discount', e.target.value)} />
                                ) : `${it.discount}%`}
                              </td>
                              <td className="p-1">₹{editingPrices ? (liveRetailerPrice || '—') : (it.retailerSellingPrice ?? computeRetailerPrice(it))}</td>
                              <td className="p-1">{formatMMYYYY(it.manufacturingDate)}</td>
                              <td className="p-1">{formatMMYYYY(it.expiryDate)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {priceError && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mt-2">{priceError}</div>
                )}

                {editingPrices && (
                  <div className="flex items-center gap-3 mt-2">
                    <button type="button" onClick={savePrices} disabled={savingPrices}
                      className="text-xs bg-emerald-700 text-white px-3 py-1.5 rounded hover:bg-emerald-800 disabled:opacity-50">
                      {savingPrices ? 'Saving... / जतन करत आहे...' : 'Save Price Changes / किंमत बदल जतन करा'}
                    </button>
                    <button type="button" onClick={cancelEditPrices} disabled={savingPrices}
                      className="text-xs text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100">
                      Cancel / रद्द करा
                    </button>
                  </div>
                )}

                {quantityError && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mt-2">{quantityError}</div>
                )}

                {isSelectedEditable && (
                  <button type="button" onClick={saveQuantities} disabled={savingQuantities}
                    className="mt-2 text-xs bg-emerald-700 text-white px-3 py-1.5 rounded hover:bg-emerald-800 disabled:opacity-50">
                    {savingQuantities ? 'Saving... / जतन करत आहे...' : 'Save Quantity Changes / प्रमाण बदल जतन करा'}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-sm mt-2">
                No purchase selected.
                <span className="block text-xs">कोणतीही खरेदी निवडलेली नाही.</span>
              </p>
            )}
          </div>
        </div>
      </div>
      </div>
  );
}
