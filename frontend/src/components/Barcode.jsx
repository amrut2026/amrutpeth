import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

// name/flavour/sizeWeight/brand are all optional — pass them to show a
// product-detail line above the barcode (mirrors what gets printed on the
// physical label below, so what's on screen matches the sticker). Omit
// them for a bare barcode, same as before this was added.
export default function Barcode({ value, width = 1.4, height = 40, name, flavour, sizeWeight, brand }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && value) {
      JsBarcode(ref.current, value, { format: 'CODE128', width, height, displayValue: true, fontSize: 12, margin: 4 });
    }
  }, [value, width, height]);

  const mainLine = [name, sizeWeight ? `(${sizeWeight})` : null].filter(Boolean).join(' ');
  const subLine = [flavour, brand].filter(Boolean).join(' \u00b7 ');
  const hasDetails = mainLine || subLine;

  return (
    <div className="inline-flex flex-col items-center">
      {hasDetails && (
        <div className="text-center mb-1">
          {mainLine && <div className="text-xs font-semibold leading-tight">{mainLine}</div>}
          {subLine && <div className="text-xs text-gray-500 leading-tight">{subLine}</div>}
        </div>
      )}
      <svg ref={ref}></svg>
    </div>
  );
}

// Renders the label markup for one product repeated `quantity` times.
// `priceInfo` (optional) is `{ mrp, retailerSellingPrice }` — when given, a
// price line is added below the barcode. Printed as "You Pay" rather than
// "Retailer" since this is the price the retailer scanning the label pays,
// not a description of who they are.
// Sized to fit a 1.44in x 1in label (see openLabelPrintWindow) — smaller
// barcode/font than the on-screen <Barcode> component uses.
function renderLabelGroup({ name, sizeWeight, flavour, brand, barcode, quantity = 1, priceInfo }) {
  const line1 = [name, flavour, brand].filter(Boolean).join(' &middot; ');
  const line2 = sizeWeight ? `<div class="sub">${sizeWeight}</div>` : '';
  const priceLine = priceInfo
    ? `<div class="price">${priceInfo.mrp != null ? `MRP: ₹${priceInfo.mrp}` : ''}${
        priceInfo.mrp != null && priceInfo.retailerSellingPrice != null ? ' &nbsp;|&nbsp; ' : ''
      }${priceInfo.retailerSellingPrice != null ? `You Pay: ₹${priceInfo.retailerSellingPrice}` : ''}</div>`
    : '';
  return Array.from({ length: Math.max(1, Number(quantity) || 1) }).map(() => `
    <div class="label">
      <div class="name">${line1}</div>
      ${line2}
      <svg class="bc" jsbarcode-value="${barcode}" jsbarcode-width="1" jsbarcode-height="26" jsbarcode-fontsize="8" jsbarcode-margin="2"></svg>
      ${priceLine}
    </div>`).join('');
}

// Two label columns per row, sized for the TVS LP 46 Dlite BPLE on 3in-wide
// roll stock: each label is 1.44in wide with a 0.12in gap between the two
// columns (1.44 + 0.12 + 1.44 = 3in), 1in tall. No inter-row gap is printed
// (assumes the physical labels are already die-cut/gapped on the roll) — if
// the roll needs a printed gap between rows too, this is where to add it.
function openLabelPrintWindow(title, labelsHtml) {
  const win = window.open('', '_blank', 'width=340,height=600');
  win.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          @page { size: 3in auto; margin: 0; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: sans-serif; }
          .labels { display: grid; grid-template-columns: 1.44in 1.44in; column-gap: 0.12in; width: 3in; }
          .label {
            width: 1.44in; height: 1in; padding: 2px 4px;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            text-align: center; overflow: hidden;
          }
          .name { font-size: 9px; font-weight: bold; line-height: 1.15; }
          .sub { font-size: 7px; color: #333; line-height: 1.1; }
          .price { font-size: 8px; margin-top: 1px; color: #000; }
          .bc { max-width: 100%; }
          @media print { .label { page-break-inside: avoid; } }
        </style>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js"></script>
      </head>
      <body onload="JsBarcode('.bc').init(); setTimeout(() => window.print(), 300);">
        <div class="labels">${labelsHtml}</div>
      </body>
    </html>
  `);
  win.document.close();
}

// Opens a single print-friendly window with labels for several purchase
// items at once, each with its own print quantity and its own batch's MRP /
// retailer selling price shown below the barcode. This is the only barcode
// printing path in the app — printing was intentionally removed from the
// product screen, since Product itself carries no MRP/price (that only
// exists per purchase batch — see PurchaseItem), so a label printed from the
// catalog could never show real pricing anyway.
export function printBarcodeLabelsBatch(entries, title = 'Print Barcodes') {
  const labels = entries.map((entry) => renderLabelGroup({
    name: entry.name,
    sizeWeight: entry.sizeWeight,
    flavour: entry.flavour,
    brand: entry.brand,
    barcode: entry.barcode,
    quantity: entry.quantity,
    priceInfo: { mrp: entry.mrp, retailerSellingPrice: entry.retailerSellingPrice },
  })).join('');
  openLabelPrintWindow(title, labels);
}
