import type { Database } from 'better-sqlite3';
import { getDb } from './db';

/**
 * Cloud backup (phase 2).
 *
 * We push to Supabase via the PostgREST REST endpoint with a plain `fetch`
 * rather than `@supabase/supabase-js`. The JS client eagerly constructs a
 * Realtime client that needs a global `WebSocket`, which the Node runtime
 * inside Electron's main process doesn't expose — so it throws on import.
 * A bare fetch covers our only need: idempotent upserts.
 *
 * Everything is written to `{prefix}`-prefixed tables (default `v2_`) so this
 * app stays fully isolated from the v1 dataset on the same Supabase project.
 *
 * This is push-only: local SQLite is the source of truth and we never pull a
 * snapshot back down. Bills and pre-orders upsert with merge-duplicates so a
 * later change (a bill void, a pre-order payment/fulfilment) overwrites the
 * cloud copy; child item/payment rows are append-only (ignore-duplicates).
 */

let syncing = false;
let soonTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

function getSetting(key: string): string | null {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function setSetting(key: string, value: string) {
  try {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  } catch {
    // DB might not be ready during boot — ignore.
  }
}

type CloudConfig = { baseUrl: string; key: string; prefix: string };

function resolveCloud(): CloudConfig | null {
  const rawUrl = (process.env.SUPABASE_URL || getSetting('supabase_url') || '').trim();
  const key = (process.env.SUPABASE_ANON_KEY || getSetting('supabase_anon_key') || '').trim();
  if (!rawUrl || !key) return null;
  // Accept https://xxx.supabase.co  ·  …/  ·  …/rest/v1  ·  …/rest/v1/
  const baseUrl = rawUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
  const prefix = (getSetting('supabase_table_prefix') || 'v2_').trim();
  return { baseUrl, key, prefix };
}

export function cloudEnabled(): boolean {
  return getSetting('cloud_sync_enabled') === '1' && resolveCloud() !== null;
}

type Resolution = 'ignore-duplicates' | 'merge-duplicates';

/** Upsert a batch of rows into `{prefix}{table}`. Returns null on success, an error string otherwise. */
async function upsert(
  cfg: CloudConfig,
  table: string,
  rows: any[],
  resolution: Resolution
): Promise<string | null> {
  if (rows.length === 0) return null;
  const res = await fetch(`${cfg.baseUrl}/rest/v1/${cfg.prefix}${table}`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      Prefer: `resolution=${resolution},return=minimal`,
    },
    body: JSON.stringify(rows),
  });
  if (res.ok) return null;
  const text = await res.text().catch(() => '');
  return `${res.status} ${text.slice(0, 200)}`;
}

export type SyncResult = {
  ok: boolean;
  syncedBills: number;
  syncedPreorders: number;
  reason?: string;
};

/**
 * Push every pending bill and pre-order (with their children) to the cloud.
 * Only terminal bills (closed/cancelled) are pushed — open bills change too
 * often and aren't worth backing up until they settle.
 */
export async function syncPending(): Promise<SyncResult> {
  if (syncing) return { ok: true, syncedBills: 0, syncedPreorders: 0, reason: 'already-running' };
  const cfg = resolveCloud();
  if (!cfg) return { ok: false, syncedBills: 0, syncedPreorders: 0, reason: 'supabase-not-configured' };

  syncing = true;
  const db = getDb();
  try {
    const syncedBills = await pushBills(db, cfg);
    const syncedPreorders = await pushPreorders(db, cfg);
    setSetting('last_sync_at', new Date().toISOString());
    setSetting('last_sync_error', '');
    return { ok: true, syncedBills, syncedPreorders };
  } catch (err: any) {
    const reason = err?.message ?? String(err);
    setSetting('last_sync_error', reason);
    return { ok: false, syncedBills: 0, syncedPreorders: 0, reason };
  } finally {
    syncing = false;
  }
}

