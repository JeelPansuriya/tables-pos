import { BrowserWindow } from 'electron';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PosPrinter } = require('electron-pos-printer');

export type PrintLine =
  | { type: 'text'; value: string; style?: Record<string, string>; css?: Record<string, string> }
  | { type: 'divider' };

export type SlipBill = {
  id: number;
  token_no: number | null;
  type: string;
  meal_type: 'lunch' | 'dinner';
  table_label?: string | null;
  customer_name?: string | null;
  customer_mobile?: string | null;
  notes?: string | null;
  subtotal: number;
  discount: number;
  total: number;
  plates: number;
  opened_at: string;
  closed_at?: string | null;
  items: Array<{ name: string; qty: number; unit_price: number; total: number }>;
  payments: Array<{ amount: number; mode: string; cash_received?: number; change_given?: number }>;
};

export type SlipShop = {
  name: string;
  address?: string;
  phone?: string;
  gst?: string;
};

function formatINR(n: number): string {
  return `Rs.${n.toFixed(2)}`;
}

// Stored timestamps are UTC ("YYYY-MM-DD HH:MM:SS"). Render in local time.
function fmtLocal(s?: string | null): string {
  if (!s) return '';
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(iso);
  const d = new Date(hasTz ? iso : iso + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString([], {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---- Slip layout ------------------------------------------------------------
// electron-pos-printer renders each line's `value` as HTML (innerHTML), so we
// lay rows out with full-width flexbox rather than fixed-width character padding.
// That makes content fill the whole 80mm paper, keeps amounts flush-right, and
// lets long text (names, address) wrap inside a small side padding instead of
// running off the edge. Only important lines are bold — not the whole bill.

const FONT = "'Consolas','Roboto Mono','Courier New',monospace";
const PADX = '6px'; // small breathing room on both sides
// 80mm thermal heads only print ~72mm wide; laying the body out at the full
// 80mm clips the right edge (where amounts sit). Constrain the printable body
// width so content fills the paper without spilling into the dead zone.
// Tune down (e.g. 70mm) if still clipped, or up (76mm) if there's a right gap.
const PAGE_WIDTH = '72mm';

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function base(weight: 'normal' | 'bold', sizePx: number, align: 'left' | 'center'): Record<string, string> {
  return {
    'font-family': FONT,
    'font-weight': weight,
    'font-size': `${sizePx}px`,
    'text-align': align,
    width: '100%',
    'box-sizing': 'border-box',
    'padding-left': PADX,
    'padding-right': PADX,
    'overflow-wrap': 'anywhere',
  };
}

const center = (text: string, bold = false, size: 'lg' | 'md' | 'sm' = 'md') => ({
  type: 'text',
  value: esc(text),
  style: base(bold ? 'bold' : 'normal', size === 'lg' ? 20 : size === 'md' ? 14 : 11, 'center'),
});

const left = (text: string, bold = false) => ({
  type: 'text',
  value: esc(text),
  style: base(bold ? 'bold' : 'normal', 12, 'left'),
});

/** Full-width row: label flush-left, value flush-right (value never wraps). */
const row = (l: string, r: string, bold = false) => ({
  type: 'text',
  value:
    `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">` +
    `<span style="overflow-wrap:anywhere">${esc(l)}</span>` +
    `<span style="white-space:nowrap">${esc(r)}</span></div>`,
  style: base(bold ? 'bold' : 'normal', 12, 'left'),
});

const divider = () => ({
  type: 'text',
  value: '',
  style: {
    'border-top': '1px dashed #000',
    margin: '4px 0',
    width: '100%',
    'box-sizing': 'border-box',
  },
});

// A few blank lines of paper feed at the end (HTML <br>, so it actually advances).
const feed = () => ({ type: 'text', value: '<br><br><br>', style: { 'font-family': FONT } });

function buildBillData(shop: SlipShop, bill: SlipBill, copyLabel: string): any[] {
  const lines: any[] = [];
  lines.push(center(shop.name, true, 'lg'));
  if (shop.address) lines.push(center(shop.address, false, 'sm'));
  if (shop.phone) lines.push(center(shop.phone, false, 'sm'));
  if (shop.gst) lines.push(center(`GST: ${shop.gst}`, false, 'sm'));
  if (copyLabel) lines.push(center(copyLabel, true, 'sm'));
  lines.push(divider());

  if (bill.token_no != null) lines.push(left(`Token #${bill.token_no}`, true));
  lines.push(left(`Type : ${bill.type}${bill.table_label ? ' • ' + bill.table_label : ''}`));
  lines.push(left(`Meal : ${bill.meal_type}`));
  lines.push(left(`Time : ${fmtLocal(bill.closed_at || bill.opened_at)}`));
  if (bill.customer_name) lines.push(left(`Cust : ${bill.customer_name}`));
  if (bill.customer_mobile) lines.push(left(`Mob  : ${bill.customer_mobile}`));
  lines.push(divider());

  lines.push(row('Item', 'Amount', true));
  for (const it of bill.items) {
    lines.push(left(it.name));
    lines.push(row(`  ${it.qty} x ${formatINR(it.unit_price)}`, formatINR(it.total)));
  }
  lines.push(divider());
  lines.push(row('Subtotal', formatINR(bill.subtotal)));
  if (bill.discount > 0) lines.push(row('Discount', '-' + formatINR(bill.discount)));
  lines.push(row('TOTAL', formatINR(bill.total), true));
  lines.push(divider());
  for (const p of bill.payments) {
    lines.push(row(`Paid (${p.mode})`, formatINR(p.amount)));
  }
  if (bill.notes) {
    lines.push(divider());
    lines.push(left(`Note: ${bill.notes}`));
  }
  lines.push(divider());
  lines.push(center('Thank you! Visit again.', false, 'sm'));
  lines.push(feed());
  return lines;
}

export async function printBill(
  shop: SlipShop,
  bill: SlipBill,
  printerName: string,
  copies: number
): Promise<void> {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) throw new Error('No window for printing');

  const opts: any = {
    preview: false,
    margin: '0 0 0 0',
    copies: 1,
    printerName: printerName || undefined,
    timeOutPerLine: 400,
    pageSize: '80mm',
    width: PAGE_WIDTH,
    silent: true,
  };

  // Manager copy removed — print only the customer slip (no copy label). The
  // `copies` setting now just means how many identical customer slips to print.
  const n = Math.max(1, copies || 1);
  const data = buildBillData(shop, bill, '');
  for (let i = 0; i < n; i++) {
    await PosPrinter.print(data, opts);
  }
}

export type SlipPreorder = {
  id: number;
  order_no: number | null;
  customer_name: string;
  customer_mobile?: string | null;
  for_date: string;
  for_time?: string | null;
  meal_type?: string | null;
  notes?: string | null;
  total: number;
  discount?: number;
  advance_paid: number;
  balance_due: number;
  items: Array<{ name: string; qty: number; unit_price: number; total: number }>;
};

export async function printPreorderReceipt(
  shop: SlipShop,
  pre: SlipPreorder,
  printerName: string
): Promise<void> {
  const lines: any[] = [];
  lines.push(center(shop.name, true, 'lg'));
  if (shop.address) lines.push(center(shop.address, false, 'sm'));
  if (shop.phone) lines.push(center(shop.phone, false, 'sm'));
  lines.push(center('PRE-ORDER RECEIPT', true, 'sm'));
  lines.push(divider());
  lines.push(left(`Order #: ${pre.order_no ?? pre.id}`, true));
  lines.push(left(`For    : ${pre.for_date}${pre.for_time ? ' ' + pre.for_time : ''}`));
  if (pre.meal_type) lines.push(left(`Meal   : ${pre.meal_type}`));
  lines.push(left(`Cust   : ${pre.customer_name}`));
  if (pre.customer_mobile) lines.push(left(`Mob    : ${pre.customer_mobile}`));
  lines.push(divider());
  lines.push(row('Item', 'Amount', true));
  for (const it of pre.items) {
    lines.push(left(it.name));
    lines.push(row(`  ${it.qty} x ${formatINR(it.unit_price)}`, formatINR(it.total)));
  }
  lines.push(divider());
  lines.push(row('TOTAL', formatINR(pre.total), true));
  if (pre.discount && pre.discount > 0) lines.push(row('Discount', '-' + formatINR(pre.discount)));
  lines.push(row('Advance paid', formatINR(pre.advance_paid)));
  lines.push(row('Balance due', formatINR(pre.balance_due), true));
  if (pre.notes) {
    lines.push(divider());
    lines.push(left(`Note: ${pre.notes}`));
  }
  lines.push(divider());
  lines.push(center('Please bring this slip on the day of order.', false, 'sm'));
  lines.push(feed());

  const opts: any = {
    preview: false,
    margin: '0 0 0 0',
    copies: 1,
    printerName: printerName || undefined,
    timeOutPerLine: 400,
    pageSize: '80mm',
    width: PAGE_WIDTH,
    silent: true,
  };
  await PosPrinter.print(lines, opts);
}

export type SlipDaySummary = {
  date: string;
  totals: { bills: number; revenue: number; plates: number };
  byMode: Array<{ mode: string; amt: number }>;
  byMeal: Array<{ meal_type: string; bills: number; plates: number; revenue: number }>;
  items: Array<{ name: string; qty: number; revenue: number }>;
  preorderPaid: number;
  totalCollected: number;
  cancelled: Array<{ token_no: number | null; total: number }>;
  cancelledTotal: number;
};

export async function printDaySummary(
  shop: SlipShop,
  s: SlipDaySummary,
  printerName: string
): Promise<void> {
  const lines: any[] = [];
  lines.push(center(shop.name, true, 'lg'));
  lines.push(center('DAY SUMMARY', true, 'sm'));
  lines.push(center(s.date, false, 'sm'));
  lines.push(divider());
  lines.push(row('Bills', String(s.totals.bills)));
  lines.push(row('Bill revenue', formatINR(s.totals.revenue)));
  lines.push(row('Plates', s.totals.plates.toFixed(1)));
  lines.push(row('Pre-order payments', formatINR(s.preorderPaid)));
  lines.push(row('TOTAL COLLECTED', formatINR(s.totalCollected), true));
  lines.push(divider());
  lines.push(left('By payment mode', true));
  for (const m of s.byMode) lines.push(row(`  ${m.mode}`, formatINR(m.amt)));
  if (s.byMode.length === 0) lines.push(left('  (none)'));
  lines.push(divider());
  lines.push(left('By meal', true));
  for (const m of s.byMeal)
    lines.push(row(`  ${m.meal_type} (${m.plates} plates)`, formatINR(m.revenue)));
  lines.push(divider());
  lines.push(left('Items sold', true));
  for (const it of s.items) lines.push(row(`  ${it.name} x${it.qty}`, formatINR(it.revenue)));
  if (s.items.length === 0) lines.push(left('  (none)'));
  lines.push(divider());
  lines.push(center('End of day', false, 'sm'));
  lines.push(feed());

  const opts: any = {
    preview: false,
    margin: '0 0 0 0',
    copies: 1,
    printerName: printerName || undefined,
    timeOutPerLine: 400,
    pageSize: '80mm',
    width: PAGE_WIDTH,
    silent: true,
  };
  await PosPrinter.print(lines, opts);
}

export async function printTestSlip(printerName: string): Promise<void> {
  const lines: any[] = [
    center('TEST PRINT', true, 'lg'),
    center('If you can read this, the printer is connected.', false, 'sm'),
    feed(),
  ];
  const opts: any = {
    preview: false,
    margin: '0 0 0 0',
    copies: 1,
    printerName: printerName || undefined,
    timeOutPerLine: 400,
    pageSize: '80mm',
    width: PAGE_WIDTH,
    silent: true,
  };
  await PosPrinter.print(lines, opts);
}
