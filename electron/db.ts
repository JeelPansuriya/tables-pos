import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const userData = app.getPath('userData');
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
  const file = path.join(userData, 'tables-pos.sqlite');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  initSchema(db);
  dbInstance = db;
  return db;
}

function tableHasColumn(db: Database.Database, table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === col);
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('manager','admin')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      row_no INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT,
      lunch_price REAL NOT NULL DEFAULT 0,
      dinner_price REAL NOT NULL DEFAULT 0,
      plate_weight REAL NOT NULL DEFAULT 1,
      shortcut_key TEXT,
      in_stock INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_no INTEGER,
      type TEXT NOT NULL CHECK (type IN ('dine_in','takeaway','preorder_fulfillment')) DEFAULT 'dine_in',
      status TEXT NOT NULL CHECK (status IN ('open','closed','cancelled')) DEFAULT 'open',
      table_id INTEGER REFERENCES tables(id),
      meal_type TEXT NOT NULL CHECK (meal_type IN ('lunch','dinner')) DEFAULT 'dinner',
      customer_name TEXT,
      customer_mobile TEXT,
      notes TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      plates REAL NOT NULL DEFAULT 0,
      opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      cancelled_at TEXT,
      cancel_reason TEXT,
      created_by_user_id INTEGER REFERENCES users(id),
      closed_by_user_id INTEGER REFERENCES users(id),
      sync_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
    CREATE INDEX IF NOT EXISTS idx_bills_table_status ON bills(table_id, status);
    CREATE INDEX IF NOT EXISTS idx_bills_opened_at ON bills(opened_at);

    CREATE TABLE IF NOT EXISTS bill_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      menu_item_id INTEGER REFERENCES menu_items(id),
      name TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_price REAL NOT NULL,
      plate_weight REAL NOT NULL DEFAULT 1,
      total REAL NOT NULL,
      is_custom INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items(bill_id);

    CREATE TABLE IF NOT EXISTS bill_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('cash','upi','card','other')),
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      cash_received REAL,
      change_given REAL,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);

    CREATE TABLE IF NOT EXISTS preorders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no INTEGER,
      customer_name TEXT NOT NULL,
      customer_mobile TEXT,
      for_date TEXT NOT NULL,
      for_time TEXT,
      meal_type TEXT CHECK (meal_type IN ('lunch','dinner')),
      notes TEXT,
      total REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      advance_paid REAL NOT NULL DEFAULT 0,
      balance_due REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('pending','partial','paid','fulfilled','cancelled')) DEFAULT 'pending',
      fulfilled_bill_id INTEGER REFERENCES bills(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      fulfilled_at TEXT,
      cancelled_at TEXT,
      cancel_reason TEXT,
      created_by_user_id INTEGER REFERENCES users(id),
      sync_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_preorders_status ON preorders(status);
    CREATE INDEX IF NOT EXISTS idx_preorders_for_date ON preorders(for_date);

    CREATE TABLE IF NOT EXISTS preorder_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preorder_id INTEGER NOT NULL REFERENCES preorders(id) ON DELETE CASCADE,
      menu_item_id INTEGER REFERENCES menu_items(id),
      name TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      is_custom INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_preorder_items_preorder ON preorder_items(preorder_id);

    CREATE TABLE IF NOT EXISTS preorder_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preorder_id INTEGER NOT NULL REFERENCES preorders(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('cash','upi','card','other')),
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_preorder_payments_preorder ON preorder_payments(preorder_id);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      actor_user_id INTEGER REFERENCES users(id),
      actor_username TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

    CREATE TABLE IF NOT EXISTS cash_counts (
      date TEXT PRIMARY KEY,                -- business day YYYY-MM-DD (local)
      counted_cash REAL NOT NULL,           -- cash physically counted at end of day
      note TEXT,
      counted_by_user_id INTEGER REFERENCES users(id),
      counted_at TEXT NOT NULL DEFAULT (datetime('now')),
      sync_status TEXT NOT NULL DEFAULT 'pending'
    );

    -- Money tracker: the day's total expenses (cash + UPI) entered directly by
    -- the manager. One row per business day; any past day can be backfilled so
    -- the ledger is consistent from the start.
    CREATE TABLE IF NOT EXISTS day_expenses (
      date TEXT PRIMARY KEY,                -- business day YYYY-MM-DD (local)
      cash_expense REAL NOT NULL DEFAULT 0, -- total spent in cash that day
      upi_expense REAL NOT NULL DEFAULT 0,  -- total spent via UPI that day
      cash_extra REAL NOT NULL DEFAULT 0,   -- extra cash taken in outside a bill (tips, misc, dues)
      upi_extra REAL NOT NULL DEFAULT 0,    -- extra UPI taken in outside a bill
      note TEXT,
      updated_by_user_id INTEGER REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      sync_status TEXT NOT NULL DEFAULT 'pending'
    );
  `);

  // Migrate older dev databases that created cash_counts without sync_status.
  if (!tableHasColumn(db, 'cash_counts', 'sync_status')) {
    db.exec(`ALTER TABLE cash_counts ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending'`);
  }
  // Migrate: pre-order discount (applied at fulfillment).
  if (!tableHasColumn(db, 'preorders', 'discount')) {
    db.exec(`ALTER TABLE preorders ADD COLUMN discount REAL NOT NULL DEFAULT 0`);
  }
  // Migrate: extra cash/UPI taken in outside a bill (Money tracker).
  if (!tableHasColumn(db, 'day_expenses', 'cash_extra')) {
    db.exec(`ALTER TABLE day_expenses ADD COLUMN cash_extra REAL NOT NULL DEFAULT 0`);
  }
  if (!tableHasColumn(db, 'day_expenses', 'upi_extra')) {
    db.exec(`ALTER TABLE day_expenses ADD COLUMN upi_extra REAL NOT NULL DEFAULT 0`);
  }

  seedTables(db);
  // The walk-in "Counter" behaves like a table (multiple open bills, settle,
  // etc.). Seeded unconditionally with INSERT OR IGNORE (label is UNIQUE) so
  // existing databases pick it up on upgrade too. row_no 2 / sort_order 6 puts
  // it first in the bottom row, which lines each row's last table up.
  db.prepare(`INSERT OR IGNORE INTO tables (label, row_no, sort_order) VALUES ('Counter', 2, 6)`).run();
  seedDefaults(db);
  seedAdminUser(db);
  // Self-heal: importing v1 history / cloud rows carries 60-bit ids (~10^18),
  // which pushed AUTOINCREMENT past JS's safe-integer limit — so freshly created
  // bills got ids that collapse to the same JS number and the UI matched the
  // wrong bill (items appearing on every table). Pull the counters back into the
  // safe range so new bills/pre-orders always get exact, distinct ids.
  clampAutoIncrementToSafe(db);
  // ...and clear any ghost open bills the bug already created (huge ids that
  // collide in the UI and appear on every table). One-off self-clean on launch.
  const purged = purgeCorruptOpenBills(db);
  if (purged > 0) console.log(`Removed ${purged} corrupt open bill(s) with unsafe ids.`);
}

