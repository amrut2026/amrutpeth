import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same font family as billPdf.js — Noto Sans Devanagari covers the
// English + Marathi bilingual labels without switching fonts mid-line.
const FONT_REGULAR = path.join(__dirname, '../fonts/NotoSansDevanagari-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '../fonts/NotoSansDevanagari-Bold.ttf');

// Standard cut-sheet A4, unlike billPdf.js's continuous thermal-roll layout
// (see that file's geometry comment for why the sale bill needs a
// measure-then-draw pass) — a purchase order is meant to be filed, emailed,
// or handed to a supplier, not torn off a till, so this uses PDFKit's
// ordinary paginated page flow: measure each row as it's drawn, add a page
// and repeat the table header whenever a row wouldn't fit.
const MARGIN = 40;
const PAGE_WIDTH = 595.28; // A4, pt
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_HEIGHT - MARGIN;

const L = {
  title: 'PURCHASE ORDER / खरेदी ऑर्डर',
  poNo: 'PO No / ऑर्डर क्र.',
  date: 'Date / दिनांक',
  status: 'Status / स्थिती',
  srNo: 'Sr. / अ.क्र.',
  product: 'Product / उत्पादन',
  batch: 'Batch / बॅच',
  mfg: 'Mfg / उत्पादन तारीख',
  exp: 'Exp / एक्सपायरी',
  qty: 'Qty / प्रमाण',
  rate: 'Rate / दर',
  amount: 'Amount / रक्कम',
  totalQty: 'Total Qty / एकूण प्रमाण',
  grandTotal: 'GRAND TOTAL / एकूण रक्कम',
  authSign: 'Authorized Signatory / अधिकृत स्वाक्षरी',
};

function fmt(n) {
  return Number(n || 0).toFixed(2);
}
function fmtMonthYear(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return `${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
}

// Rate/Amount only — deliberately no Dealer Commission, Selling Price, or
// Retailer Selling Price columns. Those are the dealer's own onward-margin
// figures; a document going to the supplier who sold at Rate in the first
// place has no business disclosing what the dealer marks it up to.
const COLS = [
  { key: 'sr', label: L.srNo, width: 28, align: 'left' },
  { key: 'product', label: L.product, width: 150, align: 'left' },
  { key: 'batch', label: L.batch, width: 70, align: 'left' },
  { key: 'mfg', label: L.mfg, width: 55, align: 'center' },
  { key: 'exp', label: L.exp, width: 55, align: 'center' },
  { key: 'qty', label: L.qty, width: 45, align: 'right' },
  { key: 'rate', label: L.rate, width: 55, align: 'right' },
  { key: 'amount', label: L.amount, width: 57, align: 'right' },
];

function colX(idx) {
  return MARGIN + COLS.slice(0, idx).reduce((sum, c) => sum + c.width, 0);
}

function drawTableHeader(doc, y) {
  doc.font(FONT_BOLD).fontSize(8);
  const headerHeight = Math.max(...COLS.map((c) => doc.heightOfString(c.label, { width: c.width })));
  COLS.forEach((c, i) => doc.text(c.label, colX(i), y, { width: c.width, align: c.align }));
  const lineY = y + headerHeight + 4;
  doc.moveTo(MARGIN, lineY).lineTo(MARGIN + CONTENT_WIDTH, lineY).stroke();
  return lineY + 6;
}

// Row height is measured with the same font/size that draws it, in the
// same doc, so there's never a mismatch between what was measured and what
// gets painted (unlike billPdf.js, no separate throwaway document is
// needed here — adding a page is cheap, unlike wasting thermal paper).
function measureRowHeight(doc, values) {
  doc.font(FONT_REGULAR).fontSize(8);
  return Math.max(...COLS.map((c) => doc.heightOfString(String(values[c.key] ?? ''), { width: c.width }))) + 6;
}
function drawRow(doc, y, values) {
  doc.font(FONT_REGULAR).fontSize(8);
  COLS.forEach((c, i) => doc.text(String(values[c.key] ?? ''), colX(i), y, { width: c.width, align: c.align }));
}

// Dealer name/address/contact/GST as the header block, then — its own
// line, right corner, same font/size as the dealer name — the supplier's
// name. Reads as a letterhead: "who this order is from" on the left,
// stacked; "who it's addressed to" on the right, matching weight.
function renderHeader(doc, dealer, supplierName) {
  let y = MARGIN;

  doc.font(FONT_BOLD).fontSize(16);
  const dealerName = dealer?.name || '—';
  doc.text(dealerName, MARGIN, y, { width: CONTENT_WIDTH, align: 'left' });
  y += doc.heightOfString(dealerName, { width: CONTENT_WIDTH }) + 3;

  doc.font(FONT_REGULAR).fontSize(9);
  if (dealer?.address) {
    doc.text(dealer.address, MARGIN, y, { width: CONTENT_WIDTH, align: 'left' });
    y += doc.heightOfString(dealer.address, { width: CONTENT_WIDTH }) + 2;
  }
  const contactLine = [
    dealer?.contactNumber ? `Ph: ${dealer.contactNumber}` : null,
    dealer?.gstNumber ? `GSTIN: ${dealer.gstNumber}` : null,
  ].filter(Boolean).join('   |   ');
  if (contactLine) {
    doc.text(contactLine, MARGIN, y, { width: CONTENT_WIDTH, align: 'left' });
    y += doc.heightOfString(contactLine, { width: CONTENT_WIDTH }) + 6;
  }

  doc.font(FONT_BOLD).fontSize(16);
  const supplierLabel = supplierName || '—';
  doc.text(supplierLabel, MARGIN, y, { width: CONTENT_WIDTH, align: 'right' });
  y += doc.heightOfString(supplierLabel, { width: CONTENT_WIDTH }) + 10;

  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).stroke();
  return y + 16;
}

function renderTitleAndMeta(doc, y, purchase) {
  doc.font(FONT_BOLD).fontSize(13);
  doc.text(L.title, MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
  y += doc.heightOfString(L.title, { width: CONTENT_WIDTH }) + 12;

  doc.font(FONT_REGULAR).fontSize(9);
  const left = `${L.poNo}: ${purchase.id}`;
  const mid = `${L.date}: ${new Date(purchase.date).toLocaleDateString('en-IN')}`;
  const right = `${L.status}: ${purchase.status}`;
  doc.text(left, MARGIN, y, { width: CONTENT_WIDTH, align: 'left' });
  doc.text(mid, MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
  doc.text(right, MARGIN, y, { width: CONTENT_WIDTH, align: 'right' });
  return y + doc.heightOfString(left) + 16;
}

// purchase: a Purchase with { items: [{ product, quantity, rate, batchName,
//           manufacturingDate, expiryDate }], id, date, status, supplier }
//           — rate is this purchase's own recorded cost price, so the PO
//           still shows correct figures even after a later price
//           correction (see purchases.js PATCH /:id/prices) — it always
//           reflects whatever the item's current rate is at print time.
// dealer: the Dealer that placed the order (for the header).
export async function generatePurchaseOrderPdf(purchase, dealer) {
  const supplierName = purchase.supplier?.name || '—';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = renderHeader(doc, dealer, supplierName);
    y = renderTitleAndMeta(doc, y, purchase);
    y = drawTableHeader(doc, y);

    let totalQty = 0;
    let totalAmount = 0;

    purchase.items.forEach((item, idx) => {
      const qty = Number(item.quantity);
      const rate = Number(item.rate);
      const amount = qty * rate;
      totalQty += qty;
      totalAmount += amount;

      const values = {
        sr: idx + 1,
        product: item.product?.name || `#${item.productId}`,
        batch: item.batchName || '-',
        mfg: fmtMonthYear(item.manufacturingDate),
        exp: fmtMonthYear(item.expiryDate),
        qty,
        rate: fmt(rate),
        amount: fmt(amount),
      };

      const rowHeight = measureRowHeight(doc, values);
      if (y + rowHeight > BOTTOM_LIMIT) {
        doc.addPage();
        y = MARGIN;
        y = drawTableHeader(doc, y);
      }
      drawRow(doc, y, values);
      y += rowHeight;
    });

    if (y + 50 > BOTTOM_LIMIT) {
      doc.addPage();
      y = MARGIN;
    }
    y += 4;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).stroke();
    y += 10;

    doc.font(FONT_BOLD).fontSize(9);
    const totalQtyLabel = `${L.totalQty}: ${totalQty}`;
    const grandTotalLabel = `${L.grandTotal}: Rs. ${fmt(totalAmount)}`;
    doc.text(totalQtyLabel, MARGIN, y, { width: CONTENT_WIDTH, align: 'left' });
    doc.text(grandTotalLabel, MARGIN, y, { width: CONTENT_WIDTH, align: 'right' });
    y += doc.heightOfString(grandTotalLabel) + 60;

    if (y + 30 > BOTTOM_LIMIT) {
      doc.addPage();
      y = MARGIN;
    }
    doc.font(FONT_REGULAR).fontSize(9);
    const sigWidth = 200;
    const sigX = MARGIN + CONTENT_WIDTH - sigWidth;
    doc.text('_______________________', sigX, y, { width: sigWidth, align: 'center' });
    y += 16;
    doc.text(L.authSign, sigX, y, { width: sigWidth, align: 'center' });

    doc.end();
  });
}
