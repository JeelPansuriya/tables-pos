import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import ReasonModal from '../components/ReasonModal';

type Field = { key: string; label: string; type?: string; help?: string };

// Everyday settings — editable by any signed-in user (manager or admin).
const fields: Array<Field> = [
  { key: 'restaurant_name', label: 'Restaurant name' },
  { key: 'restaurant_address', label: 'Address' },
  { key: 'restaurant_phone', label: 'Phone' },
  { key: 'gst_no', label: 'GSTIN (optional)' },
  { key: 'default_meal_type', label: 'Default meal (lunch / dinner)' },
  { key: 'lunch_until_hour', label: 'Hour at which dinner starts (24h)', type: 'number' },
  { key: 'printer_name', label: 'Printer name (exact)' },
  { key: 'printer_copies', label: 'Customer copies to print', type: 'number', help: 'How many identical customer slips per bill (default 1). Manager copy is no longer printed.' },
  { key: 'discount_max_pct', label: 'Max discount % (0–100)', type: 'number' },
];

// Cloud/Supabase connection — admin only. Managers must not be able to change
// where (or whether) data is backed up.
const cloudFields: Array<Field> = [
  { key: 'supabase_url', label: 'Supabase URL', help: 'e.g. https://xxxx.supabase.co' },
  { key: 'supabase_anon_key', label: 'Supabase anon key' },
  { key: 'supabase_table_prefix', label: 'Cloud table prefix', help: 'Defaults to "v2_" — keeps this app isolated from the v1 dataset.' },
  { key: 'cloud_sync_enabled', label: 'Cloud sync enabled (1/0)', help: 'Set to 1 to push closed bills & pre-orders to Supabase in the background.' },
];