// Largest integer JavaScript can represent exactly (2^53 - 1). Ids above this
// lose precision when read into the renderer, so two different bills can compare
// equal — hence bills/pre-orders must keep their ids at or below this.
const MAX_SAFE_ID = 9007199254740991;

/**
 * Keep the AUTOINCREMENT counters for `bills` and `preorders` within JS's
 * safe-integer range. Imported v1/cloud rows use huge 60-bit ids; inserting them
 * bumps sqlite_sequence into the unsafe zone, so subsequent auto-assigned ids
 * collapse to indistinguishable JS numbers. Resetting the sequence to the
 * largest *safe* existing id means new rows get exact ids (safe_max+1, +2, …)
 * that never collide with the huge historical rows. Safe to run every launch.
 */
export function clampAutoIncrementToSafe(db: Database.Database) {
  for (const table of ['bills', 'preorders'] as const) {
    const seqRow = db
      .prepare(`SELECT seq FROM sqlite_sequence WHERE name=?`)
      .get(table) as { seq: number } | undefined;
    // Nothing to do if the table never auto-inserted, or the counter is already safe.
    if (!seqRow || seqRow.seq <= MAX_SAFE_ID) continue;
    const maxSafe = (
      db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${table} WHERE id <= ?`).get(MAX_SAFE_ID) as {
        m: number;
      }
    ).m;
    db.prepare(`UPDATE sqlite_sequence SET seq=? WHERE name=?`).run(maxSafe, table);
  }
}

/**
 * Remove OPEN bills whose id is above the JS-safe range. These can only be
 * "ghost" bills created during the id-overflow bug (imported/cloud history is
 * always closed or cancelled, never open). Their huge ids collide in the
 * renderer, so they show up on every table and can't be opened or settled
 * correctly — deleting them (children cascade) is the only clean cure. Safe:
 * legitimate open bills always have small, in-range ids. Returns rows removed.
 */
export function purgeCorruptOpenBills(db: Database.Database): number {
  const r = db.prepare(`DELETE FROM bills WHERE status='open' AND id > ?`).run(MAX_SAFE_ID);
  return r.changes;
}

function seedTables(db: Database.Database) {
  const seeded = (db.prepare(`SELECT value FROM settings WHERE key='tables_seeded'`).get() as { value?: string } | undefined)?.value;
  if (seeded === '1') return;
  const insert = db.prepare(`INSERT OR IGNORE INTO tables (label, row_no, sort_order) VALUES (?, ?, ?)`);
  const tx = db.transaction(() => {
    for (let i = 1; i <= 6; i++) insert.run(`T${i}`, 1, i);
    for (let i = 7; i <= 11; i++) insert.run(`T${i}`, 2, i);
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('tables_seeded', '1')`).run();
  });
  tx();
}

