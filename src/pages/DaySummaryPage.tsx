import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtDateTime } from '../format';

type Summary = {
  date: string;
  totals: { bills: number; revenue: number; plates: number };
  byMode: Array<{ mode: string; amt: number }>;
  byMeal: Array<{ meal_type: string; bills: number; revenue: number }>;
  items: Array<{ name: string; qty: number; revenue: number }>;
  preorderPaid: number;
  totalCollected: number;
  cancelled: Array<{
    id: number;
    token_no: number | null;
    total: number;
    cancel_reason: string | null;
    cancelled_at: string | null;
  }>;
  cancelledTotal: number;
};

export default function DaySummaryPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [data, setData] = useState<Summary | null>(null);
  const [printMsg, setPrintMsg] = useState<string | null>(null);

  async function refresh() {
    const r = await api.daySummary(date);
    if (r?.ok) setData(r);
  }
  useEffect(() => {
    refresh();
  }, [date]);

  async function print() {
    const r = await api.daySummaryPrint(date);
    setPrintMsg(r?.ok ? 'Sent to printer.' : r?.error || 'Print failed');
    setTimeout(() => setPrintMsg(null), 3000);
  }

  function shiftDay(days: number) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  }

  if (!data) return <div>Loading…</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">Day Summary</h1>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-ghost border border-stone-300" onClick={() => shiftDay(-1)}>
            ← Prev
          </button>
          <input
            type="date"
            className="input w-40"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button
            className="btn-ghost border border-stone-300"
            onClick={() => shiftDay(1)}
            disabled={date >= today}
          >
            Next →
          </button>
          <button className="btn-ghost border border-stone-300" onClick={() => setDate(today)}>
            Today
          </button>
          <button className="btn-primary" onClick={print}>
            Print
          </button>
        </div>
      </div>
      {printMsg && (
        <div className="rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-700">{printMsg}</div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KPI label="Bills" value={data.totals.bills} />
        <KPI label="Bill revenue" value={`₹${data.totals.revenue.toFixed(2)}`} />
        <KPI label="Plates" value={data.totals.plates.toFixed(1)} />
        <KPI label="Pre-order payments" value={`₹${(data.preorderPaid ?? 0).toFixed(2)}`} />
        <KPI label="Total collected" value={`₹${(data.totalCollected ?? data.totals.revenue).toFixed(2)}`} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="card p-3">
          <div className="mb-2 text-sm font-semibold">
            By payment mode <span className="font-normal text-stone-500">(bills + advances)</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr>
                <th className="p-1">Mode</th>
                <th className="p-1">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.byMode.map((m) => (
                <tr key={m.mode} className="border-t border-stone-100">
                  <td className="p-1 capitalize">{m.mode}</td>
                  <td className="p-1">₹{m.amt.toFixed(2)}</td>
                </tr>
              ))}
              {data.byMode.length === 0 && (
                <tr>
                  <td colSpan={2} className="p-2 text-stone-500">
                    No payments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card p-3">
          <div className="mb-2 text-sm font-semibold">By meal</div>
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr>
                <th className="p-1">Meal</th>
                <th className="p-1">Bills</th>
                <th className="p-1">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.byMeal.map((m) => (
                <tr key={m.meal_type} className="border-t border-stone-100">
                  <td className="p-1 capitalize">{m.meal_type}</td>
                  <td className="p-1">{m.bills}</td>
                  <td className="p-1">₹{m.revenue.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-3">
        <div className="mb-2 text-sm font-semibold">Items sold</div>
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500">
            <tr>
              <th className="p-1">Item</th>
              <th className="p-1">Qty</th>
              <th className="p-1">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.name} className="border-t border-stone-100">
                <td className="p-1">{it.name}</td>
                <td className="p-1">{it.qty}</td>
                <td className="p-1">₹{it.revenue.toFixed(2)}</td>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr>
                <td colSpan={3} className="p-2 text-stone-500">
                  No items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm font-semibold">Cancelled / voided bills</span>
          <span className="text-sm text-rose-700">
            {(data.cancelled ?? []).length} bill{(data.cancelled ?? []).length === 1 ? '' : 's'} · −₹
            {(data.cancelledTotal ?? 0).toFixed(2)}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500">
            <tr>
              <th className="p-1">Token</th>
              <th className="p-1">Amount</th>
              <th className="p-1">Reason</th>
              <th className="p-1">Voided at</th>
            </tr>
          </thead>
          <tbody>
            {(data.cancelled ?? []).map((c) => (
              <tr key={c.id} className="border-t border-stone-100">
                <td className="p-1">{c.token_no ?? '—'}</td>
                <td className="p-1 text-rose-700">−₹{c.total.toFixed(2)}</td>
                <td className="p-1">{c.cancel_reason || '—'}</td>
                <td className="p-1 text-stone-500">{fmtDateTime(c.cancelled_at)}</td>
              </tr>
            ))}
            {(data.cancelled ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="p-2 text-stone-500">
                  No cancelled bills.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-stone-500">
          Voided amounts are already excluded from Revenue and the totals above.
        </p>
      </div>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
