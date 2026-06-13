import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';

const fields: Array<{ key: string; label: string; type?: string; help?: string }> = [
  { key: 'restaurant_name', label: 'Restaurant name' },
  { key: 'restaurant_address', label: 'Address' },
  { key: 'restaurant_phone', label: 'Phone' },
  { key: 'gst_no', label: 'GSTIN (optional)' },
  { key: 'default_meal_type', label: 'Default meal (lunch / dinner)' },
  { key: 'lunch_until_hour', label: 'Hour at which dinner starts (24h)', type: 'number' },
  { key: 'printer_name', label: 'Printer name (exact)' },
  { key: 'printer_copies', label: 'Print copies (1 or 2)', type: 'number' },
  { key: 'discount_max_pct', label: 'Max discount % (0–100)', type: 'number' },
  { key: 'supabase_url', label: 'Supabase URL (phase 2)' },
  { key: 'supabase_anon_key', label: 'Supabase anon key (phase 2)' },
  { key: 'supabase_table_prefix', label: 'Cloud table prefix', help: 'Defaults to "v2_" — keeps this app isolated from the v1 dataset.' },
  { key: 'cloud_sync_enabled', label: 'Cloud sync enabled (1/0)' },
];

export default function SettingsPage() {
  const { settings, refreshSettings, session } = useStore();
  const [draft, setDraft] = useState<Record<string, string>>({ ...settings });
  const [users, setUsers] = useState<any[]>([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'manager' as 'manager' | 'admin' });
  const [pwOld, setPwOld] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraft({ ...settings });
  }, [settings]);

  useEffect(() => {
    if (session?.role === 'admin') refreshUsers();
  }, [session]);

  async function refreshUsers() {
    const r = await api.auth.listUsers();
    if (r?.ok) setUsers(r.users);
  }

  async function save() {
    const r = await api.settings.set(draft);
    if (r?.ok) {
      setMsg('Saved.');
      await refreshSettings();
    } else setMsg(r?.error || 'Save failed');
  }

  async function changePw() {
    const r = await api.auth.changePassword(pwOld, pwNew);
    if (r?.ok) {
      setMsg('Password updated.');
      setPwOld('');
      setPwNew('');
    } else {
      setMsg(r?.error || 'Failed');
    }
  }

  async function createUser() {
    const r = await api.auth.createUser(newUser.username, newUser.password, newUser.role);
    if (r?.ok) {
      setNewUser({ username: '', password: '', role: 'manager' });
      await refreshUsers();
    } else alert(r?.error || 'Failed');
  }

  async function testPrint() {
    const r = await api.bills.testPrint();
    setMsg(r?.ok ? 'Test print sent.' : r?.error || 'Print failed');
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>
      {msg && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}

      <div className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Restaurant & printer</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="text-xs text-stone-600">{f.label}</label>
              <input
                className="input"
                type={f.type || 'text'}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              />
              {f.help && <p className="mt-1 text-xs text-stone-500">{f.help}</p>}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={save}>
            Save settings
          </button>
          <button className="btn-ghost border border-stone-300" onClick={testPrint}>
            Test print
          </button>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Change my password</h2>
        <div className="grid grid-cols-2 gap-2">
          <input
            className="input"
            type="password"
            placeholder="Old password"
            value={pwOld}
            onChange={(e) => setPwOld(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="New password"
            value={pwNew}
            onChange={(e) => setPwNew(e.target.value)}
          />
        </div>
        <button className="btn-primary w-fit" onClick={changePw}>
          Update password
        </button>
      </div>

      {session?.role === 'admin' && (
        <div className="card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Users</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr>
                <th className="p-1">User</th>
                <th className="p-1">Role</th>
                <th className="p-1">Active</th>
                <th className="p-1"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-stone-100">
                  <td className="p-1">{u.username}</td>
                  <td className="p-1">{u.role}</td>
                  <td className="p-1">{u.active ? 'yes' : 'no'}</td>
                  <td className="p-1 text-right">
                    <button
                      className="btn-ghost text-xs"
                      onClick={async () => {
                        await api.auth.setActive(u.id, !u.active);
                        await refreshUsers();
                      }}
                    >
                      {u.active ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-2">
            <input
              className="input"
              placeholder="Username"
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
            />
            <input
              className="input"
              placeholder="Password"
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            />
            <select
              className="input"
              value={newUser.role}
              onChange={(e) => setNewUser({ ...newUser, role: e.target.value as any })}
            >
              <option value="manager">manager</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button className="btn-primary w-fit" onClick={createUser}>
            + Create user
          </button>
        </div>
      )}
    </div>
  );
}
