import React, { useEffect, useState } from 'react';
import { useStore } from '../store';

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

  let label: string;
  let tone: string;
  if (syncing) {
    label = 'Syncing…';
    tone = 'bg-sky-50 text-sky-700 border-sky-200';
  } else if (hasError) {
    label = 'Sync error';
    tone = 'bg-rose-50 text-rose-700 border-rose-200';
  } else if (pending > 0) {
    label = `${pending} to sync`;
    tone = 'bg-amber-50 text-amber-800 border-amber-200';
  } else {
    label = 'Backed up';
    tone = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }

  const title = [
    cloud.lastSyncAt ? `Last sync: ${new Date(cloud.lastSyncAt).toLocaleString()}` : 'Not synced yet',
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
