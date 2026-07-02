import React, { useEffect, useRef, useState } from 'react';

type Props = {
  total: number;
  onCancel: () => void;
  onConfirm: (received: number, change: number) => void;
};

const denoms = [500, 200, 100, 50, 20, 10];

export default function CashChangeModal({ total, onCancel, onConfirm }: Props) {
  const [received, setReceived] = useState<number>(total);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus and select the amount on open so the cashier can type immediately.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const confirm = () => {
    if (received >= total) onConfirm(received, +(received - total).toFixed(2));
  };

  // Esc cancels globally. Enter confirms (handled here and on the input) — we do
  // NOT preventDefault digits/Backspace app-wide, or it looks like the keyboard
  // has stopped responding.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        // Ignore Enter aimed at a denomination button (it should add, not submit).
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'BUTTON') return;
        e.preventDefault();
        confirm();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [received, total, onCancel, onConfirm]);

  const change = received - total;
  const ok = received >= total;

  return (
    <div
      data-modal
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div className="card w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Cash payment</h2>
          <div className="text-sm text-stone-500">Esc cancel · Enter confirm</div>
        </div>
        <div className="rounded-md bg-stone-100 p-3 text-center">
          <div className="text-xs text-stone-500">Bill total</div>
          <div className="text-3xl font-bold">₹{total.toFixed(2)}</div>
        </div>

        <div>
          <label className="text-sm font-medium text-stone-700">Cash received</label>
          <input
            ref={inputRef}
            className="input text-2xl font-semibold"
            type="number"
            min={0}
            value={received}
            onChange={(e) => setReceived(parseFloat(e.target.value) || 0)}
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
          {[10, 50, 100].map((step) => (
            <button
              key={`up${step}`}
              type="button"
              className="btn-ghost border border-stone-300"
              onClick={() => setReceived(Math.ceil(total / step) * step)}
              title={`Round up to the next ₹${step}`}
            >
              ↑ ₹{step}
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
