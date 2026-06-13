import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { MealType, MenuItem, PaymentMode, Preorder } from '../types';

type Item = {
  menu_item_id: number | null;
  name: string;
  qty: number;
  unit_price: number;
  is_custom: boolean;
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-stone-100 text-stone-700',
  partial: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-800',
  fulfilled: 'bg-sky-100 text-sky-800',
  cancelled: 'bg-rose-100 text-rose-800',
};

export default function CustomOrdersPage() {
  const { menu } = useStore();
  const [list, setList] = useState<Preorder[]>([]);
  const [creating, setCreating] = useState(false);

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
  const [items, setItems] = useState<Item[]>([]);
  const [advance, setAdvance] = useState<number>(0);
  const [advanceMode, setAdvanceMode] = useState<PaymentMode>('cash');

  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState<number>(0);
  const [menuFilter, setMenuFilter] = useState('');

  const total = items.reduce((s, i) => s + i.qty * i.unit_price, 0);

  async function refresh() {
    const r = await api.preorders.list({ from, to, status: statusFilter });
    if (r?.ok) setList(r.preorders);
  }
  useEffect(() => {
    refresh();
  }, [from, to, statusFilter]);

  function addMenu(m: MenuItem) {
    const idx = items.findIndex((i) => i.menu_item_id === m.id);
    const price = mealType === 'lunch' ? m.lunch_price : m.dinner_price;
    if (idx >= 0) {
      const next = items.slice();
      next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
      setItems(next);
    } else {
      setItems([
        ...items,
        { menu_item_id: m.id, name: m.name, qty: 1, unit_price: price, is_custom: false },
      ]);
    }
  }
  function addCustom() {
    if (!customName || customPrice <= 0) return;
    setItems([
      ...items,
      { menu_item_id: null, name: customName, qty: 1, unit_price: customPrice, is_custom: true },
    ]);
    setCustomName('');
    setCustomPrice(0);
  }

  function setQty(idx: number, qty: number) {
    if (qty <= 0) setItems(items.filter((_, i) => i !== idx));
    else {
      const next = items.slice();
      next[idx] = { ...next[idx], qty };
      setItems(next);
    }
  }

  async function save() {
    if (!customerName || items.length === 0 || !forDate) {
      alert('Customer name, date, and at least one item required.');
      return;
    }
    const r = await api.preorders.create({
      customer_name: customerName,
      customer_mobile: mobile || undefined,
      for_date: forDate,
      for_time: forTime || undefined,
      meal_type: mealType || undefined,
      notes: notes || undefined,
      items,
      advance: advance > 0 ? { amount: advance, mode: advanceMode } : null,
    });
    if (r?.ok) {
      // print receipt right away
      await api.preorders.printReceipt(r.id);
      setCreating(false);
      setCustomerName('');
      setMobile('');
      setForTime('');
      setNotes('');
      setItems([]);
      setAdvance(0);
      await refresh();
    } else {
      alert(r?.error || 'Save failed');
    }
  }

  const visibleMenu = useMemo(() => {
    const q = menuFilter.trim().toLowerCase();
    return menu.filter((m) => m.in_stock && m.active).filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [menu, menuFilter]);

  if (creating) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button className="btn-ghost border border-stone-300" onClick={() => setCreating(false)}>
            ← Back
          </button>
          <h1 className="text-xl font-bold">New pre-order</h1>
          <button className="btn-primary ml-auto" onClick={save}>
            Save & print receipt
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_24rem]">
          <div className="card space-y-3 p-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-stone-600">Customer name</label>
                <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
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
                <input
                  type="time"
                  className="input"
                  value={forTime}
                  onChange={(e) => setForTime(e.target.value)}
                />
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
              <div className="mb-2 flex items-center gap-2">
                <input
                  className="input"
                  placeholder="Search menu"
                  value={menuFilter}
                  onChange={(e) => setMenuFilter(e.target.value)}
                />
              </div>
              <div className="grid max-h-48 grid-cols-2 gap-2 overflow-auto sm:grid-cols-3">
                {visibleMenu.map((m) => (
                  <button
                    key={m.id}
                    className="rounded border border-stone-200 p-2 text-left text-sm hover:bg-stone-50"
                    onClick={() => addMenu(m)}
                  >
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-stone-500">
                      L ₹{m.lunch_price} · D ₹{m.dinner_price}
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-[1fr_8rem_auto] gap-2">
                <input
                  className="input"
                  placeholder="Custom item"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                />
                <input
                  className="input"
                  type="number"
                  placeholder="Price"
                  value={customPrice || ''}
                  onChange={(e) => setCustomPrice(parseFloat(e.target.value) || 0)}
                />
                <button className="btn-ghost border border-stone-300" onClick={addCustom}>
                  + Add custom
                </button>
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
                    <option value="card">card</option>
                    <option value="other">other</option>
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">Pre-orders / Custom orders</h1>
        <button className="btn-primary ml-auto" onClick={() => setCreating(true)}>
          + New pre-order
        </button>
      </div>
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
            {list.map((p) => (
              <tr key={p.id} className="border-t border-stone-100">
                <td className="p-2">{p.order_no ?? p.id}</td>
                <td className="p-2">
                  {p.customer_name}
                  {p.customer_mobile ? <div className="text-xs text-stone-500">{p.customer_mobile}</div> : null}
                </td>
                <td className="p-2">
                  {p.for_date} {p.for_time || ''} {p.meal_type ? `· ${p.meal_type}` : ''}
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
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => api.preorders.printReceipt(p.id)}
                  >
                    Reprint
                  </button>
                </td>
              </tr>
            ))}
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
    </div>
  );
}
