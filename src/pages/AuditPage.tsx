import React, { useEffect, useState } from 'react';
import { api } from '../api';

type Entry = {
  id: number;
  at: string;
  actor_username: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: string | null;
};

export default function AuditPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Entry[]>([]);

  async function refresh() {
    const r = await api.audit.list({ from, to, q });
    if (r?.ok) setRows(r.entries);
  }
  useEffect(() => {
    refresh();
  }, [from, to]);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Audit log</h1>
      <div className="card flex flex-wrap items-end gap-2 p-3">
        <div>
          <label className="text-xs text-stone-600">From</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-stone-600">To</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex-1">
          <label className="text-xs text-stone-600">Search</label>
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
              <th className="p-2">When</th>
              <th className="p-2">Actor</th>
              <th className="p-2">Action</th>
              <th className="p-2">Entity</th>
              <th className="p-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-stone-100 align-top">
                <td className="p-2 whitespace-nowrap">{r.at.slice(0, 16)}</td>
                <td className="p-2">{r.actor_username || '—'}</td>
                <td className="p-2 font-medium">{r.action}</td>
                <td className="p-2">
                  {r.entity_type ? `${r.entity_type} #${r.entity_id ?? ''}` : ''}
                </td>
                <td className="p-2 text-xs text-stone-600">
                  {r.details ? <code>{r.details}</code> : ''}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-stone-500">
                  No audit entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
