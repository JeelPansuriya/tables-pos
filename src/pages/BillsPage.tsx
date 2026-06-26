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

export default function BillsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<string>('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [voiding, setVoiding] = useState<Row | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const r = await api.bills.list({ from, to, status, q });
    if (r?.ok) setRows(r.bills);
  }
  useEffect(() => {
    refresh();
  }, [from, to, status]);

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
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs text-stone-600">Search (token / customer)</label>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} />
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
              <tr key={r.id} className="border-t border-stone-100">
                <td className="p-2">{r.token_no ?? '—'}</td>
                <td className="p-2">{fmtDateTime(r.closed_at || r.opened_at)}</td>
                <td className="p-2">{r.type}</td>
                <td className="p-2">{r.table_label ?? '—'}</td>
                <td className="p-2">{r.customer_name ?? '—'}</td>
                <td className="p-2 font-medium">₹{r.total.toFixed(2)}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2 text-right">
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
