import { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Sales() {
  const { user } = useAuth();
  const [sales, setSales] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [availableItems, setAvailableItems] = useState([]); // batches from /sales/available-items
  // cart holds BOTH kinds of rows, told apart by whether saleItemId is set:
  //  - a brand-new POS line added via barcode scan: { inventoryId, product, batchName,
  //    mrp, sellingPrice, retailerSellingPrice, quantity, available }
  //  - a line loaded from an existing sale (see loadSaleIntoCart): always has
  //    saleItemId. `locked: true` for a COMPLETED/DISPATCHED sale (read-only,
  //    price/batch already resolved). `locked: false` for a DEALER's own
  //    IN_PENDING order awaiting dispatch — batchName/sellingPrice start null
  //    until a batch is chosen from the dropdown (see chooseRowBatch).
  const [cart, setCart] = useState([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [customerType, setCustomerType] = useState('CASH');
  const [customerRetailerId, setCustomerRetailerId] = useState('');
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [scanError, setScanError] = useState('');
  const [pendingBatches, setPendingBatches] = useState(null); // batches to choose from when a scan matches >1
  const [submitting, setSubmitting] = useState(false);
  // Set when a "Recent Sales" row is clicked — the same cart table above is
  // then populated from that sale's items instead of the barcode scanner.
  // null means "building a brand-new sale" (the original behaviour).
  const [activeSale, setActiveSale] = useState(null);
  const [dispatchError, setDispatchError] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const scanRef = useRef(null);

  async function load() {
    const [s, inv] = await Promise.all([api.get('/sales'), api.get('/sales/available-items')]);
    setSales(s.data);
    setAvailableItems(inv.data);
    if (user.role === 'DEALER') {
      const r = await api.get('/retailers');
      setRetailers(r.data);
    }
    return s.data;
  }
  useEffect(() => { load(); scanRef.current?.focus(); }, []);

  const activeSaleLocked = activeSale && (activeSale.status || 'COMPLETED') !== 'IN_PENDING';
  const activeSaleEditable = activeSale && !activeSaleLocked && user.role === 'DEALER';

  // Dealers selling to a walk-in (CASH) customer, and retailers selling to
  // their end customer, both sell at retailerSellingPrice. A dealer selling
  // on to a retailer sells at sellingPrice (wholesale). This mirrors the
  // backend's price resolution exactly (see sales.js createSale) — it's
  // display-only here, the actual charge is always resolved server-side
  // from the chosen batch. A row loaded from an existing sale (saleItemId
  // set) already carries its own resolved price instead — either the
  // sale's original price (locked) or the price of the batch just chosen
  // from the dropdown (pending), taken straight from Inventory.sellingPrice.
  function unitPrice(item) {
    if (item.saleItemId) return item.sellingPrice != null ? Number(item.sellingPrice) : 0;
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

  // Quantity edit for a brand-new scanned line (keyed by inventoryId, since
  // that's the batch it was scanned against).
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

  // ---- Loading an existing sale into the same cart table ----

  // Every eligible batch for a pending order line: same product, and
  // enough stock to cover the ordered quantity on its own (no splitting
  // one line across two batches).
  function batchOptionsFor(item) {
    return availableItems.filter((inv) => inv.productId === item.product.id && inv.quantity >= item.quantity);
  }

  function loadSaleIntoCart(sale) {
    const locked = (sale.status || 'COMPLETED') !== 'IN_PENDING';
    const items = sale.items.map((it) => (
      locked
        ? {
            saleItemId: it.id,
            locked: true,
            product: it.product,
            quantity: it.quantity,
            originalQuantity: it.originalQuantity != null ? Number(it.originalQuantity) : null,
            batchName: it.batchName,
            mrp: it.mrp != null ? Number(it.mrp) : null,
            sellingPrice: it.price != null ? Number(it.price) : null,
          }
        : {
            saleItemId: it.id,
            locked: false,
            product: it.product,
            quantity: it.quantity,
            originalQuantity: it.originalQuantity != null ? Number(it.originalQuantity) : null,
            inventoryId: null,
            batchName: null,
            mrp: null,
            sellingPrice: null,
            available: null,
          }
    ));
    setActiveSale(sale);
    setCustomerType(sale.customerType);
    setCart(items);
    setDispatchError('');
    setPendingBatches(null);
    setScanError('');
  }

  function exitActiveSale() {
    setActiveSale(null);
    setCart([]);
    setDispatchError('');
    scanRef.current?.focus();
  }

  // A batch chosen from the dropdown for a pending order line — price/mrp
  // come straight from that Inventory row (sellingPrice, the dealer's
  // wholesale price), never trusted from anywhere else client-side; the
  // server re-derives it the same way at dispatch time regardless.
  function chooseRowBatch(saleItemId, inventoryId) {
    const inv = availableItems.find((i) => i.id === Number(inventoryId));
    setCart((prev) => prev.map((c) => {
      if (c.saleItemId !== saleItemId) return c;
      if (!inv) return { ...c, inventoryId: null, batchName: null, mrp: null, sellingPrice: null, available: null };
      return {
        ...c,
        inventoryId: inv.id,
        batchName: inv.batchName,
        mrp: inv.mrp != null ? Number(inv.mrp) : null,
        sellingPrice: Number(inv.sellingPrice),
        available: inv.quantity,
      };
    }));
  }

  // Quantity edit for a pending order line. Clamped to originalQuantity —
  // a dealer can fulfil for less than what was ordered (partial
  // fulfilment) but never more; the server enforces the same ceiling
  // independently (see sales.js PATCH /:id/items). If the currently-chosen
  // batch no longer covers the new quantity, the choice is cleared rather
  // than left silently under-stocked — the user has to pick again.
  function updateRowQty(saleItemId, qty) {
    setCart((prev) => prev.map((c) => {
      if (c.saleItemId !== saleItemId || c.locked) return c;
      let nextQty = Math.max(1, Number(qty) || 1);
      if (c.originalQuantity != null) nextQty = Math.min(nextQty, c.originalQuantity);
      const stillFits = c.inventoryId && c.available != null && c.available >= nextQty;
      return stillFits
        ? { ...c, quantity: nextQty }
        : { ...c, quantity: nextQty, inventoryId: null, batchName: null, mrp: null, sellingPrice: null, available: null };
    }));
  }

  const total = cart.reduce((s, c) => s + unitPrice(c) * c.quantity, 0);
  // Split for the two Recent Sales sections below — CASH is a walk-in
  // customer sale; anything else (RETAILER) is a dealer selling on to one
  // of their own retailers.
  const cashSales = sales.filter((s) => s.customerType === 'CASH');
  const nonCashSales = sales.filter((s) => s.customerType !== 'CASH');

  // Shared table body for both Recent Sales sections below — identical
  // row rendering, just given a different (pre-filtered) slice of `sales`
  // and its own empty-state message.
  function renderSalesTable(rows, emptyMessage) {
    return (
      <div className="bg-white rounded shadow overflow-x-auto lg:max-h-[calc(50vh-8rem)] lg:overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 sticky top-0">
            <tr>
              <th className="text-left p-2">#</th>
              <th className="text-left p-2">Date <span className="text-gray-400 font-normal">/ दिनांक</span></th>
              <th className="text-left p-2">Customer <span className="text-gray-400 font-normal">/ ग्राहक</span></th>
              <th className="text-left p-2">Payment <span className="text-gray-400 font-normal">/ पैसे भरणे</span></th>
              <th className="text-left p-2">Total <span className="text-gray-400 font-normal">/ एकूण</span></th>
              <th className="text-left p-2">Status <span className="text-gray-400 font-normal">/ स्थिती</span></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const status = s.status || 'COMPLETED';
              const isActive = activeSale?.id === s.id;
              return (
                <tr key={s.id}
                  className={`border-t cursor-pointer hover:bg-gray-50 ${isActive ? 'bg-emerald-50' : ''}`}
                  onClick={() => loadSaleIntoCart(s)}>
                  <td className="p-2">{s.id}</td>
                  <td className="p-2">{new Date(s.date).toLocaleString()}</td>
                  <td className="p-2">{s.customerType}{s.posTransactionRef ? ` · ${s.posTransactionRef}` : ''}</td>
                  <td className="p-2">{s.paymentMode || '—'}</td>
                  <td className="p-2">{s.totalAmount != null ? `₹${Number(s.totalAmount).toFixed(2)}` : '—'}</td>
                  <td className="p-2">
                    {status === 'IN_PENDING' && (
                      <span className="text-xs bg-amber-50 text-amber-800 font-medium px-2 py-1 rounded border border-amber-200">
                        Pending Order<span className="block">प्रलंबित ऑर्डर</span>
                      </span>
                    )}
                    {status === 'DISPATCHED' && (
                      <span className="text-xs bg-emerald-50 text-emerald-700 font-medium px-2 py-1 rounded border border-emerald-200">
                        Dispatched<span className="block">पाठवले</span>
                      </span>
                    )}
                    {status === 'COMPLETED' && (
                      <span className="text-xs text-gray-500">Completed<span className="block">पूर्ण</span></span>
                    )}
                  </td>
                  <td className="p-2">
                    {status !== 'IN_PENDING' && (
                      <button className="text-emerald-700 text-xs" onClick={(e) => { e.stopPropagation(); printBill(s.id); }}>Print / छापा</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={7}>{emptyMessage}</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }

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

  // Dispatches the currently-loaded IN_PENDING order: persists any quantity
  // edits first (PATCH /:id/items), then submits the chosen batch per line
  // (PATCH /:id/dispatch) with the selected payment mode.
  async function submitDispatch() {
    if (!activeSale || dispatching) return;
    setDispatchError('');

    if (cart.some((c) => !c.inventoryId)) {
      setDispatchError('Choose a batch for every item / प्रत्येक वस्तूसाठी बॅच निवडा');
      return;
    }

    setDispatching(true);
    try {
      await api.patch(`/sales/${activeSale.id}/items`, {
        items: cart.map((c) => ({ id: c.saleItemId, quantity: c.quantity })),
      });
      await api.patch(`/sales/${activeSale.id}/dispatch`, {
        paymentMode,
        items: cart.map((c) => ({ saleItemId: c.saleItemId, inventoryId: c.inventoryId })),
      });
      exitActiveSale();
      await load();
    } catch (err) {
      setDispatchError(err.response?.data?.error || 'Failed to dispatch order / ऑर्डर पाठवण्यात अयशस्वी');
    } finally {
      setDispatching(false);
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
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Sales / POS <span className="text-gray-400 font-normal">/ विक्री / पॉस</span></h1>
          {activeSale && (
            <button type="button" onClick={exitActiveSale} className="text-sm text-emerald-700 hover:underline">
              + New Sale
            </button>
          )}
        </div>

        {user.role === 'DEALER' && (
          <div className="bg-white p-4 rounded shadow mb-4 flex items-center gap-4">
            {activeSale ? (
              <span className="text-sm font-medium">
                Customer <span className="text-gray-400">/ ग्राहक</span>:{' '}
                <span className="font-normal">
                  {retailers.find((r) => r.id === activeSale.customerRetailerId)?.name || 'Retailer'}
                </span>
              </span>
            ) : (
              <>
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
              </>
            )}
          </div>
        )}

        <div className="bg-white p-4 rounded shadow mb-4">
          {activeSale ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">
                  Sale #{activeSale.id} <span className="text-gray-400 font-normal">{new Date(activeSale.date).toLocaleString()}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {activeSaleLocked
                    ? 'This sale is locked and can no longer be edited — view only.'
                    : 'Choose a batch for each item below, then Dispatch Order.'}
                </p>
              </div>
              {(activeSale.status || 'COMPLETED') === 'IN_PENDING' && (
                <span className="text-xs bg-amber-50 text-amber-800 font-medium px-2 py-1 rounded border border-amber-200 shrink-0">
                  Pending Order
                </span>
              )}
              {activeSale.status === 'DISPATCHED' && (
                <span className="text-xs bg-emerald-50 text-emerald-700 font-medium px-2 py-1 rounded border border-emerald-200 shrink-0">
                  Dispatched
                </span>
              )}
              {(activeSale.status || 'COMPLETED') === 'COMPLETED' && (
                <span className="text-xs text-gray-500 shrink-0">Completed</span>
              )}
            </div>
          ) : (
            <>
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
                    Multiple batches available for {[pendingBatches[0].product?.name, pendingBatches[0].product?.sizeWeight, pendingBatches[0].product?.flavour, pendingBatches[0].product?.brand].filter(Boolean).join(' · ')} — choose one
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
            </>
          )}
        </div>

        <div className="bg-white rounded shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-2">Product <span className="text-gray-400 font-normal">/ उत्पादन</span></th>
                <th className="text-left p-2">Batch <span className="text-gray-400 font-normal">/ बॅच</span></th>
                <th className="text-left p-2">Price <span className="text-gray-400 font-normal">/ किंमत</span></th>
                {/* Original Qty only means anything for a retailer's own
                    purchase order showing up here as a sale to fulfil —
                    never for a direct/walk-in (CASH) customer sale, which
                    has no such originating order to compare against. */}
                {customerType !== 'CASH' && (
                  <th className="text-left p-2">Original Qty <span className="text-gray-400 font-normal">/ मूळ प्रमाण</span></th>
                )}
                <th className="text-left p-2">Qty <span className="text-gray-400 font-normal">/ प्रमाण</span></th>
                <th className="text-left p-2">Line Total <span className="text-gray-400 font-normal">/ एकूण</span></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((c) => {
                const price = unitPrice(c);
                const mrp = c.mrp != null ? Number(c.mrp) : null;
                const pendingNoBatch = c.saleItemId && !c.locked && !c.inventoryId;
                // Flags a fulfilled/being-fulfilled order line whose quantity
                // has drifted from what was originally ordered — the dealer
                // reduced it (partial fulfilment), whether that happened
                // just now (still IN_PENDING) or already at dispatch time
                // (now DISPATCHED). Never fires for a brand-new POS line
                // (no originalQuantity concept there).
                const qtyChanged = c.originalQuantity != null && c.quantity !== c.originalQuantity;
                return (
                  <tr key={c.saleItemId ?? c.inventoryId} className={`border-t ${qtyChanged ? 'bg-amber-50' : ''}`}>
                    <td className="p-2">
                      <div>{c.product.name}</div>
                      {[c.product.sizeWeight, c.product.flavour, c.product.brand].filter(Boolean).length > 0 && (
                        <div className="text-xs text-gray-400">
                          {[c.product.sizeWeight, c.product.flavour, c.product.brand].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      {c.saleItemId && !c.locked ? (
                        <select className="border rounded px-2 py-1 text-sm w-full" value={c.inventoryId || ''}
                          onChange={(e) => chooseRowBatch(c.saleItemId, e.target.value)}>
                          <option value="">Choose a batch... / बॅच निवडा...</option>
                          {batchOptionsFor(c).map((inv) => (
                            <option key={inv.id} value={inv.id}>
                              {inv.batchName || '—'} · exp {inv.expiryDate ? new Date(inv.expiryDate).toLocaleDateString() : '-'} · in stock {inv.quantity} · ₹{Number(inv.sellingPrice).toFixed(2)}/unit
                            </option>
                          ))}
                          {batchOptionsFor(c).length === 0 && <option disabled>No batch can fulfil this quantity</option>}
                        </select>
                      ) : (c.batchName || '-')}
                    </td>
                    <td className="p-2">
                      {pendingNoBatch ? (
                        <span className="text-gray-400 text-xs">Choose a batch</span>
                      ) : (
                        <>
                          ₹{price.toFixed(2)}
                          {mrp != null && mrp > price && (
                            <span className="text-gray-400 line-through ml-1 text-xs">₹{mrp.toFixed(2)}</span>
                          )}
                        </>
                      )}
                    </td>
                    {customerType !== 'CASH' && (
                      <td className="p-2 text-gray-500">{c.originalQuantity ?? '—'}</td>
                    )}
                    <td className="p-2">
                      {c.locked ? c.quantity : (
                        <input type="number" min="1" max={c.saleItemId ? (c.originalQuantity ?? undefined) : c.available}
                          className="border rounded w-16 px-1" value={c.quantity}
                          onChange={(e) => c.saleItemId ? updateRowQty(c.saleItemId, e.target.value) : updateQty(c.inventoryId, e.target.value)} />
                      )}
                    </td>
                    <td className="p-2">{pendingNoBatch ? '—' : `₹${(price * c.quantity).toFixed(2)}`}</td>
                    <td className="p-2">
                      {!c.saleItemId && (
                        <button className="text-red-600 text-xs" onClick={() => removeItem(c.inventoryId)}>Remove / काढा</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {cart.length === 0 && (
                <tr><td className="p-3 text-gray-400" colSpan={7}>
                  {activeSale ? 'No items on this sale.' : (
                    <>
                      Cart is empty. Scan a product barcode to begin.
                      <span className="block text-xs">कार्ट रिकामी आहे. सुरू करण्यासाठी उत्पादनाचा बारकोड स्कॅन करा.</span>
                    </>
                  )}
                </td></tr>
              )}
            </tbody>
            {cart.length > 0 && (
              <tfoot>
                <tr className="border-t-2 bg-gray-50 font-semibold">
                  <td className="p-2" colSpan={customerType !== 'CASH' ? 5 : 4}>
                    Total <span className="text-gray-400 font-normal">/ एकूण</span>
                  </td>
                  <td className="p-2">₹{total.toFixed(2)}</td>
                  <td className="p-2"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div>
        <div className="bg-white p-4 rounded shadow sticky top-4">
          {activeSaleLocked ? (
            <>
              <h2 className="font-semibold mb-3">Sale #{activeSale.id}</h2>
              <div className="text-3xl font-bold mb-4">
                ₹{activeSale.totalAmount != null ? Number(activeSale.totalAmount).toFixed(2) : total.toFixed(2)}
              </div>
              <p className="text-xs text-gray-500 mb-4">
                Payment mode: <span className="font-medium">{activeSale.paymentMode || '—'}</span>
              </p>
              <button
                onClick={() => printBill(activeSale.id)}
                className="w-full bg-emerald-700 text-white py-3 rounded font-semibold hover:bg-emerald-800">
                Print Bill / बिल छापा
              </button>
            </>
          ) : activeSaleEditable ? (
            <>
              <h2 className="font-semibold mb-3">Dispatch Order #{activeSale.id}</h2>
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

              {dispatchError && <p className="text-red-600 text-sm mb-2">{dispatchError}</p>}

              <button
                disabled={dispatching || cart.some((c) => !c.inventoryId)}
                onClick={submitDispatch}
                className="w-full bg-emerald-700 text-white py-3 rounded font-semibold hover:bg-emerald-800 disabled:opacity-40">
                {dispatching ? 'Dispatching... / पाठवत आहे...' : 'Dispatch Order / ऑर्डर पाठवा'}
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>

        <div className="mt-4">
          <h2 className="text-lg font-semibold mb-2">Recent Sales <span className="text-gray-400 font-normal">/ अलीकडील विक्री</span></h2>

          <h3 className="text-sm font-semibold text-gray-600 mb-1">Cash Sales <span className="text-gray-400 font-normal">/ रोख विक्री</span></h3>
          {renderSalesTable(cashSales, 'No cash sales yet. / अद्याप रोख विक्री नाही.')}

          <h3 className="text-sm font-semibold text-gray-600 mb-1 mt-4">Retailer Sales <span className="text-gray-400 font-normal">/ किरकोळ विक्रेता विक्री</span></h3>
          {renderSalesTable(nonCashSales, 'No retailer sales yet. / अद्याप किरकोळ विक्रेता विक्री नाही.')}
        </div>
      </div>
    </div>
  );
}