async function pushBills(db: Database, cfg: CloudConfig): Promise<number> {
  const bills = db
    .prepare(
      `SELECT b.id, b.token_no, b.type, b.status, t.label AS table_label, b.meal_type,
              b.customer_name, b.customer_mobile, b.notes, b.subtotal, b.discount,
              b.total, b.plates, b.opened_at, b.closed_at, b.cancelled_at, b.cancel_reason
       FROM bills b LEFT JOIN tables t ON t.id = b.table_id
       WHERE b.sync_status = 'pending' AND b.status IN ('closed','cancelled')
       ORDER BY b.id ASC LIMIT 500`
    )
    .all() as Array<{ id: number }>;
  if (bills.length === 0) return 0;

  // merge-duplicates so a later change to an already-synced bill (e.g. a void:
  // status→cancelled with a reason) overwrites the cloud copy. Requires an
  // UPDATE policy on the cloud table (see README).
  const billErr = await upsert(cfg, 'bills', bills, 'merge-duplicates');
  if (billErr) throw new Error(`bills: ${billErr}`);

  const ids = bills.map((b) => b.id);
  const inClause = ids.map(() => '?').join(',');

  const items = db
    .prepare(
      `SELECT id, bill_id, menu_item_id, name, qty, unit_price, plate_weight, total, is_custom, sort_order
       FROM bill_items WHERE bill_id IN (${inClause})`
    )
    .all(...ids);
  const itemErr = await upsert(cfg, 'bill_items', items, 'ignore-duplicates');
  if (itemErr) throw new Error(`bill_items: ${itemErr}`);

  const payments = db
    .prepare(
      `SELECT id, bill_id, amount, mode, received_at, cash_received, change_given, notes
       FROM bill_payments WHERE bill_id IN (${inClause})`
    )
    .all(...ids);
  const payErr = await upsert(cfg, 'bill_payments', payments, 'ignore-duplicates');
  if (payErr) throw new Error(`bill_payments: ${payErr}`);

  const mark = db.prepare(`UPDATE bills SET sync_status = 'synced' WHERE id = ?`);
  const tx = db.transaction(() => ids.forEach((id) => mark.run(id)));
  tx();
  return ids.length;
}

async function pushPreorders(db: Database, cfg: CloudConfig): Promise<number> {
  const preorders = db
    .prepare(
      `SELECT id, order_no, customer_name, customer_mobile, for_date, for_time, meal_type,
              notes, total, advance_paid, balance_due, status, fulfilled_bill_id,
              created_at, fulfilled_at, cancelled_at, cancel_reason
       FROM preorders WHERE sync_status = 'pending' ORDER BY id ASC LIMIT 500`
    )
    .all() as Array<{ id: number }>;
  if (preorders.length === 0) return 0;

  // Pre-orders mutate after creation (payments, status, fulfilment) → merge so
  // the cloud row is overwritten with the latest local state.
  const preErr = await upsert(cfg, 'preorders', preorders, 'merge-duplicates');
  if (preErr) throw new Error(`preorders: ${preErr}`);

  const ids = preorders.map((p) => p.id);
  const inClause = ids.map(() => '?').join(',');

  const items = db
    .prepare(
      `SELECT id, preorder_id, menu_item_id, name, qty, unit_price, total, is_custom, sort_order
       FROM preorder_items WHERE preorder_id IN (${inClause})`
    )
    .all(...ids);
  const itemErr = await upsert(cfg, 'preorder_items', items, 'merge-duplicates');
  if (itemErr) throw new Error(`preorder_items: ${itemErr}`);

  const payments = db
    .prepare(
      `SELECT id, preorder_id, amount, mode, received_at, notes
       FROM preorder_payments WHERE preorder_id IN (${inClause})`
    )
    .all(...ids);
  const payErr = await upsert(cfg, 'preorder_payments', payments, 'ignore-duplicates');
  if (payErr) throw new Error(`preorder_payments: ${payErr}`);

  const mark = db.prepare(`UPDATE preorders SET sync_status = 'synced' WHERE id = ?`);
  const tx = db.transaction(() => ids.forEach((id) => mark.run(id)));
  tx();
  return ids.length;
}

/** Count rows actually eligible for sync (terminal bills + all pre-orders). */
export function pendingCount(): number {
  const db = getDb();
  const b = db
    .prepare(
      `SELECT COUNT(*) AS c FROM bills
       WHERE sync_status = 'pending' AND status IN ('closed','cancelled')`
    )
    .get() as { c: number };
  const p = db
    .prepare(`SELECT COUNT(*) AS c FROM preorders WHERE sync_status = 'pending'`)
    .get() as { c: number };
  return b.c + p.c;
}

export function cloudStatus() {
  return {
    enabled: cloudEnabled(),
    configured: resolveCloud() !== null,
    pending: pendingCount(),
    lastSyncAt: getSetting('last_sync_at'),
    lastError: getSetting('last_sync_error') || null,
  };
}

/**
 * Fire a sync shortly after a mutation, coalescing bursts (e.g. closing several
 * bills in a row) into a single push. No-op when cloud sync is disabled.
 */
export function scheduleSoon(delayMs = 4000) {
  if (!cloudEnabled()) return;
  if (soonTimer) clearTimeout(soonTimer);
  soonTimer = setTimeout(() => {
    soonTimer = null;
    void syncPending();
  }, delayMs);
}

/** Background heartbeat: push pending rows every few minutes while enabled. */
export function startCloudScheduler(everyMs = 3 * 60 * 1000) {
  if (intervalTimer) return;
  intervalTimer = setInterval(() => {
    if (cloudEnabled()) void syncPending();
  }, everyMs);
  // First pass shortly after boot so a backlog from the last session goes up.
  scheduleSoon(8000);
}