function seedDefaults(db: Database.Database) {
  const defaults: Array<[string, string]> = [
    ['restaurant_name', 'Girr Kathiyawadi'],
    ['restaurant_address', ''],
    ['restaurant_phone', ''],
    ['gst_no', ''],
    ['default_meal_type', 'dinner'],
    ['lunch_until_hour', '17'],
    ['printer_name', ''],
    ['printer_copies', '1'],
    ['backup_extra_dir', ''],
    ['supabase_url', ''],
    ['supabase_anon_key', ''],
    ['supabase_table_prefix', 'v2_'],
    ['cloud_sync_enabled', '0'],
    ['discount_max_pct', '20'],
  ];
  const stmt = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of defaults) stmt.run(k, v);
}

// An earlier build seeded this placeholder hash with a (false) comment claiming
// it was bcrypt('owner'). It does NOT match "owner", so the documented bootstrap
// login failed. We detect it and repair existing databases below.
const LEGACY_SENTINEL_HASH = '$2a$10$NnrnP3UM5tbg9YcptVyNK.8TDU2cHnmxxhSkOtL.hKdNNIULZF1pi';

function seedAdminUser(db: Database.Database) {
  // Bootstrap: a single admin user "owner" / "owner". The first thing the
  // operator should do on a fresh install is log in and change the password
  // (Settings → Change my password).
  const has = (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c > 0;
  if (!has) {
    db.prepare(
      `INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`
    ).run('owner', bcrypt.hashSync('owner', 10));
    return;
  }
  // Repair databases created by the earlier build: if the owner account still
  // carries the broken placeholder hash, replace it with a real bcrypt('owner')
  // so owner/owner works as documented. Accounts with a changed password are
  // left untouched.
  const owner = db
    .prepare(`SELECT id, password_hash FROM users WHERE username = 'owner'`)
    .get() as { id: number; password_hash: string } | undefined;
  if (owner && owner.password_hash === LEGACY_SENTINEL_HASH) {
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
      bcrypt.hashSync('owner', 10),
      owner.id
    );
  }
}

/**
 * End-of-day cleanup: any bill still 'open' from a previous calendar day is
 * auto-cancelled (they were never settled). Runs at startup and hourly, so a
 * day's leftover open bills don't linger or distort the next day's tables.
 * These have no token, so they don't appear as voided sales in reports.
 */
export function autoCancelStaleOpenBills(db: Database.Database): number {
  const r = db
    .prepare(
      `UPDATE bills
         SET status='cancelled', cancelled_at=datetime('now'),
             cancel_reason='Auto-cancelled (left open at end of day)',
             sync_status='pending'
       WHERE status='open' AND date(opened_at,'localtime') < date('now','localtime')`
    )
    .run();
  return r.changes;
}

/** Keep only the most recent `keep` daily backup files in a directory. */
function pruneBackups(dir: string, keep: number) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^tables-pos-.*\.sqlite$/.test(f))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      // ignore prune failures
    }
  }
}

/**
 * Copy the live database to userData/backups/tables-pos-YYYY-MM-DD.sqlite using
 * SQLite's online backup (safe while the app is running). One file per day;
 * keeps the most recent `keep` days. Runs at launch and daily from main.ts so
 * there's always a recent local copy even when cloud sync is off.
 *
 * If `backup_extra_dir` is set (e.g. a OneDrive/Google Drive synced folder or a
 * USB drive), the same daily file is also copied there — an off-PC copy that
 * survives a dead/stolen machine. A disconnected/invalid path is ignored.
 */
export async function backupDatabase(keep = 14): Promise<void> {
  const db = getDb();
  const dir = path.join(app.getPath('userData'), 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const fileName = `tables-pos-${stamp}.sqlite`;
  const primary = path.join(dir, fileName);
  await db.backup(primary);
  pruneBackups(dir, keep);

  const extra = (
    db.prepare(`SELECT value FROM settings WHERE key='backup_extra_dir'`).get() as
      | { value?: string }
      | undefined
  )?.value?.trim();
  if (extra) {
    try {
      if (!fs.existsSync(extra)) fs.mkdirSync(extra, { recursive: true });
      fs.copyFileSync(primary, path.join(extra, fileName));
      pruneBackups(extra, keep);
    } catch (e) {
      console.error('Off-PC backup copy failed (folder unavailable?):', e);
    }
  }

  try {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('last_backup_at', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(now.toISOString());
  } catch {
    // ignore
  }
}

// helper exported so IPC layer can use it for ad-hoc migrations
export const dbHelpers = { tableHasColumn };