export default function SettingsPage() {
  const { settings, refreshSettings, session, cloud, syncing, refreshCloud, syncNow } = useStore();
  const [draft, setDraft] = useState<Record<string, string>>({ ...settings });
  const [users, setUsers] = useState<any[]>([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'manager' as 'manager' | 'admin' });
  const [pwOld, setPwOld] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backupInfo, setBackupInfo] = useState<{ extraDir: string; lastBackupAt: string | null }>({
    extraDir: '',
    lastBackupAt: null,
  });

  async function loadBackupInfo() {
    const r = await api.backup.status();
    if (r?.ok) setBackupInfo({ extraDir: r.extraDir || '', lastBackupAt: r.lastBackupAt || null });
  }
  useEffect(() => {
    loadBackupInfo();
  }, []);

  async function backupNow() {
    const r = await api.backup.now();
    setMsg(r?.ok ? 'Backup saved.' : r?.error || 'Backup failed');
    await loadBackupInfo();
  }
  async function chooseBackupDir() {
    const r = await api.backup.chooseDir();
    if (r?.ok && r.dir) setMsg('Off-PC backup folder set.');
    await loadBackupInfo();
  }
  async function clearBackupDir() {
    await api.backup.clearDir();
    await loadBackupInfo();
  }

  async function recomputePlates() {
    const r = await api.bills.recomputePlates();
    setMsg(r?.ok ? `Recomputed plate counts for ${r.updated} bills.` : r?.error || 'Failed');
  }

  const [resyncing, setResyncing] = useState(false);
  async function doResyncAll() {
    setResyncing(true);
    setMsg('Uploading all history to the cloud… this can take a minute.');
    const r = await api.cloud.resyncAll();
    setResyncing(false);
    if (r?.ok) {
      setMsg(
        `Uploaded ${r.uploaded} record(s) to the cloud.${
          r.remaining ? ` ${r.remaining} still pending — run again.` : ''
        }`
      );
      await refreshCloud();
    } else {
      setMsg(r?.error || 'Re-upload failed');
    }
  }

  async function doRestore() {
    setRestoreOpen(false);
    setRestoring(true);
    setMsg('Restoring from cloud… do not close the app.');
    const r = await api.cloud.pullSnapshot();
    setRestoring(false);
    if (r?.ok) {
      const c = r.counts || {};
      setMsg(
        `Restored from cloud: ${c.bills ?? 0} bills, ${c.preorders ?? 0} pre-orders, ${
          c.cash_counts ?? 0
        } cash counts. Reloading…`
      );
      setTimeout(() => window.location.reload(), 1500);
    } else {
      setMsg(r?.error || 'Restore failed');
    }
  }

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

  // Persist only the given keys, so the general Save never sends admin-only
  // cloud keys (which the backend rejects for managers).
  async function persist(keys: string[]) {
    const subset: Record<string, string> = {};
    for (const k of keys) subset[k] = draft[k] ?? '';
    const r = await api.settings.set(subset);
    if (r?.ok) {
      setMsg('Saved.');
      await refreshSettings();
      await refreshCloud();
    } else setMsg(r?.error || 'Save failed');
  }

  const save = () => persist(fields.map((f) => f.key));
  const saveCloud = () => persist(cloudFields.map((f) => f.key));

  async function doSync() {
    const r = await syncNow();
    setMsg(r.ok ? 'Cloud sync complete.' : `Sync failed: ${r.error}`);
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
    } else setMsg(r?.error || 'Failed');
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
        <h2 className="text-sm font-semibold">Local backups</h2>
        <p className="text-xs text-stone-500">
          The database is backed up automatically every day (and at launch), kept for 14 days on this
          PC. Set an <strong>off-PC folder</strong> (a OneDrive / Google Drive synced folder, or a USB
          drive) to also copy each daily backup there — so your data survives even if this PC fails.
        </p>
        <div className="text-sm">
          <div>
            Last backup:{' '}
            <strong>
              {backupInfo.lastBackupAt ? new Date(backupInfo.lastBackupAt).toLocaleString() : 'never'}
            </strong>
          </div>
          <div className="mt-0.5">
            Off-PC folder:{' '}
            {backupInfo.extraDir ? (
              <code className="break-all">{backupInfo.extraDir}</code>
            ) : (
              <span className="text-stone-500">not set</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost border border-stone-300" onClick={chooseBackupDir}>
            Choose off-PC folder…
          </button>
          {backupInfo.extraDir && (
            <button className="btn-ghost border border-stone-300" onClick={clearBackupDir}>
              Remove folder
            </button>
          )}
          <button className="btn-primary" onClick={backupNow}>
            Back up now
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
          <h2 className="text-sm font-semibold">Cloud backup (admin only)</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {cloudFields.map((f) => (
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
          <button className="btn-primary w-fit" onClick={saveCloud}>
            Save cloud settings
          </button>
          {!cloud?.configured ? (
            <p className="text-sm text-stone-600">
              Add your Supabase URL and anon key above, set <code>Cloud sync enabled</code> to{' '}
              <code>1</code>, and Save. Closed bills and pre-orders then back up automatically.
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                <span>
                  Status:{' '}
                  <strong className={cloud.enabled ? 'text-emerald-700' : 'text-stone-500'}>
                    {cloud.enabled ? 'enabled' : 'configured but disabled'}
                  </strong>
                </span>
                <span>
                  Pending: <strong>{cloud.pending}</strong>
                </span>
                <span className="text-stone-500">
                  Last sync:{' '}
                  {cloud.lastSyncAt ? new Date(cloud.lastSyncAt).toLocaleString() : 'never'}
                </span>
              </div>
              {cloud.lastError && (
                <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  Last error: {cloud.lastError}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary w-fit" onClick={doSync} disabled={syncing || !cloud.enabled}>
                  {syncing ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  className="btn-ghost w-fit border border-stone-300"
                  onClick={doResyncAll}
                  disabled={resyncing || !cloud.enabled}
                  title="Push the full local history to the cloud — use once to backfill old sales into the dashboard"
                >
                  {resyncing ? 'Uploading…' : 'Re-upload all history'}
                </button>
                <button
                  className="btn-ghost w-fit border border-rose-300 text-rose-700"
                  onClick={() => setRestoreOpen(true)}
                  disabled={restoring}
                >
                  {restoring ? 'Restoring…' : 'Restore from cloud (override)'}
                </button>
              </div>
              <p className="text-xs text-stone-500">
                Restore pulls all bills, pre-orders and cash counts from the cloud and{' '}
                <strong>replaces</strong> what's on this PC. Use it to set up a new machine or recover
                data — not for everyday use. Menu &amp; settings aren't cloud-backed and stay as-is.
              </p>
            </div>
          )}
        </div>
      )}

      {restoreOpen && (
        <ReasonModal
          title="Restore from cloud and override this PC?"
          message="This downloads all bills, pre-orders and cash counts from the cloud and REPLACES the local copy. Any local bills not yet synced (e.g. open bills) will be lost. A local backup is saved first. This cannot be undone from the app."
          showReason={false}
          confirmLabel="Override with cloud data"
          cancelLabel="Cancel"
          onConfirm={doRestore}
          onClose={() => setRestoreOpen(false)}
        />
      )}

      {session?.role === 'admin' && (
        <div className="card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Maintenance</h2>
          <p className="text-xs text-stone-500">
            Bills store each item's plate weight as it was at the time of sale. If you change a menu
            item's plate weight, past bills keep the old value. Run this to rewrite every bill's plate
            count using the <strong>current</strong> menu weights — fixes the Day Summary / Analytics
            plate totals for past days.
          </p>
          <button className="btn-ghost w-fit border border-stone-300" onClick={recomputePlates}>
            Recompute plate counts
          </button>
        </div>
      )}

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
