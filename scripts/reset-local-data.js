// One-off: wipe LOCAL transactional test data from this device's SQLite DB,
// keeping menu / settings / users / tables. Backs the file up first.
// Run with Electron's node ABI:  ELECTRON_RUN_AS_NODE=1 electron scripts/reset-local-data.js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Girr Kathiyawadi Tables', 'tables-pos.sqlite');
if (!fs.existsSync(dbPath)) {
  console.error('DB not found at', dbPath);
  process.exit(1);
}

// Back up first (timestamp passed in via env so the script stays deterministic).
const stamp = process.env.RESET_STAMP || 'manual';
const backupDir = path.join(path.dirname(dbPath), 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `pre-reset-${stamp}.sqlite`);
fs.copyFileSync(dbPath, backupPath);
console.log('Backup saved:', backupPath);

const db = new Database(dbPath);
db.pragma('foreign_keys = OFF');

// Children first, then parents. Only transactional data — never menu/settings/users/tables.
const tables = [
  'bill_payments',
  'bill_items',
  'preorder_payments',
  'preorder_items',
  'bills',
  'preorders',
  'cash_counts',
  'day_expenses',
  'audit_log',
];

const before = {};
const after = {};
const has = (t) =>
  !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);

const tx = db.transaction(() => {
  for (const t of tables) {
    if (!has(t)) continue;
    before[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    db.prepare(`DELETE FROM ${t}`).run();
    after[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  }
});
tx();

db.pragma('foreign_keys = ON');
db.exec('VACUUM');

console.log('Cleared (rows before -> after):');
for (const t of tables) if (t in before) console.log(`  ${t}: ${before[t]} -> ${after[t]}`);

// Sanity: confirm kept tables are untouched.
for (const t of ['menu_items', 'settings', 'users', 'tables']) {
  if (has(t)) console.log(`  KEPT ${t}: ${db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c} rows`);
}
db.close();
console.log('Done.');
