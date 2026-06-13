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

function pad(left: string, right: string, width = 32): string {
  const space = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

function buildBillData(shop: SlipShop, bill: SlipBill, copyLabel: string): any[] {
  const lines: any[] = [];
  const center = (text: string, bold = false, size: 'lg' | 'md' | 'sm' = 'md') => ({
    type: 'text',
    value: text,
    style: {
      'text-align': 'center',
      'font-weight': bold ? 'bold' : 'normal',
      'font-size': size === 'lg' ? '20px' : size === 'md' ? '14px' : '11px',
      'font-family': 'monospace',
    },
  });
  const left = (text: string, bold = false) => ({
    type: 'text',
    value: text,
    style: {
      'text-align': 'left',
      'font-weight': bold ? 'bold' : 'normal',
      'font-size': '12px',
      'font-family': 'monospace',
      'white-space': 'pre',
    },
  });
  const divider = () => ({
    type: 'text',
    value: '--------------------------------',
    style: { 'font-family': 'monospace', 'font-size': '12px' },
  });

  lines.push(center(shop.name, true, 'lg'));
  if (shop.address) lines.push(center(shop.address, false, 'sm'));
  if (shop.phone) lines.push(center(shop.phone, false, 'sm'));
  if (shop.gst) lines.push(center(`GST: ${shop.gst}`, false, 'sm'));
  lines.push(center(copyLabel, true, 'sm'));
  lines.push(divider());

  if (bill.token_no != null) lines.push(left(`Token #${bill.token_no}`, true));
  lines.push(left(`Bill : ${bill.id}`));
  lines.push(left(`Type : ${bill.type}${bill.table_label ? ' • ' + bill.table_label : ''}`));
  lines.push(left(`Meal : ${bill.meal_type}`));
  lines.push(left(`Time : ${(bill.closed_at || bill.opened_at).replace('T', ' ').slice(0, 16)}`));
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

  const labels =
    copies <= 1 ? ['Customer Copy'] : ['Customer Copy', 'Manager Copy'];
  for (const label of labels) {
    const data = buildBillData(shop, bill, label);
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
  const center = (text: string, bold = false, size: 'lg' | 'md' | 'sm' = 'md') => ({
    type: 'text',
    value: text,
    style: {
      'text-align': 'center',
      'font-weight': bold ? 'bold' : 'normal',
      'font-size': size === 'lg' ? '20px' : size === 'md' ? '14px' : '11px',
      'font-family': 'monospace',
    },
  });
  const left = (text: string, bold = false) => ({
    type: 'text',
    value: text,
    style: {
      'text-align': 'left',
      'font-weight': bold ? 'bold' : 'normal',
      'font-size': '12px',
      'font-family': 'monospace',
      'white-space': 'pre',
    },
  });
  const divider = () => ({
    type: 'text',
    value: '--------------------------------',
    style: { 'font-family': 'monospace', 'font-size': '12px' },
  });

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

export async function printTestSlip(printerName: string): Promise<void> {
  const lines: any[] = [
    {
      type: 'text',
      value: 'TEST PRINT',
      style: { 'text-align': 'center', 'font-weight': 'bold', 'font-size': '20px', 'font-family': 'monospace' },
    },
    {
      type: 'text',
      value: 'If you can read this, the printer is connected.',
      style: { 'text-align': 'center', 'font-size': '12px', 'font-family': 'monospace' },
    },
    { type: 'text', value: '\n\n\n', style: { 'font-family': 'monospace' } },
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
