import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import ReasonModal from '../components/ReasonModal';

type Row = {
  id?: number;
  name: string;
  category: string | null;
  lunch_price: number;
  dinner_price: number;
  plate_weight: number;
  shortcut_key: string | null;
  in_stock: number;
  active: number;
  sort_order: number;
};

// Predefined menu categories — keeps the menu organised and consistent.
const CATEGORIES = ['Dish', 'Sweets/Sides', 'Extras'];

const blank: Row = {
  name: '',
  category: 'Dish',
  lunch_price: 0,
  dinner_price: 0,
  plate_weight: 1,
  shortcut_key: '',
  in_stock: 1,
  active: 1,
  sort_order: 0,
};

export default function MenuPage() {
  const { refreshMenu } = useStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [hideRow, setHideRow] = useState<Row | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const r = await api.menu.list();
    if (r?.ok) setRows(r.items);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function save() {
    if (!editing) return;
    const r = await api.menu.upsert({
      ...editing,
      in_stock: !!editing.in_stock,
      active: !!editing.active,
    });
    if (r?.ok) {
      setEditing(null);
      setMsg('Saved.');
      await refresh();
      await refreshMenu();
    } else {
      setMsg(r?.error || 'Save failed');
    }
  }

  async function toggleStock(row: Row) {
    await api.menu.setStock(row.id!, !row.in_stock);
    await refresh();
    await refreshMenu();
  }

  async function doHide(row: Row) {
    setHideRow(null);
    await api.menu.delete(row.id!);
    setMsg(`"${row.name}" hidden from the menu.`);
    await refresh();
    await refreshMenu();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">Menu</h1>
        <button className="btn-primary ml-auto" onClick={() => setEditing({ ...blank })}>
          + Add item
        </button>
      </div>
      {msg && (
        <div className="rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-700">{msg}</div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-left">
            <tr>
              <th className="p-2">Name</th>
              <th className="p-2">Category</th>
              <th className="p-2">Lunch ₹</th>
              <th className="p-2">Dinner ₹</th>
              <th className="p-2">Plate wt</th>
              <th className="p-2">Key</th>
              <th className="p-2">Stock</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-stone-100">
                <td className="p-2">{r.name}</td>
                <td className="p-2">{r.category}</td>
                <td className="p-2">{r.lunch_price}</td>
                <td className="p-2">{r.dinner_price}</td>
                <td className="p-2">{r.plate_weight}</td>
                <td className="p-2">{r.shortcut_key}</td>
                <td className="p-2">
                  <button
                    onClick={() => toggleStock(r)}
                    className={`rounded px-2 py-0.5 text-xs ${
                      r.in_stock
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {r.in_stock ? 'in stock' : 'OUT'}
                  </button>
                </td>
                <td className="p-2 text-right">
                  <button className="btn-ghost text-xs" onClick={() => setEditing(r)}>
                    Edit
                  </button>
                  <button
                    className="btn-ghost text-xs text-red-700"
                    onClick={() => setHideRow(r)}
                  >
                    Hide
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-md p-4 space-y-3">
            <h2 className="text-lg font-semibold">{editing.id ? 'Edit item' : 'New item'}</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="text-xs text-stone-600">Name</label>
                <input
                  className="input"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-stone-600">Category</label>
                <select
                  className="input"
                  value={editing.category ?? 'Dish'}
                  onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-stone-600">Shortcut key (1–2 letters)</label>
                <input
                  className="input"
                  maxLength={2}
                  value={editing.shortcut_key ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, shortcut_key: e.target.value.toLowerCase() })
                  }
                />
              </div>
              <div>
                <label className="text-xs text-stone-600">Lunch ₹</label>
                <input
                  type="number"
                  className="input"
                  value={editing.lunch_price}
                  onChange={(e) =>
                    setEditing({ ...editing, lunch_price: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className="text-xs text-stone-600">Dinner ₹</label>
                <input
                  type="number"
                  className="input"
                  value={editing.dinner_price}
                  onChange={(e) =>
                    setEditing({ ...editing, dinner_price: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className="text-xs text-stone-600">Plate weight</label>
                <input
                  type="number"
                  className="input"
                  value={editing.plate_weight}
                  onChange={(e) =>
                    setEditing({ ...editing, plate_weight: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className="text-xs text-stone-600">Sort order</label>
                <input
                  type="number"
                  className="input"
                  value={editing.sort_order}
                  onChange={(e) =>
                    setEditing({ ...editing, sort_order: parseInt(e.target.value, 10) || 0 })
                  }
                />
              </div>
              <div className="col-span-2 flex gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!editing.in_stock}
                    onChange={(e) => setEditing({ ...editing, in_stock: e.target.checked ? 1 : 0 })}
                  />
                  In stock
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!editing.active}
                    onChange={(e) => setEditing({ ...editing, active: e.target.checked ? 1 : 0 })}
                  />
                  Active
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={save}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {hideRow && (
        <ReasonModal
          title={`Hide "${hideRow.name}" from the menu?`}
          message="It will no longer appear for billing. You can re-add it later."
          showReason={false}
          confirmLabel="Hide item"
          cancelLabel="Keep"
          onConfirm={() => doHide(hideRow)}
          onClose={() => setHideRow(null)}
        />
      )}
    </div>
  );
}
