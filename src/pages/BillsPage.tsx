import React, { useEffect, useState } from 'react';
import { api } from '../api';
import ReasonModal from '../components/ReasonModal';
import { fmtDateTime } from '../format';

type Row = {
  id: number;
  token_no: number | null;
  type: string;
  status: string;
  meal_type: string;
  total: number;
  plates: number;
  opened_at: string;
  closed_at: string | null;
  customer_name: string | null;
  customer_mobile: string | null;
  table_label: string | null;
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export default function BillsPage() {
  const today = ymd(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<string>('');
  const [type, setType] = useState<string>('');
  const [meal, setMeal] = useState<string>('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [voiding, setVoiding] = useState<Row | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [details, setDetails] = useState<
    Record<
      number,
      {
        items: Array<{ name: string; qty: number; unit_price: number; total: number }>;
        payments: Array<{ amount: number; mode: string }>;
      }
    >
  >({});

  async function refresh() {
    const r = await api.bills.list({ from, to, status, q, type, meal_type: meal });
    if (r?.ok) setRows(r.bills);
  }

  async function toggle(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!details[id]) {
      const r = await api.bills.get(id);
      if (r?.ok)
        setDetails((d) => ({
          ...d,
          [id]: { items: r.bill.items || [], payments: r.bill.payments || [] },
        }));
    }
  }
  useEffect(() => {
    refresh();
  }, [from, to, status, type, meal]);

  async function doVoid(reason: string) {
    if (!voiding) return;
    const r = await api.bills.void(voiding.id, reason);
    setVoiding(null);
    if (r?.ok) {
      setMsg(`${voiding.token_no ? `Token ${voiding.token_no}` : 'Bill'} voided.`);
      await refresh();
    } else {
      setMsg(r?.error || 'Void failed');
    }
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Bills</h1>
      {msg && (
        <div className="rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-700">{msg}</div>
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
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Closed + voided</option>
            <option value="closed">Closed only</option>
            <option value="voided">Voided only</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-stone-600">Type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            <option value="dine_in">Dine-in</option>
            <option value="takeaway">Takeaway</option>
            <option value="preorder_fulfillment">Pre-order</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-stone-600">Meal</label>
          <select className="input" value={meal} onChange={(e) => setMeal(e.target.value)}>
            <option value="">All</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs text-stone-600">Search (token / customer)</label>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && refresh()} />
        </div>
        <button className="btn-ghost border border-stone-300" onClick={refresh}>
          Refresh
        </button>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-left">
            <tr>
              <th className="p-2">Token</th>
              <th className="p-2">When</th>
              <th className="p-2">Type</th>
              <th className="p-2">Table</th>
              <th className="p-2">Customer</th>
              <th className="p-2">Total</th>
              <th className="p-2">Status</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <React.Fragment key={r.id}>
              <tr
                className="cursor-pointer border-t border-stone-100 hover:bg-stone-50"
                onClick={() => toggle(r.id)}
              >
                <td className="p-2">
                  <span className="mr-1 inline-block text-stone-400">
                    {expandedId === r.id ? '▾' : '▸'}
                  </span>
                  {r.token_no ?? '—'}
                </td>
                <td className="p-2">{fmtDateTime(r.closed_at || r.opened_at)}</td>
                <td className="p-2">{r.type}</td>
                <td className="p-2">{r.table_label ?? '—'}</td>
                <td className="p-2">{r.customer_name ?? '—'}</td>
                <td className="p-2 font-medium">₹{r.total.toFixed(2)}</td>
                <td className="p-2">
                  {r.status === 'cancelled' ? (
                    <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
                      voided
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      closed
                    </span>
                  )}
                </td>
                <td className="p-2 text-right" onClick={(e) => e.stopPropagation()}>
                  {r.status === 'closed' && (
                    <>
                      <button
                        className="btn-ghost text-xs"
                        onClick={async () => {
                          const res = await api.bills.reprint(r.id);
                          setMsg(res?.ok ? `Token ${r.token_no} reprinted.` : res?.error || 'Print failed');
                        }}
                      >
                        Reprint
                      </button>
                      <button
                        className="btn-ghost text-xs text-rose-700"
                        onClick={() => setVoiding(r)}
                      >
                        Void
                      </button>
                    </>
                  )}
                </td>
              </tr>
              {expandedId === r.id && (
                <tr className="border-t border-stone-100 bg-stone-50/60">
                  <td colSpan={8} className="px-4 py-3">
                    {details[r.id] ? (
                      <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
                            Items
                          </div>
                          {details[r.id].items.length === 0 ? (
                            <div className="text-sm text-stone-500">No items.</div>
                          ) : (
                            <table className="w-full text-sm">
                              <tbody>
                                {details[r.id].items.map((it, i) => (
                                  <tr key={i} className="border-b border-stone-100 last:border-0">
                                    <td className="py-1">{it.name}</td>
                                    <td className="py-1 text-right tabular-nums text-stone-500">
                                      {it.qty} × ₹{it.unit_price.toFixed(2)}
                                    </td>
                                    <td className="py-1 pl-3 text-right tabular-nums">
                                      ₹{it.total.toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                        <div className="text-sm">
                          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
                            Payments
                          </div>
                          {details[r.id].payments.length === 0 ? (
                            <div className="text-stone-500">—</div>
                          ) : (
                            details[r.id].payments.map((p, i) => (
                              <div key={i} className="flex justify-between">
                                <span className="text-stone-600">{p.mode}</span>
                                <span className="tabular-nums">₹{p.amount.toFixed(2)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-stone-500">Loading…</div>
                    )}
                  </td>
                </tr>
              )}
              </React.Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-stone-500">
                  No bills in range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {voiding && (
        <ReasonModal
          title={`Void ${voiding.token_no ? `token ${voiding.token_no}` : 'this bill'}?`}
          message={`This reverses a finalized sale of ₹${voiding.total.toFixed(2)}. It will be removed from revenue and the day summary, and listed under cancelled bills.`}
          reasonLabel="Reason for voiding (required)"
          reasonRequired
          confirmLabel="Void bill"
          cancelLabel="Keep bill"
          onConfirm={doVoid}
          onClose={() => setVoiding(null)}
        />
      )}
    </div>
  );
}
