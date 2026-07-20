import React, { useEffect, useState } from 'react';
import { api } from '../api';
import NumberField from '../components/NumberField';

// Local calendar date as YYYY-MM-DD (avoids the UTC day-shift toISOString has).
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

type MoneyDay = {
  date: string;
  saved: boolean;
  cashCollected: number;
  upiCollected: number;
  cardCollected: number;
  otherCollected: number;
  cashExtra: number;
  upiExtra: number;
  totalCollected: number;
  cashExpense: number;
  upiExpense: number;
  note: string;
  cashInHand: number;
  net: number;
};

type RangeRow = {
  date: string;
  cashCollected: number;
  upiCollected: number;
  otherCollected: number;
  totalCollected: number;
  cashExpense: number;
  upiExpense: number;
  note: string;
  net: number;
};

export default function MoneyPage() {
  const today = ymd(new Date());
  const [date, setDate] = useState(today);
  const [info, setInfo] = useState<MoneyDay | null>(null);
  const [cash, setCash] = useState(0);
  const [upi, setUpi] = useState(0);
  const [cashIn, setCashIn] = useState(0); // extra cash taken in outside a bill
  const [upiIn, setUpiIn] = useState(0);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<RangeRow[]>([]);

  async function load() {
    const r = await api.money.get(date);
    if (r?.ok) {
      setInfo(r);
      setCash(r.cashExpense || 0);
      setUpi(r.upiExpense || 0);
      setCashIn(r.cashExtra || 0);
      setUpiIn(r.upiExtra || 0);
      setNote(r.note || '');
    }
  }
  async function loadRange() {
    const r = await api.money.range({});
    if (r?.ok) setRows(r.days);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  useEffect(() => {
    loadRange();
  }, []);

  async function save() {
    const r = await api.money.set({
      date,
      cash_expense: cash,
      upi_expense: upi,
      cash_extra: cashIn,
      upi_extra: upiIn,
      note,
    });
    setMsg(r?.ok ? 'Saved.' : r?.error || 'Failed');
    setTimeout(() => setMsg(null), 2500);
    await load();
    await loadRange();
  }

  function shiftDay(days: number) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setDate(ymd(d));
  }

  if (!info) return <div>Loading…</div>;

  // Live derived values from the current inputs (before saving). Sales come from
  // bills; extras (cashIn/upiIn) are the manual "extra received" amounts.
  const salesCollected = info.cashCollected + info.upiCollected + info.cardCollected + info.otherCollected;
  const cashInHand = +(info.cashCollected + cashIn - cash).toFixed(2);
  const net = +(salesCollected + cashIn + upiIn - cash - upi).toFixed(2);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">Money tracker</h1>
        {msg && <span className="text-sm text-emerald-700">{msg}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-ghost border border-stone-300" onClick={() => shiftDay(-1)}>
            ← Prev
          </button>
          <input
            type="date"
            className="input w-40"
            value={date}
            max={today}
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
        </div>
      </div>

      {/* Collected today (from sales) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <KPI label="Cash collected" value={`₹${info.cashCollected.toFixed(2)}`} tone="emerald" />
        <KPI label="UPI collected" value={`₹${info.upiCollected.toFixed(2)}`} tone="sky" />
        {(info.cardCollected > 0 || info.otherCollected > 0) && (
          <KPI
            label="Card / other"
            value={`₹${(info.cardCollected + info.otherCollected).toFixed(2)}`}
          />
        )}
        <KPI label="Total collected" value={`₹${info.totalCollected.toFixed(2)}`} />
      </div>

      {/* Manual money entry for the day — expenses out + extra cash/UPI in */}
      <div className="card space-y-3 p-4">
        <div className="text-sm font-semibold">
          Money for {date === today ? 'today' : date}
          <span className="ml-2 font-normal text-stone-500">
            enter the day's total spending, plus any extra taken in outside a bill
          </span>
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose-700">Expenses (out)</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-stone-600">Cash expense</label>
              <NumberField className="input" min={0} value={cash} onChange={setCash} placeholder="₹0" />
            </div>
            <div>
              <label className="text-xs text-stone-600">UPI expense</label>
              <NumberField className="input" min={0} value={upi} onChange={setUpi} placeholder="₹0" />
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Extra received (in)
            <span className="ml-2 font-normal normal-case tracking-normal text-stone-500">
              money in that wasn't a normal bill — tips, an old due, a quick sale
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-stone-600">Extra cash in</label>
              <NumberField className="input" min={0} value={cashIn} onChange={setCashIn} placeholder="₹0" />
            </div>
            <div>
              <label className="text-xs text-stone-600">Extra UPI in</label>
              <NumberField className="input" min={0} value={upiIn} onChange={setUpiIn} placeholder="₹0" />
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs text-stone-600">Note (optional)</label>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. vegetables, gas, wages, tip"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={save}>
            {info.saved ? 'Update' : 'Save'}
          </button>
          <span className="text-xs text-stone-500">
            Expense out: <strong>₹{(cash + upi).toFixed(2)}</strong>
          </span>
          <span className="text-xs text-stone-500">
            Extra in: <strong>₹{(cashIn + upiIn).toFixed(2)}</strong>
          </span>
        </div>
      </div>

      {/* Derived */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KPI
          label="Cash in hand"
          value={`₹${cashInHand.toFixed(2)}`}
          hint="cash collected − cash expense"
          tone={cashInHand < 0 ? 'rose' : 'emerald'}
        />
        <KPI
          label="Net (all modes)"
          value={`₹${net.toFixed(2)}`}
          hint="total collected − all expenses"
          tone={net < 0 ? 'rose' : undefined}
        />
        <KPI label="Total expense" value={`₹${(cash + upi).toFixed(2)}`} tone="rose" />
      </div>

      {/* History */}
      <div className="card overflow-hidden">
        <div className="border-b border-stone-200 p-3 text-sm font-semibold">
          Last 14 days <span className="font-normal text-stone-500">(click a day to edit)</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-left text-stone-500">
            <tr>
              <th className="p-2">Date</th>
              <th className="p-2 text-right">Cash in</th>
              <th className="p-2 text-right">UPI in</th>
              <th className="p-2 text-right">Total in</th>
              <th className="p-2 text-right">Cash exp</th>
              <th className="p-2 text-right">UPI exp</th>
              <th className="p-2 text-right">Net</th>
              <th className="p-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.date}
                onClick={() => setDate(r.date)}
                className={`cursor-pointer border-t border-stone-100 hover:bg-stone-50 ${
                  r.date === date ? 'bg-brand-50' : ''
                }`}
              >
                <td className="p-2 font-medium">{r.date}</td>
                <td className="p-2 text-right tabular-nums text-emerald-700">₹{r.cashCollected.toFixed(0)}</td>
                <td className="p-2 text-right tabular-nums text-sky-700">₹{r.upiCollected.toFixed(0)}</td>
                <td className="p-2 text-right tabular-nums">₹{r.totalCollected.toFixed(0)}</td>
                <td className="p-2 text-right tabular-nums text-rose-700">
                  {r.cashExpense ? `₹${r.cashExpense.toFixed(0)}` : '—'}
                </td>
                <td className="p-2 text-right tabular-nums text-rose-700">
                  {r.upiExpense ? `₹${r.upiExpense.toFixed(0)}` : '—'}
                </td>
                <td className="p-2 text-right font-medium tabular-nums">₹{r.net.toFixed(0)}</td>
                <td className="p-2 text-stone-500">{r.note}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-stone-500">
                  No money activity in the last 14 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KPI({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'emerald' | 'rose' | 'sky';
}) {
  const color =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'rose'
      ? 'text-rose-700'
      : tone === 'sky'
      ? 'text-sky-700'
      : 'text-stone-800';
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-400">{hint}</div>}
    </div>
  );
}
