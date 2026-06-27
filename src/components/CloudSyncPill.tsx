import React, { useEffect, useState } from 'react';
import { useStore } from '../store';

function agoLabel(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return 'never';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
// Minutes since the last successful sync (Infinity if never).
function minsSince(iso: string | null): number {
  if (!iso) return Infinity;
  const ms = Date.now() - new Date(iso).getTime();
  return isNaN(ms) ? Infinity : ms / 60000;
}

/**
 * Compact cloud-backup indicator for the header. Polls status on a slow timer,
 * shows pending count / last error, and (for admins) doubles as a "Sync now"
 * button. Hidden entirely when cloud sync is turned off in Settings.
 */
export default function CloudSyncPill() {
  const { cloud, syncing, refreshCloud, syncNow, session } = useStore();
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    refreshCloud();
    const t = setInterval(refreshCloud, 20000);
    return () => clearInterval(t);
  }, [refreshCloud]);

  if (!cloud?.enabled) return null;

  const isAdmin = session?.role === 'admin';
  const hasError = !!cloud.lastError;
  const pending = cloud.pending;

  const age = minsSince(cloud.lastSyncAt);
  // "Behind" = there's data to push but nothing has gone up in a while → the
  // sync may be stuck (offline, bad key, RLS). Surface it before it's a problem.
  const behind = pending > 0 && age > 10;

  let label: string;
  let tone: string;
  if (syncing) {
    label = 'Syncing…';
    tone = 'bg-sky-50 text-sky-700 border-sky-200';
  } else if (hasError) {
    label = 'Sync error';
    tone = 'bg-rose-50 text-rose-700 border-rose-200';
  } else if (behind) {
    label = `Behind · ${pending} stuck`;
    tone = 'bg-rose-50 text-rose-700 border-rose-200';
  } else if (pending > 0) {
    label = `${pending} to sync`;
    tone = 'bg-amber-50 text-amber-800 border-amber-200';
  } else {
    label = `Backed up · ${agoLabel(cloud.lastSyncAt)}`;
    tone = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }

  const title = [
    cloud.lastSyncAt ? `Last sync: ${new Date(cloud.lastSyncAt).toLocaleString()}` : 'Not synced yet',
    behind ? `${pending} change(s) not synced in ${agoLabel(cloud.lastSyncAt)} — check connection/Supabase.` : '',
    cloud.lastError ? `Error: ${cloud.lastError}` : '',
    isAdmin ? 'Click to sync now' : '',
  ]
    .filter(Boolean)
    .join('\n');

  async function onClick() {
    if (!isAdmin || syncing) return;
    const r = await syncNow();
    setFlash(r.ok ? 'Synced ✓' : r.error || 'Failed');
    setTimeout(() => setFlash(null), 2500);
  }

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={!isAdmin || syncing}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${tone} ${
        isAdmin && !syncing ? 'cursor-pointer hover:brightness-95' : 'cursor-default'
      }`}
    >
      <span aria-hidden>☁</span>
      <span>{flash ?? label}</span>
    </button>
  );
}
