import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { MealType, PaymentMode, Preorder } from '../types';
import ReasonModal from '../components/ReasonModal';
import MenuGrid from '../components/MenuGrid';
import { addToItems } from '../components/BillEditor';
import type { EditorItem } from '../components/BillItemList';
import CashChangeModal from '../components/CashChangeModal';
import TimePicker from '../components/TimePicker';
import BillItemList from '../components/BillItemList';
import { fmtDate } from '../format';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-stone-100 text-stone-700',
  partial: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-800',
  fulfilled: 'bg-sky-100 text-sky-800',
  cancelled: 'bg-rose-100 text-rose-800',
};

// Local calendar date as YYYY-MM-DD (for_date is stored in this shape).
function localToday(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(
    n.getDate()
  ).padStart(2, '0')}`;
}

export default function CustomOrdersPage() {
  const { menu, session } = useStore();
  const [list, setList] = useState<Preorder[]>([]);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [formMsg, setFormMsg] = useState<string | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // create form state
  const [customerName, setCustomerName] = useState('');
  const [mobile, setMobile] = useState('');
  const [forDate, setForDate] = useState(new Date().toISOString().slice(0, 10));
  const [forTime, setForTime] = useState('');
  const [mealType, setMealType] = useState<MealType | ''>('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<EditorItem[]>([]);
  const [advance, setAdvance] = useState<number>(0);
  const [advanceMode, setAdvanceMode] = useState<PaymentMode>('cash');

  const total = items.reduce((s, i) => s + i.qty * i.unit_price, 0);

  async function refresh() {
    const r = await api.preorders.list({ from, to, status: statusFilter });
    if (r?.ok) setList(r.preorders);
  }
  useEffect(() => {
    refresh();
  }, [from, to, statusFilter]);

  function setQty(idx: number, qty: number) {
    if (qty <= 0) setItems(items.filter((_, i) => i !== idx));
    else {
      const next = items.slice();
      next[idx] = { ...next[idx], qty };
      setItems(next);
    }
  }

  async function save(print: boolean) {
    if (!customerName || items.length === 0 || !forDate) {
      setFormMsg('Customer name, date, and at least one item required.');
      return;
    }
    setFormMsg(null);
    const r = await api.preorders.create({
      customer_name: customerName,
      customer_mobile: mobile || undefined,
      for_date: forDate,
      for_time: forTime || undefined,
      meal_type: mealType || undefined,
      notes: notes || undefined,
      items: items.map(({ menu_item_id, name, qty, unit_price, is_custom }) => ({
        menu_item_id,
        name,
        qty,
        unit_price,
        is_custom,
      })),
      advance: advance > 0 ? { amount: advance, mode: advanceMode } : null,
    });
    if (r?.ok) {
      if (print) await api.preorders.printReceipt(r.id);
      setCreating(false);
      setCustomerName('');
      setMobile('');
      setForTime('');
      setNotes('');
      setItems([]);
      setAdvance(0);
      await refresh();
    } else {
      setFormMsg(r?.error || 'Save failed');
    }
  }

  if (creating) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button className="btn-ghost border border-stone-300" onClick={() => setCreating(false)}>
            ← Back
          </button>
          <h1 className="text-xl font-bold">New pre-order</h1>
          <button className="btn-ghost ml-auto border border-stone-300" onClick={() => save(false)}>
            Save
          </button>
          <button className="btn-primary" onClick={() => save(true)}>
            Save &amp; print receipt
          </button>
        </div>
        {formMsg && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{formMsg}</div>
        )}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_24rem]">
          <div className="card space-y-3 p-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-stone-600">Customer name</label>
                <input
                  className="input"
                  autoFocus
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-stone-600">Mobile</label>
                <input className="input" value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-stone-600">For date</label>
                <input
                  type="date"
                  className="input"
                  value={forDate}
                  onChange={(e) => setForDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-stone-600">For time</label>
                <TimePicker value={forTime} onChange={setForTime} />
              </div>
              <div>
                <label className="text-xs text-stone-600">Meal</label>
                <select
                  className="input"
                  value={mealType}
                  onChange={(e) => setMealType(e.target.value as MealType | '')}
                >
                  <option value="">—</option>
                  <option value="lunch">lunch</option>
                  <option value="dinner">dinner</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-stone-600">Notes</label>
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>

            <div className="border-t border-stone-200 pt-3">
              <div className="h-72">
                <MenuGrid
                  menu={menu}
                  mealType={(mealType as MealType) || 'dinner'}
                  showMealToggle={false}
                  onAdd={(item) => setItems((cur) => addToItems(cur, item))}
                />
              </div>
            </div>
          </div>

          <div className="card flex flex-col">
            <div className="border-b border-stone-200 p-2 text-sm font-semibold">
              Items ({items.length})
            </div>
            <ul className="flex-1 divide-y divide-stone-100 overflow-auto">
              {items.map((it, idx) => (
                <li key={idx} className="flex items-center gap-2 p-2 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">{it.name}</div>
                    <div className="text-xs text-stone-500">
                      ₹{it.unit_price} × {it.qty} = ₹{(it.qty * it.unit_price).toFixed(2)}
                    </div>
                  </div>
                  <button
                    className="rounded-md border border-stone-300 px-2"
                    onClick={() => setQty(idx, it.qty - 1)}
                  >
                    −
                  </button>
                  <span className="w-6 text-center">{it.qty}</span>
                  <button
                    className="rounded-md border border-stone-300 px-2"
                    onClick={() => setQty(idx, it.qty + 1)}
                  >
                    +
                  </button>
                </li>
              ))}
            </ul>
            <div className="space-y-2 border-t border-stone-200 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-stone-600">Total</span>
                <span className="text-2xl font-bold text-brand-700">₹{total.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-stone-600">Advance</label>
                  <input
                    type="number"
                    className="input"
                    value={advance}
                    onChange={(e) => setAdvance(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="text-xs text-stone-600">Mode</label>
                  <select
                    className="input"
                    value={advanceMode}
                    onChange={(e) => setAdvanceMode(e.target.value as PaymentMode)}
                  >
                    <option value="cash">cash</option>
                    <option value="upi">upi</option>
                  </select>
                </div>
              </div>
              <div className="text-sm text-stone-600">
                Balance due: <strong>₹{Math.max(0, total - advance).toFixed(2)}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const today = localToday();
  const dueToday = list.filter(
    (p) => p.for_date === today && p.status !== 'fulfilled' && p.status !== 'cancelled'
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">Pre-orders / Custom orders</h1>
        <button className="btn-primary ml-auto" onClick={() => setCreating(true)}>
          + New pre-order
        </button>
      </div>
      {dueToday > 0 && (
        <div className="rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900">
          {dueToday} pre-order{dueToday === 1 ? '' : 's'} due today — highlighted below.
        </div>
      )}
      <div className="card flex flex-wrap items-end gap-2 p-3">
        <div>
          <label className="text-xs text-stone-600">From</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-stone-600">To</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-stone-600">Status</label>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="pending">pending</option>
            <option value="partial">partial</option>
            <option value="paid">paid</option>
            <option value="fulfilled">fulfilled</option>
            <option value="cancelled">cancelled</option>
          </select>
        </div>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-left">
            <tr>
              <th className="p-2">#</th>
              <th className="p-2">Customer</th>
              <th className="p-2">For</th>
              <th className="p-2">Total</th>
              <th className="p-2">Advance</th>
              <th className="p-2">Balance</th>
              <th className="p-2">Status</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const isDueToday =
                p.for_date === today && p.status !== 'fulfilled' && p.status !== 'cancelled';
              return (
              <tr
                key={p.id}
                className={`border-t border-stone-100 ${isDueToday ? 'bg-amber-50' : ''}`}
              >
                <td className="p-2">{p.order_no ?? p.id}</td>
                <td className="p-2">
                  {p.customer_name}
                  {p.customer_mobile ? <div className="text-xs text-stone-500">{p.customer_mobile}</div> : null}
                </td>
                <td className="p-2">
                  {p.for_date} {p.for_time || ''} {p.meal_type ? `· ${p.meal_type}` : ''}
                  {isDueToday && (
                    <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                      DUE TODAY
                    </span>
                  )}
                </td>
                <td className="p-2">₹{p.total.toFixed(2)}</td>
                <td className="p-2">₹{p.advance_paid.toFixed(2)}</td>
                <td className="p-2">₹{p.balance_due.toFixed(2)}</td>
                <td className="p-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[p.status] ?? ''}`}>
                    {p.status}
                  </span>
                </td>
                <td className="p-2 text-right">
                  <button className="btn-ghost text-xs" onClick={() => setDetailId(p.id)}>
                    Manage
                  </button>
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => api.preorders.printReceipt(p.id)}
                  >
                    Reprint
                  </button>
                </td>
              </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-stone-500">
                  No pre-orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detailId != null && (
        <PreorderDetail
          id={detailId}
          isAdmin={session?.role === 'admin'}
          onClose={() => setDetailId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function PreorderDetail({
  id,
  isAdmin,
  onClose,
  onChanged,
}: {
  id: number;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const { menu } = useStore();
  const [data, setData] = useState<{ preorder: any; items: any[]; payments: any[] } | null>(null);
  const [payMode, setPayMode] = useState<PaymentMode>('cash');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'overview' | 'edit'>('overview');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editItems, setEditItems] = useState<EditorItem[]>([]);
  const [advDraft, setAdvDraft] = useState(0);
  const [advMode, setAdvMode] = useState<PaymentMode>('cash');
  const [edit, setEdit] = useState({
    customer_name: '',
    customer_mobile: '',
    for_date: '',
    for_time: '',
    meal_type: '' as '' | 'lunch' | 'dinner',
    notes: '',
  });
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await api.preorders.get(id);
    if (r?.ok) {
      setData({ preorder: r.preorder, items: r.items, payments: r.payments });
      setEdit({
        customer_name: r.preorder.customer_name || '',
        customer_mobile: r.preorder.customer_mobile || '',
        for_date: r.preorder.for_date || '',
        for_time: r.preorder.for_time || '',
        meal_type: (r.preorder.meal_type || '') as '' | 'lunch' | 'dinner',
        notes: r.preorder.notes || '',
      });
      setEditItems(
        r.items.map((it: any) => ({
          menu_item_id: it.menu_item_id,
          name: it.name,
          qty: it.qty,
          unit_price: it.unit_price,
          plate_weight: 0,
          is_custom: !!it.is_custom,
        }))
      );
      setAdvDraft(+r.preorder.advance_paid.toFixed(2));
      setAdvMode((r.payments[0]?.mode as PaymentMode) || 'cash');
    } else setErr(r?.error || 'Not found');
  }

  async function saveDetails() {
    setBusy(true);
    setErr(null);
    const r = await api.preorders.update(id, edit);
    setBusy(false);
    if (!r?.ok) return setErr(r?.error || 'Failed to save changes');
    setTab('overview');
    await load();
    await onChanged();
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveItems() {
    if (editItems.length === 0) return setErr('A pre-order needs at least one item');
    setBusy(true);
    setErr(null);
    const r = await api.preorders.setItems(
      id,
      editItems.map((e) => ({
        menu_item_id: e.menu_item_id,
        name: e.name,
        qty: e.qty,
        unit_price: e.unit_price,
        is_custom: e.is_custom,
      }))
    );
    setBusy(false);
    if (!r?.ok) return setErr(r?.error || 'Failed to save items');
    setShowAdd(false);
    await load();
    await onChanged();
  }

  async function saveAdvance() {
    setBusy(true);
    setErr(null);
    const r = await api.preorders.setAdvance(id, advDraft, advMode);
    setBusy(false);
    if (!r?.ok) return setErr(r?.error || 'Failed to update advance');
    await load();
    await onChanged();
  }

  const balance = data ? Math.max(0, +data.preorder.balance_due.toFixed(2)) : 0;

  // Fulfillment collects the remaining balance (mandatory) and then marks the
  // order fulfilled. Cash routes through the change calculator first.
  function startFulfill() {
    setErr(null);
    if (balance <= 0) {
      setFulfillOpen(true); // nothing to collect — just confirm
    } else if (payMode === 'cash') {
      setCashOpen(true);
    } else {
      void payAndFulfill('upi');
    }
  }

  async function payAndFulfill(mode: PaymentMode, notes?: string) {
    setBusy(true);
    setErr(null);
    if (balance > 0) {
      const pr = await api.preorders.addPayment(id, { amount: balance, mode, notes });
      if (!pr?.ok) {
        setBusy(false);
        return setErr(pr?.error || 'Payment failed');
      }
    }
    const fr = await api.preorders.fulfill(id, null);
    setBusy(false);
    if (!fr?.ok) return setErr(fr?.error || 'Failed to fulfill');
    await load();
    await onChanged();
  }

  async function fulfillNoBalance() {
    setFulfillOpen(false);
    await payAndFulfill(payMode);
  }

  async function cancel(reason: string) {
    setCancelOpen(false);
    setBusy(true);
    setErr(null);
    const r = await api.preorders.cancel(id, reason);
    setBusy(false);
    if (!r?.ok) return setErr(r?.error || 'Failed');
    await load();
    await onChanged();
  }

  const p = data?.preorder;
  const terminal = p && (p.status === 'fulfilled' || p.status === 'cancelled');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Pre-order #{p?.order_no ?? id}
            {p && (
              <span
                className={`ml-2 align-middle rounded px-2 py-0.5 text-xs ${STATUS_COLORS[p.status] ?? ''}`}
              >
                {p.status}
              </span>
            )}
          </h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        {err && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}

        {!p ? (
          <div className="text-sm text-stone-500">Loading…</div>
        ) : (
          <>
            {!terminal && (
              <div className="flex gap-1 border-b border-stone-200 text-sm">
                {(['overview', 'edit'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 px-3 py-1.5 ${
                      tab === t
                        ? 'border-brand-600 font-semibold text-brand-700'
                        : 'border-transparent text-stone-600'
                    }`}
                  >
                    {t === 'overview' ? 'Overview' : 'Edit / manage'}
                  </button>
                ))}
              </div>
            )}

            {(terminal || tab === 'overview') && (
              <>
            <div className="text-sm text-stone-700">
              <div>
                <strong>{p.customer_name}</strong>
                {p.customer_mobile ? ` · ${p.customer_mobile}` : ''}
              </div>
              <div className="text-stone-500">
                For {p.for_date} {p.for_time || ''} {p.meal_type ? `· ${p.meal_type}` : ''}
              </div>
              {p.notes && <div className="text-stone-500">Note: {p.notes}</div>}
            </div>

            <div className="rounded-md border border-stone-200">
              <ul className="divide-y divide-stone-100 text-sm">
                {data!.items.map((it) => (
                  <li key={it.id} className="flex justify-between p-2">
                    <span>
                      {it.name} <span className="text-stone-400">× {it.qty}</span>
                    </span>
                    <span>₹{it.total.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between border-t border-stone-200 p-2 text-sm">
                <span className="text-stone-600">Total</span>
                <strong>₹{p.total.toFixed(2)}</strong>
              </div>
              <div className="flex justify-between px-2 pb-1 text-sm">
                <span className="text-stone-600">Advance paid</span>
                <span>₹{p.advance_paid.toFixed(2)}</span>
              </div>
              <div className="flex justify-between px-2 pb-2 text-sm">
                <span className="text-stone-600">Balance due</span>
                <strong className={p.balance_due > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                  ₹{p.balance_due.toFixed(2)}
                </strong>
              </div>
            </div>

            {data!.payments.length > 0 && (
              <div className="text-xs text-stone-500">
                <div className="mb-0.5 font-medium text-stone-600">Payments</div>
                {data!.payments.map((pay) => (
                  <div key={pay.id}>
                    {fmtDate(pay.received_at)} · ₹{pay.amount.toFixed(0)} ({pay.mode})
                  </div>
                ))}
              </div>
            )}

            {!terminal && (
              <div className="space-y-2 border-t border-stone-200 pt-3">
                <div className="text-sm font-medium">Fulfillment</div>
                {balance > 0 ? (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-stone-600">Balance to collect now</span>
                      <strong className="text-amber-700">₹{balance.toFixed(2)}</strong>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-stone-600">Pay by</span>
                      <div className="flex rounded-md border border-stone-300 bg-white p-0.5 text-sm">
                        {(['cash', 'upi'] as PaymentMode[]).map((m) => (
                          <button
                            key={m}
                            className={`rounded px-3 py-1 ${
                              payMode === m ? 'bg-brand-600 text-white' : 'text-stone-700'
                            }`}
                            onClick={() => setPayMode(m)}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                      <button className="btn-primary ml-auto" onClick={startFulfill} disabled={busy}>
                        Collect ₹{balance.toFixed(0)} &amp; fulfill
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-emerald-700">Fully paid — nothing to collect.</span>
                    <button className="btn-primary" onClick={startFulfill} disabled={busy}>
                      Mark fulfilled
                    </button>
                  </div>
                )}
              </div>
            )}
              </>
            )}

            {!terminal && tab === 'edit' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="col-span-2">
                    <label className="text-xs text-stone-600">Customer name</label>
                    <input
                      className="input"
                      value={edit.customer_name}
                      onChange={(e) => setEdit({ ...edit, customer_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-stone-600">Mobile</label>
                    <input
                      className="input"
                      value={edit.customer_mobile}
                      onChange={(e) => setEdit({ ...edit, customer_mobile: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-stone-600">Meal</label>
                    <select
                      className="input"
                      value={edit.meal_type}
                      onChange={(e) =>
                        setEdit({ ...edit, meal_type: e.target.value as '' | 'lunch' | 'dinner' })
                      }
                    >
                      <option value="">—</option>
                      <option value="lunch">lunch</option>
                      <option value="dinner">dinner</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-stone-600">For date</label>
                    <input
                      type="date"
                      className="input"
                      value={edit.for_date}
                      onChange={(e) => setEdit({ ...edit, for_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-stone-600">For time</label>
                    <TimePicker
                      value={edit.for_time}
                      onChange={(v) => setEdit({ ...edit, for_time: v })}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-stone-600">Notes</label>
                    <input
                      className="input"
                      value={edit.notes}
                      onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button className="btn-primary" onClick={saveDetails} disabled={busy}>
                    Save changes
                  </button>
                </div>

                {/* Items: edit qty/price, remove, or add */}
                <div className="space-y-2 border-t border-stone-200 pt-3">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">Items</div>
                    <button
                      className="btn-ghost ml-auto text-xs border border-stone-300"
                      onClick={() => setShowAdd((v) => !v)}
                    >
                      {showAdd ? 'Close menu' : '+ Add items'}
                    </button>
                  </div>
                  {showAdd && (
                    <div className="h-56">
                      <MenuGrid
                        menu={menu}
                        mealType={(p.meal_type as MealType) || 'dinner'}
                        showMealToggle={false}
                        onAdd={(item) => setEditItems((cur) => addToItems(cur, item))}
                      />
                    </div>
                  )}
                  <div className="max-h-56 overflow-auto">
                    <BillItemList items={editItems} onChange={setEditItems} title="Order items" />
                  </div>
                  <div className="flex justify-end">
                    <button
                      className="btn-primary"
                      onClick={saveItems}
                      disabled={busy || editItems.length === 0}
                    >
                      Save items
                    </button>
                  </div>
                </div>

                {/* Advance correction (counted on the placement day) */}
                <div className="space-y-2 border-t border-stone-200 pt-3">
                  <div className="text-sm font-medium">Advance</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      className="input w-28"
                      value={advDraft || ''}
                      onChange={(e) => setAdvDraft(Math.max(0, parseFloat(e.target.value) || 0))}
                    />
                    <div className="flex rounded-md border border-stone-300 bg-white p-0.5 text-sm">
                      {(['cash', 'upi'] as PaymentMode[]).map((m) => (
                        <button
                          key={m}
                          className={`rounded px-3 py-1 ${
                            advMode === m ? 'bg-brand-600 text-white' : 'text-stone-700'
                          }`}
                          onClick={() => setAdvMode(m)}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <button className="btn-primary ml-auto" onClick={saveAdvance} disabled={busy}>
                      Update advance
                    </button>
                  </div>
                  <p className="text-xs text-stone-500">Counted on the order's placement day.</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-stone-200 pt-3">
              <button className="btn-ghost border border-stone-300" onClick={() => api.preorders.printReceipt(id)}>
                Reprint receipt
              </button>
              {!terminal && isAdmin && (
                <button
                  className="btn-ghost text-rose-700"
                  onClick={() => setCancelOpen(true)}
                  disabled={busy}
                >
                  Cancel order
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {cancelOpen && (
        <ReasonModal
          title={`Cancel pre-order #${p?.order_no ?? id}?`}
          message="This marks the pre-order cancelled. This cannot be undone."
          confirmLabel="Cancel order"
          cancelLabel="Keep order"
          onConfirm={cancel}
          onClose={() => setCancelOpen(false)}
        />
      )}

      {fulfillOpen && (
        <ReasonModal
          title={`Mark pre-order #${p?.order_no ?? id} fulfilled?`}
          message="Fully paid — marks the order delivered/collected."
          showReason={false}
          danger={false}
          confirmLabel="Mark fulfilled"
          cancelLabel="Not yet"
          onConfirm={fulfillNoBalance}
          onClose={() => setFulfillOpen(false)}
        />
      )}

      {cashOpen && (
        <CashChangeModal
          total={balance}
          onCancel={() => setCashOpen(false)}
          onConfirm={(received, change) => {
            setCashOpen(false);
            void payAndFulfill('cash', `cash ₹${received}, change ₹${change}`);
          }}
        />
      )}
    </div>
  );
}
