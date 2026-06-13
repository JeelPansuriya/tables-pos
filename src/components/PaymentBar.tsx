import React, { useState } from 'react';
import type { PaymentMode } from '../types';
import CashChangeModal from './CashChangeModal';

export type PaymentEntry = {
  amount: number;
  mode: PaymentMode;
  cash_received?: number;
  change_given?: number;
};

type Props = {
  total: number;
  disabled?: boolean;
  onSettle: (payments: PaymentEntry[]) => void | Promise<void>;
  primaryLabel: string;
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
};

export default function PaymentBar({
  total,
  disabled,
  onSettle,
  primaryLabel,
  secondaryAction,
}: Props) {
  const [splitMode, setSplitMode] = useState<'single' | 'split'>('single');
  const [singleMode, setSingleMode] = useState<PaymentMode>('cash');
  const [cashOpen, setCashOpen] = useState(false);
  const [cashPart, setCashPart] = useState<number>(0);

  const upiPart = +(total - cashPart).toFixed(2);

  function settleSingle(mode: PaymentMode) {
    if (mode === 'cash') {
      setCashOpen(true);
      return;
    }
    onSettle([{ amount: total, mode }]);
  }

  function settleSplit() {
    if (cashPart <= 0 || cashPart >= total) return;
    setCashOpen(true);
  }

  function onCashConfirm(received: number, change: number) {
    setCashOpen(false);
    if (splitMode === 'split') {
      onSettle([
        { amount: cashPart, mode: 'cash', cash_received: received, change_given: change },
        { amount: upiPart, mode: 'upi' },
      ]);
    } else {
      onSettle([{ amount: total, mode: 'cash', cash_received: received, change_given: change }]);
    }
  }

  return (
    <div className="card p-3 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-sm text-stone-600">Bill total</div>
        <div className="text-3xl font-bold text-brand-700">₹{total.toFixed(2)}</div>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-1 rounded-md border border-stone-300 bg-white p-0.5 text-sm">
          <button
            className={`flex-1 rounded px-3 py-1 ${
              splitMode === 'single' ? 'bg-brand-600 text-white' : 'text-stone-700'
            }`}
            onClick={() => setSplitMode('single')}
          >
            Single
          </button>
          <button
            className={`flex-1 rounded px-3 py-1 ${
              splitMode === 'split' ? 'bg-brand-600 text-white' : 'text-stone-700'
            }`}
            onClick={() => setSplitMode('split')}
          >
            Split (cash + UPI)
          </button>
        </div>
      </div>

      {splitMode === 'single' ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['cash', 'upi', 'card', 'other'] as PaymentMode[]).map((m) => (
            <button
              key={m}
              className={`rounded-md border px-3 py-2 text-sm capitalize ${
                singleMode === m ? 'border-brand-600 bg-brand-50' : 'border-stone-300'
              }`}
              onClick={() => setSingleMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-stone-600">Cash part</label>
            <input
              className="input"
              type="number"
              value={cashPart}
              onChange={(e) => setCashPart(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="text-xs text-stone-600">UPI part</label>
            <input className="input bg-stone-50" type="number" value={upiPart} readOnly />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {secondaryAction && (
          <button
            className="btn-ghost border border-stone-300"
            onClick={secondaryAction.onClick}
            disabled={secondaryAction.disabled}
          >
            {secondaryAction.label}
          </button>
        )}
        <button
          className="btn-primary"
          disabled={disabled || total <= 0}
          onClick={() =>
            splitMode === 'single' ? settleSingle(singleMode) : settleSplit()
          }
        >
          {primaryLabel}
        </button>
      </div>

      {cashOpen && (
        <CashChangeModal
          total={splitMode === 'split' ? cashPart : total}
          onCancel={() => setCashOpen(false)}
          onConfirm={onCashConfirm}
        />
      )}
    </div>
  );
}
