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

function pad(left: string, right: string, width = 32): string {
  const space = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

// Thermal heads print faint at normal weight, so every line is bold by default
// and emphasized lines go heavier still (900). A crisp fixed-width font keeps the
// padded columns aligned while printing darker than the default `monospace`.
const FONT = "'Consolas','Roboto Mono','Courier New',monospace";

const center = (text: string, bold = false, size: 'lg' | 'md' | 'sm' = 'md') => ({
  type: 'text',
  value: text,
  style: {
    'text-align': 'center',
    'font-weight': bold ? '900' : 'bold',
    'font-size': size === 'lg' ? '20px' : size === 'md' ? '14px' : '11px',
    'font-family': FONT,
  },
});
const left = (text: string, bold = false) => ({
  type: 'text',
  value: text,
  style: {
    'text-align': 'left',
    'font-weight': bold ? '900' : 'bold',
    'font-size': '12px',
    'font-family': FONT,
    'white-space': 'pre',
  },
});
const divider = () => ({
  type: 'text',
  value: '--------------------------------',
  style: { 'font-family': FONT, 'font-size': '12px', 'font-weight': 'bold' },
});

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

  lines.push(left(pad('Item              Qty', 'Amt')));
  for (const it of bill.items) {
    const nameLine = `${it.name}`.slice(0, 24);
    lines.push(left(pad(nameLine, '')));
    lines.push(left(pad(`  ${it.qty} x ${formatINR(it.unit_price)}`, formatINR(it.total))));
  }
  lines.push(divider());
  lines.push(left(pad('Subtotal', formatINR(bill.subtotal))));
  if (bill.discount > 0) lines.push(left(pad('Discount', '-' + formatINR(bill.discount))));
  lines.push(left(pad('TOTAL', formatINR(bill.total)), true));
  lines.push(divider());
  for (const p of bill.payments) {
    lines.push(
      left(pad(`Paid (${p.mode})`, formatINR(p.amount)))
    );
    if (p.mode === 'cash' && p.cash_received != null && p.change_given != null && p.change_given > 0) {
      lines.push(left(pad('  Tendered', formatINR(p.cash_received))));
      lines.push(left(pad('  Change', formatINR(p.change_given))));
    }
  }
  if (bill.notes) {
    lines.push(divider());
    lines.push(left(`Note: ${bill.notes}`));
  }
  lines.push(divider());
  lines.push(center('Thank you! Visit again.', false, 'sm'));
  // bottom feed — note printer driver setting "Page End ≠ Ignore page tails blank"
  // is required for this CSS-side feed to actually advance the paper.
  lines.push({ type: 'text', value: '\n\n\n', style: { 'font-family': 'monospace' } });
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
  for (const it of pre.items) {
    lines.push(left(`${it.name}`));
    lines.push(left(pad(`  ${it.qty} x ${formatINR(it.unit_price)}`, formatINR(it.total))));
  }
  lines.push(divider());
  lines.push(left(pad('TOTAL', formatINR(pre.total)), true));
  lines.push(left(pad('Advance paid', formatINR(pre.advance_paid))));
  lines.push(left(pad('Balance due', formatINR(pre.balance_due)), true));
  if (pre.notes) {
    lines.push(divider());
    lines.push(left(`Note: ${pre.notes}`));
  }
  lines.push(divider());
  lines.push(center('Please bring this slip on the day of order.', false, 'sm'));
  lines.push({ type: 'text', value: '\n\n\n', style: { 'font-family': 'monospace' } });

  const opts: any = {
    preview: false,
    margin: '0 0 0 0',
    copies: 1,
    printerName: printerName || undefined,
    timeOutPerLine: 400,
    pageSize: '80mm',
    silent: true,
  };
  await PosPrinter.print(lines, opts);
}

export type SlipDaySummary = {
  date: string;
  totals: { bills: number; revenue: number; plates: number };
  byMode: Array<{ mode: string; amt: number }>;
  byMeal: Array<{ meal_type: string; bills: number; revenue: number }>;
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
  lines.push(left(pad('Bills', String(s.totals.bills))));
  lines.push(left(pad('Bill revenue', formatINR(s.totals.revenue))));
  lines.push(left(pad('Plates', s.totals.plates.toFixed(1))));
  lines.push(left(pad('Pre-order payments', formatINR(s.preorderPaid))));
  lines.push(left(pad('TOTAL COLLECTED', formatINR(s.totalCollected)), true));
  lines.push(divider());
  lines.push(left('By payment mode', true));
  for (const m of s.byMode) lines.push(left(pad(`  ${m.mode}`, formatINR(m.amt))));
  if (s.byMode.length === 0) lines.push(left('  (none)'));
  lines.push(divider());
  lines.push(left('By meal', true));
  for (const m of s.byMeal)
    lines.push(left(pad(`  ${m.meal_type} (${m.bills})`, formatINR(m.revenue))));
  lines.push(divider());
  lines.push(left('Items sold', true));
  for (const it of s.items) lines.push(left(pad(`  ${it.name.slice(0, 18)} x${it.qty}`, formatINR(it.revenue))));
  if (s.items.length === 0) lines.push(left('  (none)'));
  if (s.cancelled.length > 0) {
    lines.push(divider());
    lines.push(left(pad(`Cancelled (${s.cancelled.length})`, '-' + formatINR(s.cancelledTotal)), true));
  }
  lines.push(divider());
  lines.push(center('End of day', false, 'sm'));
  lines.push({ type: 'text', value: '\n\n\n', style: { 'font-family': 'monospace' } });

  const opts: any = {
    preview: false,
    margin: '0 0 0 0',
    copies: 1,
    printerName: printerName || undefined,
    timeOutPerLine: 400,
    pageSize: '80mm',
    silent: true,
  };
  await PosPrinter.print(lines, opts);
}

export async function printTestSlip(printerName: string): Promise<void> {
  const lines: any[] = [
    {
      type: 'text',
      value: 'TEST PRINT',
      style: { 'text-align': 'center', 'font-weight': '900', 'font-size': '20px', 'font-family': FONT },
    },
    {
      type: 'text',
      value: 'If you can read this, the printer is connected.',
      style: { 'text-align': 'center', 'font-weight': 'bold', 'font-size': '12px', 'font-family': FONT },
    },
    { type: 'text', value: '\n\n\n', style: { 'font-family': FONT } },
  ];
  const opts: any = {
    preview: false,
    margin: '0 0 0 0',
    copies: 1,
    printerName: printerName || undefined,
    timeOutPerLine: 400,
    pageSize: '80mm',
    silent: true,
  };
  await PosPrinter.print(lines, opts);
}
