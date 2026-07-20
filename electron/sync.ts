import type { Database } from 'better-sqlite3';
import { getDb, clampAutoIncrementToSafe } from './db';

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

// Rows pulled from the cloud (imported v1 history, other devices) can carry ids
// above JS's safe-integer range, which round when they come through JSON. They
// already exist in the cloud, so they must never be pushed back — doing so would
// mint a duplicate under the rounded id. Every push path filters them out.
const MAX_SAFE_ID = 9007199254740991; // Number.MAX_SAFE_INTEGER

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
    await pushDayExpenses(db, cfg);
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
         AND b.id <= ${MAX_SAFE_ID}
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
       FROM preorders WHERE sync_status = 'pending' AND id <= ${MAX_SAFE_ID} ORDER BY id ASC LIMIT 500`
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

/**
 * Push the Money-tracker day expenses (cash + UPI totals entered per day). One
 * row per day, editable later, so upsert with merge-duplicates so a later edit
 * overwrites the cloud copy. Pending-tracked like bills/pre-orders.
 */
async function pushDayExpenses(db: Database, cfg: CloudConfig): Promise<number> {
  const rows = db
    .prepare(
      `SELECT date, cash_expense, upi_expense, cash_extra, upi_extra, note, updated_at FROM day_expenses
       WHERE sync_status = 'pending' ORDER BY date ASC`
    )
    .all() as Array<{ date: string }>;
  if (rows.length === 0) return 0;
  const err = await upsert(cfg, 'day_expenses', rows, 'merge-duplicates');
  if (err) throw new Error(`day_expenses: ${err}`);
  const mark = db.prepare(`UPDATE day_expenses SET sync_status='synced' WHERE date=?`);
  const tx = db.transaction(() => rows.forEach((r) => mark.run(r.date)));
  tx();
  return rows.length;
}

/** GET every row from a cloud table, paging past PostgREST's row cap. */
async function fetchAll(cfg: CloudConfig, table: string): Promise<any[]> {
  const out: any[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetch(
      `${cfg.baseUrl}/rest/v1/${cfg.prefix}${table}?select=*&limit=${pageSize}&offset=${offset}`,
      { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` } }
    );
    if (!res.ok)
      throw new Error(`${table}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
    const rows = (await res.json()) as any[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

export type PullResult = { ok: boolean; error?: string; counts?: Record<string, number> };

/**
 * Pull every backed-up table from the cloud and OVERWRITE local transactional
 * data (bills, pre-orders, cash counts + children). Menu, settings, tables and
 * users aren't cloud-backed, so they're left untouched. Local open/unsynced
 * bills aren't in the cloud and will be removed — the caller backs up first.
 */
export async function pullAndOverride(): Promise<PullResult> {
  const cfg = resolveCloud();
  if (!cfg) return { ok: false, error: 'Supabase URL/key not set.' };
  const db = getDb();
  try {
    const [billsRaw, billItems, billPayments, preordersRaw, preorderItems, preorderPayments, cashCounts] =
      await Promise.all([
        fetchAll(cfg, 'bills'),
        fetchAll(cfg, 'bill_items'),
        fetchAll(cfg, 'bill_payments'),
        fetchAll(cfg, 'preorders'),
        fetchAll(cfg, 'preorder_items'),
        fetchAll(cfg, 'preorder_payments'),
        fetchAll(cfg, 'cash_counts'),
      ]);
    // Never restore the archived v1/cloud rows (huge 60-bit ids) into the
    // operating DB — they overflow JS's safe-integer range and corrupt bill
    // lookups. Only this PC's own small-id operational rows come back; the
    // archive stays in the cloud for the dashboard. Child rows are already
    // filtered by the surviving bill/pre-order id sets below.
    const OP_ID_CAP = 1_000_000_000;
    const bills = billsRaw.filter((b: any) => Number(b.id) <= OP_ID_CAP);
    const preorders = preordersRaw.filter((p: any) => Number(p.id) <= OP_ID_CAP);

    const tableByLabel = new Map(
      (db.prepare(`SELECT id, label FROM tables`).all() as Array<{ id: number; label: string }>).map(
        (t) => [t.label, t.id]
      )
    );
    const menuIds = new Set(
      (db.prepare(`SELECT id FROM menu_items`).all() as Array<{ id: number }>).map((m) => m.id)
    );
    const billIds = new Set(bills.map((b) => b.id));
    const preIds = new Set(preorders.map((p) => p.id));
    const menuId = (v: any) => (v != null && menuIds.has(v) ? v : null);

    const tx = db.transaction(() => {
      db.exec(`DELETE FROM bill_payments; DELETE FROM bill_items;
               DELETE FROM preorder_payments; DELETE FROM preorder_items;
               DELETE FROM preorders; DELETE FROM bills; DELETE FROM cash_counts;`);

      const insBill = db.prepare(
        `INSERT INTO bills (id, token_no, type, status, table_id, meal_type, customer_name,
           customer_mobile, notes, subtotal, discount, total, plates, opened_at, closed_at,
           cancelled_at, cancel_reason, sync_status)
         VALUES (@id,@token_no,@type,@status,@table_id,@meal_type,@customer_name,@customer_mobile,
           @notes,@subtotal,@discount,@total,@plates,@opened_at,@closed_at,@cancelled_at,@cancel_reason,'synced')`
      );
      for (const b of bills)
        insBill.run({
          id: b.id, token_no: b.token_no ?? null, type: b.type ?? 'dine_in', status: b.status ?? 'closed',
          table_id: tableByLabel.get(b.table_label) ?? null, meal_type: b.meal_type ?? 'dinner',
          customer_name: b.customer_name ?? null, customer_mobile: b.customer_mobile ?? null,
          notes: b.notes ?? null, subtotal: b.subtotal ?? 0, discount: b.discount ?? 0,
          total: b.total ?? 0, plates: b.plates ?? 0, opened_at: b.opened_at ?? null,
          closed_at: b.closed_at ?? null, cancelled_at: b.cancelled_at ?? null, cancel_reason: b.cancel_reason ?? null,
        });

      const insBillItem = db.prepare(
        `INSERT INTO bill_items (id, bill_id, menu_item_id, name, qty, unit_price, plate_weight, total, is_custom, sort_order)
         VALUES (@id,@bill_id,@menu_item_id,@name,@qty,@unit_price,@plate_weight,@total,@is_custom,@sort_order)`
      );
      for (const it of billItems)
        if (billIds.has(it.bill_id))
          insBillItem.run({
            id: it.id, bill_id: it.bill_id, menu_item_id: menuId(it.menu_item_id), name: it.name,
            qty: it.qty, unit_price: it.unit_price, plate_weight: it.plate_weight ?? 1,
            total: it.total, is_custom: it.is_custom ?? 0, sort_order: it.sort_order ?? 0,
          });

      const insBillPay = db.prepare(
        `INSERT INTO bill_payments (id, bill_id, amount, mode, received_at, cash_received, change_given, notes)
         VALUES (@id,@bill_id,@amount,@mode,@received_at,@cash_received,@change_given,@notes)`
      );
      for (const p of billPayments)
        if (billIds.has(p.bill_id))
          insBillPay.run({
            id: p.id, bill_id: p.bill_id, amount: p.amount, mode: p.mode, received_at: p.received_at ?? null,
            cash_received: p.cash_received ?? null, change_given: p.change_given ?? null, notes: p.notes ?? null,
          });

      const insPre = db.prepare(
        `INSERT INTO preorders (id, order_no, customer_name, customer_mobile, for_date, for_time, meal_type,
           notes, total, advance_paid, balance_due, status, fulfilled_bill_id, created_at, fulfilled_at,
           cancelled_at, cancel_reason, sync_status)
         VALUES (@id,@order_no,@customer_name,@customer_mobile,@for_date,@for_time,@meal_type,@notes,@total,
           @advance_paid,@balance_due,@status,@fulfilled_bill_id,@created_at,@fulfilled_at,@cancelled_at,@cancel_reason,'synced')`
      );
      for (const p of preorders)
        insPre.run({
          id: p.id, order_no: p.order_no ?? null, customer_name: p.customer_name, customer_mobile: p.customer_mobile ?? null,
          for_date: p.for_date, for_time: p.for_time ?? null, meal_type: p.meal_type ?? null, notes: p.notes ?? null,
          total: p.total ?? 0, advance_paid: p.advance_paid ?? 0, balance_due: p.balance_due ?? 0,
          status: p.status ?? 'pending', fulfilled_bill_id: billIds.has(p.fulfilled_bill_id) ? p.fulfilled_bill_id : null,
          created_at: p.created_at ?? null, fulfilled_at: p.fulfilled_at ?? null, cancelled_at: p.cancelled_at ?? null,
          cancel_reason: p.cancel_reason ?? null,
        });

      const insPreItem = db.prepare(
        `INSERT INTO preorder_items (id, preorder_id, menu_item_id, name, qty, unit_price, total, is_custom, sort_order)
         VALUES (@id,@preorder_id,@menu_item_id,@name,@qty,@unit_price,@total,@is_custom,@sort_order)`
      );
      for (const it of preorderItems)
        if (preIds.has(it.preorder_id))
          insPreItem.run({
            id: it.id, preorder_id: it.preorder_id, menu_item_id: menuId(it.menu_item_id), name: it.name,
            qty: it.qty, unit_price: it.unit_price, total: it.total, is_custom: it.is_custom ?? 0, sort_order: it.sort_order ?? 0,
          });

      const insPrePay = db.prepare(
        `INSERT INTO preorder_payments (id, preorder_id, amount, mode, received_at, notes)
         VALUES (@id,@preorder_id,@amount,@mode,@received_at,@notes)`
      );
      for (const p of preorderPayments)
        if (preIds.has(p.preorder_id))
          insPrePay.run({
            id: p.id, preorder_id: p.preorder_id, amount: p.amount, mode: p.mode, received_at: p.received_at ?? null, notes: p.notes ?? null,
          });

      const insCash = db.prepare(
        `INSERT INTO cash_counts (date, counted_cash, note, counted_at, sync_status)
         VALUES (@date,@counted_cash,@note,@counted_at,'synced')`
      );
      for (const c of cashCounts)
        insCash.run({ date: c.date, counted_cash: c.counted_cash ?? 0, note: c.note ?? null, counted_at: c.counted_at ?? null });
    });
    tx();
    // Huge imported ids just bumped the AUTOINCREMENT counters — pull them back
    // into JS's safe range so new bills/pre-orders get exact, distinct ids.
    clampAutoIncrementToSafe(db);

    return { ok: true, counts: { bills: bills.length, preorders: preorders.length, cash_counts: cashCounts.length } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Additive merge-pull: bring down every cloud row this PC is MISSING and insert
 * it (INSERT OR IGNORE — keyed on the primary key), leaving all existing local
 * rows untouched. This is how the imported v1 history (and anything created on
 * another device) appears in the app, without the data-loss risk of the
 * destructive `pullAndOverride`. Safe to run repeatedly (idempotent).
 *
 * Note: rows are matched by primary key. This is correct for a single active
 * till plus imported/other-device history (the ids don't overlap). It is NOT a
 * conflict-resolving multi-writer sync — two tills independently minting the
 * same auto-increment id would collide; that needs the two-way model instead.
 */
export async function pullAndMerge(): Promise<PullResult> {
  const cfg = resolveCloud();
  if (!cfg) return { ok: false, error: 'Supabase URL/key not set.' };
  const db = getDb();
  try {
    const [bills, billItems, billPayments, preorders, preorderItems, preorderPayments, cashCounts, dayExpenses] =
      await Promise.all([
        fetchAll(cfg, 'bills'),
        fetchAll(cfg, 'bill_items'),
        fetchAll(cfg, 'bill_payments'),
        fetchAll(cfg, 'preorders'),
        fetchAll(cfg, 'preorder_items'),
        fetchAll(cfg, 'preorder_payments'),
        fetchAll(cfg, 'cash_counts'),
        fetchAll(cfg, 'day_expenses').catch(() => [] as any[]), // table may not exist yet
      ]);

    const tableByLabel = new Map(
      (db.prepare(`SELECT id, label FROM tables`).all() as Array<{ id: number; label: string }>).map(
        (t) => [t.label, t.id]
      )
    );
    const menuIds = new Set(
      (db.prepare(`SELECT id FROM menu_items`).all() as Array<{ id: number }>).map((m) => m.id)
    );
    const menuId = (v: any) => (v != null && menuIds.has(v) ? v : null);

    // A child row is only inserted if its parent will be present locally after
    // this pass (existing local rows ∪ the cloud rows we're inserting now).
    const billIds = new Set<number>(
      (db.prepare(`SELECT id FROM bills`).all() as Array<{ id: number }>).map((b) => b.id)
    );
    for (const b of bills) billIds.add(b.id);
    const preIds = new Set<number>(
      (db.prepare(`SELECT id FROM preorders`).all() as Array<{ id: number }>).map((p) => p.id)
    );
    for (const p of preorders) preIds.add(p.id);

    let addedBills = 0, addedPre = 0, addedCash = 0, addedExp = 0;

    const tx = db.transaction(() => {
      const insBill = db.prepare(
        `INSERT OR IGNORE INTO bills (id, token_no, type, status, table_id, meal_type, customer_name,
           customer_mobile, notes, subtotal, discount, total, plates, opened_at, closed_at,
           cancelled_at, cancel_reason, sync_status)
         VALUES (@id,@token_no,@type,@status,@table_id,@meal_type,@customer_name,@customer_mobile,
           @notes,@subtotal,@discount,@total,@plates,@opened_at,@closed_at,@cancelled_at,@cancel_reason,'synced')`
      );
      for (const b of bills)
        addedBills += insBill.run({
          id: b.id, token_no: b.token_no ?? null, type: b.type ?? 'dine_in', status: b.status ?? 'closed',
          table_id: tableByLabel.get(b.table_label) ?? null, meal_type: b.meal_type ?? 'dinner',
          customer_name: b.customer_name ?? null, customer_mobile: b.customer_mobile ?? null,
          notes: b.notes ?? null, subtotal: b.subtotal ?? 0, discount: b.discount ?? 0,
          total: b.total ?? 0, plates: b.plates ?? 0, opened_at: b.opened_at ?? null,
          closed_at: b.closed_at ?? null, cancelled_at: b.cancelled_at ?? null, cancel_reason: b.cancel_reason ?? null,
        }).changes;

      const insBillItem = db.prepare(
        `INSERT OR IGNORE INTO bill_items (id, bill_id, menu_item_id, name, qty, unit_price, plate_weight, total, is_custom, sort_order)
         VALUES (@id,@bill_id,@menu_item_id,@name,@qty,@unit_price,@plate_weight,@total,@is_custom,@sort_order)`
      );
      for (const it of billItems)
        if (billIds.has(it.bill_id))
          insBillItem.run({
            id: it.id, bill_id: it.bill_id, menu_item_id: menuId(it.menu_item_id), name: it.name,
            qty: it.qty, unit_price: it.unit_price, plate_weight: it.plate_weight ?? 1,
            total: it.total, is_custom: it.is_custom ?? 0, sort_order: it.sort_order ?? 0,
          });

      const insBillPay = db.prepare(
        `INSERT OR IGNORE INTO bill_payments (id, bill_id, amount, mode, received_at, cash_received, change_given, notes)
         VALUES (@id,@bill_id,@amount,@mode,@received_at,@cash_received,@change_given,@notes)`
      );
      for (const p of billPayments)
        if (billIds.has(p.bill_id))
          insBillPay.run({
            id: p.id, bill_id: p.bill_id, amount: p.amount, mode: p.mode, received_at: p.received_at ?? null,
            cash_received: p.cash_received ?? null, change_given: p.change_given ?? null, notes: p.notes ?? null,
          });

      const insPre = db.prepare(
        `INSERT OR IGNORE INTO preorders (id, order_no, customer_name, customer_mobile, for_date, for_time, meal_type,
           notes, total, advance_paid, balance_due, status, fulfilled_bill_id, created_at, fulfilled_at,
           cancelled_at, cancel_reason, sync_status)
         VALUES (@id,@order_no,@customer_name,@customer_mobile,@for_date,@for_time,@meal_type,@notes,@total,
           @advance_paid,@balance_due,@status,@fulfilled_bill_id,@created_at,@fulfilled_at,@cancelled_at,@cancel_reason,'synced')`
      );
      for (const p of preorders)
        addedPre += insPre.run({
          id: p.id, order_no: p.order_no ?? null, customer_name: p.customer_name, customer_mobile: p.customer_mobile ?? null,
          for_date: p.for_date, for_time: p.for_time ?? null, meal_type: p.meal_type ?? null, notes: p.notes ?? null,
          total: p.total ?? 0, advance_paid: p.advance_paid ?? 0, balance_due: p.balance_due ?? 0,
          status: p.status ?? 'pending', fulfilled_bill_id: billIds.has(p.fulfilled_bill_id) ? p.fulfilled_bill_id : null,
          created_at: p.created_at ?? null, fulfilled_at: p.fulfilled_at ?? null, cancelled_at: p.cancelled_at ?? null,
          cancel_reason: p.cancel_reason ?? null,
        }).changes;

      const insPreItem = db.prepare(
        `INSERT OR IGNORE INTO preorder_items (id, preorder_id, menu_item_id, name, qty, unit_price, total, is_custom, sort_order)
         VALUES (@id,@preorder_id,@menu_item_id,@name,@qty,@unit_price,@total,@is_custom,@sort_order)`
      );
      for (const it of preorderItems)
        if (preIds.has(it.preorder_id))
          insPreItem.run({
            id: it.id, preorder_id: it.preorder_id, menu_item_id: menuId(it.menu_item_id), name: it.name,
            qty: it.qty, unit_price: it.unit_price, total: it.total, is_custom: it.is_custom ?? 0, sort_order: it.sort_order ?? 0,
          });

      const insPrePay = db.prepare(
        `INSERT OR IGNORE INTO preorder_payments (id, preorder_id, amount, mode, received_at, notes)
         VALUES (@id,@preorder_id,@amount,@mode,@received_at,@notes)`
      );
      for (const p of preorderPayments)
        if (preIds.has(p.preorder_id))
          insPrePay.run({
            id: p.id, preorder_id: p.preorder_id, amount: p.amount, mode: p.mode, received_at: p.received_at ?? null, notes: p.notes ?? null,
          });

      const insCash = db.prepare(
        `INSERT OR IGNORE INTO cash_counts (date, counted_cash, note, counted_at, sync_status)
         VALUES (@date,@counted_cash,@note,@counted_at,'synced')`
      );
      for (const c of cashCounts)
        addedCash += insCash.run({ date: c.date, counted_cash: c.counted_cash ?? 0, note: c.note ?? null, counted_at: c.counted_at ?? null }).changes;

      const insExp = db.prepare(
        `INSERT OR IGNORE INTO day_expenses (date, cash_expense, upi_expense, cash_extra, upi_extra, note, updated_at, sync_status)
         VALUES (@date,@cash_expense,@upi_expense,@cash_extra,@upi_extra,@note,@updated_at,'synced')`
      );
      for (const e of dayExpenses)
        addedExp += insExp.run({
          date: e.date, cash_expense: e.cash_expense ?? 0, upi_expense: e.upi_expense ?? 0,
          cash_extra: e.cash_extra ?? 0, upi_extra: e.upi_extra ?? 0,
          note: e.note ?? null, updated_at: e.updated_at ?? null,
        }).changes;
    });
    tx();
    // Huge imported ids just bumped the AUTOINCREMENT counters — pull them back
    // into JS's safe range so new bills/pre-orders get exact, distinct ids.
    clampAutoIncrementToSafe(db);

    return { ok: true, counts: { bills: addedBills, preorders: addedPre, cash_counts: addedCash, day_expenses: addedExp } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** Count rows actually eligible for sync (terminal bills + all pre-orders). */
export function pendingCount(): number {
  const db = getDb();
  const b = db
    .prepare(
      `SELECT COUNT(*) AS c FROM bills
       WHERE sync_status = 'pending' AND status IN ('closed','cancelled') AND id <= ${MAX_SAFE_ID}`
    )
    .get() as { c: number };
  const p = db
    .prepare(`SELECT COUNT(*) AS c FROM preorders WHERE sync_status = 'pending' AND id <= ${MAX_SAFE_ID}`)
    .get() as { c: number };
  const cash = db
    .prepare(`SELECT COUNT(*) AS c FROM cash_counts WHERE sync_status = 'pending'`)
    .get() as { c: number };
  return b.c + p.c + cash.c;
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
    // Only hit the network when there's actually something to push — an idle
    // counter makes no cloud calls at all.
    if (cloudEnabled() && pendingCount() > 0) void syncPending();
  }, everyMs);
  // First pass shortly after boot so a backlog from the last session goes up.
  scheduleSoon(8000);
}
