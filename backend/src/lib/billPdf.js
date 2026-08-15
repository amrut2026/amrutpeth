import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Noto Sans Devanagari covers both Devanagari and basic Latin, so one font
// family handles the English + Marathi bilingual labels below without
// switching fonts mid-line. Download both weights from Google Fonts
// (https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari) and place
// them at these paths — see README for the exact filenames expected.
const FONT_REGULAR = path.join(__dirname, '../fonts/NotoSansDevanagari-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '../fonts/NotoSansDevanagari-Bold.ttf');

// --- TVS RP 3200 Lite geometry -------------------------------------------
// This model takes 80mm roll paper but only prints across 72mm of it (4mm
// dead zone on each edge — per TVS's spec sheet: "Media width 80mm / Print
// width 72mm", 203 DPI). It's a continuous thermal roll, not cut-sheet A4,
// so there's no fixed page height to design around. generateSaleBillPdf()
// below instead makes two passes over the same layout: a "measure" pass
// that uses PDFKit's heightOfString() to add up how tall the bill actually
// is, then a "draw" pass that creates a single page sized to that height
// plus a bottom feed allowance for the auto-cutter/tear bar. That also
// means the old "28 rows per page, carry the total forward" pagination is
// gone entirely — a receipt printer doesn't have pages to break across.
//
// To target the 58mm-paper variant instead, the only change needed is
// PAPER_WIDTH_MM / PRINTABLE_WIDTH_MM below (58mm paper on this class of
// printer prints across roughly 48mm).
const MM = 2.834645669; // PDF points per mm
const PAPER_WIDTH_MM = 80;
const PRINTABLE_WIDTH_MM = 72;
const PAGE_WIDTH = PAPER_WIDTH_MM * MM;
const PAGE_MARGIN = ((PAPER_WIDTH_MM - PRINTABLE_WIDTH_MM) / 2) * MM; // ~11.3pt (4mm) each side
const CONTENT_WIDTH = PRINTABLE_WIDTH_MM * MM; // ~204pt (72mm)
const RIGHT_EDGE = PAGE_MARGIN + CONTENT_WIDTH;
const BOTTOM_FEED = 15 * MM; // clearance before the cutter/tear bar so the last line isn't trimmed

// English / Marathi label pairs, combined as "English / मराठी" wherever
// printed on the bill.
const L = {
  title: 'SALES BILL / विक्री पावती',
  billNo: 'Bill No / बिल क्र.',
  date: 'Date / दिनांक',
  paymentMode: 'Payment Mode / पैसे भरण्याची पद्धत',
  posRef: 'POS Ref / पीओएस संदर्भ',
  customer: 'Customer / ग्राहक',
  cashCustomer: 'Cash Customer / रोख ग्राहक',
  batch: 'Batch / बॅच',
  mrp: 'MRP',
  save: 'Save / बचत',
  totalSavings: 'Total Savings / एकूण बचत',
  grandTotal: 'GRAND TOTAL / एकूण रक्कम',
  thankYou: 'Thank you for your business. / आपल्या व्यवसायासाठी धन्यवाद.',
};

function fmt(n) {
  return Number(n || 0).toFixed(2);
}

// Thin wrapper around a PDFDocument that lets the exact same layout code
// run twice: once against a throwaway document purely to accumulate
// heights (draw: false), and once against the real page to actually paint
// it (draw: true). Both passes use identical font/size/width inputs, so
// the measured height always matches what gets drawn — no rowcount
// guessing, no wasted paper feed, nothing clipped at the bottom.
class Cursor {
  constructor(doc, { draw }) {
    this.doc = doc;
    this.draw = draw;
    this.y = 0;
  }
  font(f) {
    this.doc.font(f);
    return this;
  }
  fontSize(s) {
    this.doc.fontSize(s);
    return this;
  }
  text(str, { width = CONTENT_WIDTH, align = 'left', x = PAGE_MARGIN } = {}) {
    const h = this.doc.heightOfString(str, { width, align });
    if (this.draw) this.doc.text(str, x, this.y, { width, align });
    this.y += h;
    return h;
  }
  // Two strings on one visual line: left text and a right-aligned value at
  // the printable right edge (e.g. "2 x 45.00" ... "90.00").
  row(left, right, { leftWidth = CONTENT_WIDTH - 70 } = {}) {
    const y = this.y;
    const h1 = this.doc.heightOfString(left, { width: leftWidth });
    const h2 = this.doc.heightOfString(right, { width: CONTENT_WIDTH, align: 'right' });
    if (this.draw) {
      this.doc.text(left, PAGE_MARGIN, y, { width: leftWidth });
      this.doc.text(right, PAGE_MARGIN, y, { width: CONTENT_WIDTH, align: 'right' });
    }
    this.y = y + Math.max(h1, h2);
  }
  moveDown(lines = 1) {
    this.y += this.doc.currentLineHeight() * lines;
  }
  hr(padAfter = 0.2) {
    if (this.draw) this.doc.moveTo(PAGE_MARGIN, this.y).lineTo(RIGHT_EDGE, this.y).stroke();
    this.moveDown(padAfter);
  }
}

function renderHeader(c, party) {
  c.font(FONT_BOLD).fontSize(10);
  c.text(party?.name || '—', { align: 'center' });
  c.font(FONT_REGULAR).fontSize(7);
  if (party?.address) c.text(party.address, { align: 'center' });
  const line2 = [party?.contactNumber ? `Ph: ${party.contactNumber}` : null, party?.gstNumber ? `GSTIN: ${party.gstNumber}` : null]
    .filter(Boolean)
    .join('  |  ');
  if (line2) c.text(line2, { align: 'center' });
  c.moveDown(0.2);
  c.hr(0.4);
}

function renderBillMeta(c, sale) {
  c.font(FONT_BOLD).fontSize(8.5);
  c.text(L.title, { align: 'center' });
  c.moveDown(0.2);
  c.font(FONT_REGULAR).fontSize(7.5);
  c.text(`${L.billNo}: ${sale.id}`);
  c.text(`${L.date}: ${new Date(sale.date).toLocaleString('en-IN')}`);
  c.text(`${L.paymentMode}: ${sale.paymentMode || '-'}`);
  if (sale.posTransactionRef) c.text(`${L.posRef}: ${sale.posTransactionRef}`);
  const customerLabel = sale.customerType === 'RETAILER'
    ? (sale.customerRetailer?.name || 'Retailer')
    : L.cashCustomer;
  c.text(`${L.customer}: ${customerLabel}`);
  c.moveDown(0.3);
}

// sale.items[].price / .mrp are snapshots taken at sale time from the
// Inventory batch sold from (see generateSaleBillPdf's doc comment), so the
// bill stays correct even if that batch's row later changes. "Save" is only
// shown when mrp is greater than the price actually charged; MRP/Save are
// dropped for B2B (dealer -> retailer) bills since they're a consumer-facing
// concept.
function renderItem(c, item, idx, isB2B) {
  const price = Number(item.price);
  const amount = price * Number(item.quantity);
  const mrp = item.mrp != null ? Number(item.mrp) : null;
  const savedPerUnit = mrp != null && mrp > price ? mrp - price : 0;
  const savedTotal = savedPerUnit * Number(item.quantity);

  c.font(FONT_BOLD).fontSize(8);
  c.text(`${idx + 1}. ${item.product?.name || `#${item.productId}`}`);

  c.font(FONT_REGULAR).fontSize(7);
  if (item.batchName) c.text(`   ${L.batch}: ${item.batchName}`);
  c.row(`   ${item.quantity} x ${fmt(price)}`, fmt(amount));

  if (!isB2B && (mrp != null || savedTotal > 0)) {
    const bits = [];
    if (mrp != null) bits.push(`${L.mrp} ${fmt(mrp)}`);
    if (savedTotal > 0) bits.push(`${L.save} ${fmt(savedTotal)}`);
    c.text(`   ${bits.join('   ')}`);
  }
  c.moveDown(0.35);

  return { amount, savedTotal };
}

function renderBill(c, sale, party, isB2B) {
  renderHeader(c, party);
  renderBillMeta(c, sale);
  c.hr(0.3);

  let totalSavings = 0;
  sale.items.forEach((item, idx) => {
    const { savedTotal } = renderItem(c, item, idx, isB2B);
    if (!isB2B) totalSavings += savedTotal;
  });

  c.hr(0.3);

  if (!isB2B && totalSavings > 0) {
    c.font(FONT_REGULAR).fontSize(8);
    c.text(`${L.totalSavings}: Rs. ${fmt(totalSavings)}`, { align: 'right' });
    c.moveDown(0.2);
  }

  c.font(FONT_BOLD).fontSize(10);
  c.text(`${L.grandTotal}: Rs. ${fmt(sale.totalAmount)}`, { align: 'right' });
  c.moveDown(0.6);
  c.font(FONT_REGULAR).fontSize(7);
  c.text(L.thankYou, { align: 'center' });
}

// sale: a Sale with { items: [{ product, quantity, price, mrp, batchName }],
//        ..., customerRetailer? } — items[].price and items[].mrp are
//        snapshots taken at sale time from the Inventory batch sold from,
//        so the bill still shows correct figures even if that batch's
//        inventory row later changes.
// party: the Dealer or Retailer that made the sale (for the header).
export async function generateSaleBillPdf(sale, party) {
  const isB2B = sale.customerType === 'RETAILER';

  // Pass 1 — measure. This document is never written anywhere; it exists
  // only so heightOfString()/currentLineHeight() have real font metrics to
  // measure against (Devanagari glyphs don't share Latin glyph widths, so
  // this can't be estimated by counting lines).
  const measureDoc = new PDFDocument({ autoFirstPage: false });
  const measureCursor = new Cursor(measureDoc, { draw: false });
  renderBill(measureCursor, sale, party, isB2B);
  const contentHeight = measureCursor.y;
  const pageHeight = Math.ceil(PAGE_MARGIN + contentHeight + BOTTOM_FEED);

  // Pass 2 — draw, onto a single continuous page sized exactly to the content.
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [PAGE_WIDTH, pageHeight], margin: 0, bufferPages: true });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const cursor = new Cursor(doc, { draw: true });
    cursor.y = PAGE_MARGIN;
    renderBill(cursor, sale, party, isB2B);

    doc.end();
  });
}