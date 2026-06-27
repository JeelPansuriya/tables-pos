import React, { useEffect, useState } from 'react';
import { api } from '../api';

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

// Local calendar date as YYYY-MM-DD (toISOString is UTC and shifts the day in
// +offset timezones, which broke the Prev/Next buttons near midnight).
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

const MODE_COLORS: Record<string, string> = {
  cash: 'bg-emerald-100 text-emerald-800',
  upi: 'bg-sky-100 text-sky-800',
  card: 'bg-violet-100 text-violet-800',
  other: 'bg-stone-100 text-stone-700',
};

export default function DaySummaryPage() {
  const today = ymd(new Date());
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
    const d = new Date(date + 'T00:00:00'); // local midnight
    d.setDate(d.getDate() + days);
    setDate(ymd(d)); // format in local time — no UTC drift
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
                  <td className="p-1">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${
                        MODE_COLORS[m.mode] ?? MODE_COLORS.other
                      }`}
                    >
                      {m.mode}
                    </span>
                  </td>
                  <td className="p-1 font-medium">₹{m.amt.toFixed(2)}</td>
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

      <CashCard date={date} />
    </div>
  );
}

type CashInfo = {
  date: string;
  counted: number | null;
  openingBaseline: boolean;
  note: string;
  prevDate: string;
  prevCounted: number | null;
  todayCash: number;
  expected: number;
  expense: number | null;
};

// End-of-day cash reconciliation. The manager counts the drawer; expense is
// (yesterday's close + today's cash taken in) − today's count.
function CashCard({ date }: { date: string }) {
  const [info, setInfo] = useState<CashInfo | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await api.cash.get(date);
    if (r?.ok) {
      setInfo(r);
      setDraft(r.counted != null ? String(r.counted) : '');
      setNote(r.note || '');
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function save() {
    const r = await api.cash.set({ date, counted_cash: parseFloat(draft) || 0, note });
    setMsg(r?.ok ? 'Saved.' : r?.error || 'Failed');
    setTimeout(() => setMsg(null), 2500);
    await load();
  }

  if (!info) return null;
  const counted = parseFloat(draft);
  // Only days with a previous-day close have an expense; the first count is the
  // opening baseline.
  const liveExpense =
    !isNaN(counted) && info.prevCounted != null ? +(info.expected - counted).toFixed(2) : null;

  return (
    <div className="card space-y-3 p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Cash reconciliation</h2>
        {msg && <span className="text-xs text-emerald-700">{msg}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Box label={`Prev close (${info.prevDate.slice(5)})`} value={info.prevCounted != null ? `₹${info.prevCounted.toFixed(2)}` : '—'} />
        <Box label="Cash taken in today" value={`₹${info.todayCash.toFixed(2)}`} tone="emerald" />
        <Box label="Expected in drawer" value={`₹${info.expected.toFixed(2)}`} />
        <Box
          label="Cash expense"
          value={liveExpense == null ? '—' : `₹${liveExpense.toFixed(2)}`}
          tone={liveExpense != null && liveExpense > 0 ? 'rose' : liveExpense != null ? 'emerald' : undefined}
        />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs text-stone-600">Cash counted (end of day)</label>
          <input
            type="number"
            min={0}
            className="input w-40"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="₹"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-stone-600">Note (optional)</label>
          <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={save}>
          Save count
        </button>
      </div>
      {info.openingBaseline && (
        <p className="text-xs text-stone-500">
          This is your <strong>opening baseline</strong> — just enter the cash currently in the
          drawer and save. There's no expense for the first day; the daily cash expense starts from
          the next day you count.
        </p>
      )}
      {info.prevCounted == null && !info.openingBaseline && (
        <p className="text-xs text-amber-700">
          No cash count saved for {info.prevDate} — this day's expense can't be computed until
          {' '}{info.prevDate} is counted.
        </p>
      )}
    </div>
  );
}

function Box({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'emerald' | 'rose';
}) {
  const color =
    tone === 'emerald' ? 'text-emerald-700' : tone === 'rose' ? 'text-rose-700' : 'text-stone-800';
  return (
    <div className="rounded-md border border-stone-200 p-2">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${color}`}>{value}</div>
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
