import React, { useEffect, useState } from 'react';

type Props = {
  total: number;
  onCancel: () => void;
  onConfirm: (received: number, change: number) => void;
};

const denoms = [500, 200, 100, 50, 20, 10];

export default function CashChangeModal({ total, onCancel, onConfirm }: Props) {
  const [received, setReceived] = useState<number>(total);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (received >= total) onConfirm(received, +(received - total).toFixed(2));
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setReceived((r) => Number(`${r}${e.key}`.replace(/^0+(?=\d)/, '')));
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setReceived((r) => Math.floor(r / 10));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [received, total, onCancel, onConfirm]);

  const change = received - total;
  const ok = received >= total;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md p-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Cash payment</h2>
          <div className="text-sm text-stone-500">Esc to cancel · Ctrl+Enter to confirm</div>
        </div>
        <div className="rounded-md bg-stone-100 p-3 text-center">
          <div className="text-xs text-stone-500">Bill total</div>
          <div className="text-3xl font-bold">₹{total.toFixed(2)}</div>
        </div>

        <div>
          <label className="text-sm font-medium text-stone-700">Cash received</label>
          <input
            className="input text-2xl font-semibold"
            type="number"
            min={0}
            value={received}
            onChange={(e) => setReceived(parseFloat(e.target.value) || 0)}
            autoFocus
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {denoms.map((d) => (
            <button
              key={d}
              type="button"
              className="btn-ghost border border-stone-300"
              onClick={() => setReceived((r) => r + d)}
            >
              + ₹{d}
            </button>
          ))}
          <button
            type="button"
            className="btn-ghost border border-stone-300"
            onClick={() => setReceived(total)}
          >
            Exact
          </button>
          <button
            type="button"
            className="btn-ghost border border-stone-300"
            onClick={() => setReceived((r) => r + 1)}
          >
            + ₹1
          </button>
          <button
            type="button"
            className="btn-ghost border border-red-200 text-red-700"
            onClick={() => setReceived(0)}
          >
            Clear
          </button>
        </div>

        <div
          className={`rounded-md p-3 text-center ${
            ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
          }`}
        >
          <div className="text-xs">{ok ? 'Change to return' : 'Short'}</div>
          <div className="text-3xl font-bold">₹{Math.abs(change).toFixed(2)}</div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!ok}
            onClick={() => onConfirm(received, +change.toFixed(2))}
          >
            Confirm payment
          </button>
        </div>
      </div>
    </div>
  );
}
