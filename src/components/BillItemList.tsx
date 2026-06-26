import React from 'react';

export type EditorItem = {
  menu_item_id: number | null;
  name: string;
  qty: number;
  unit_price: number;
  plate_weight: number;
  is_custom: boolean;
};

type Props = {
  items: EditorItem[];
  onChange: (items: EditorItem[]) => void;
  /** Optional heading shown above the list. */
  title?: string;
  /** Show the running subtotal footer (default true). Hide when a PaymentBar already shows the total. */
  showSubtotal?: boolean;
};

/** The editable bill-items list: qty +/-, inline price, running subtotal. */
export default function BillItemList({ items, onChange, title, showSubtotal = true }: Props) {
  function setQty(idx: number, qty: number) {
    if (qty <= 0) {
      onChange(items.filter((_, i) => i !== idx));
      return;
    }
    const next = items.slice();
    next[idx] = { ...next[idx], qty };
    onChange(next);
  }

  function setPrice(idx: number, p: number) {
    const next = items.slice();
    next[idx] = { ...next[idx], unit_price: p };
    onChange(next);
  }

  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="border-b border-stone-200 p-2 text-sm font-semibold">
        {title ?? 'Bill items'} ({items.length})
      </div>
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="p-4 text-sm text-stone-500">No items yet — tap menu tiles to add.</div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {items.map((it, idx) => (
              <li key={idx} className="flex items-center gap-2 p-2 text-sm">
                <div className="flex-1">
                  <div className="font-medium text-stone-800">
                    {it.name} {it.is_custom && <span className="text-xs text-amber-700">·custom</span>}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-stone-500">
                    <span>₹</span>
                    <input
                      type="number"
                      className="w-20 rounded border border-stone-200 px-1 py-0.5 text-xs"
                      value={it.unit_price}
                      onChange={(e) => setPrice(idx, parseFloat(e.target.value) || 0)}
                    />
                    <span>× {it.qty} = ₹{(it.unit_price * it.qty).toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded-md border border-stone-300 px-2 text-lg leading-none hover:bg-stone-100"
                    onClick={() => setQty(idx, it.qty - 1)}
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-semibold">{it.qty}</span>
                  <button
                    className="rounded-md border border-stone-300 px-2 text-lg leading-none hover:bg-stone-100"
                    onClick={() => setQty(idx, it.qty + 1)}
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {showSubtotal && (
        <div className="border-t border-stone-200 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-stone-600">Subtotal</span>
            <span className="text-2xl font-bold text-brand-700">₹{subtotal.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
