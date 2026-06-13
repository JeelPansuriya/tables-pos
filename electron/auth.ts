import bcrypt from 'bcryptjs';
import type { Database } from 'better-sqlite3';

export type Session = {
  userId: number;
  username: string;
  role: 'manager' | 'admin';
} | null;

let session: Session = null;

export function getSession(): Session {
  return session;
}

export function setSession(s: Session) {
  session = s;
}

export function requireSession(): NonNullable<Session> {
  if (!session) throw new Error('Not authenticated');
  return session;
}

export function requireAdmin(): NonNullable<Session> {
  const s = requireSession();
  if (s.role !== 'admin') throw new Error('Admin only');
  return s;
}

export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 10);
}

export function verifyPassword(pw: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(pw, hash);
  } catch {
    return false;
  }
}

export function login(db: Database, username: string, password: string): Session {
  const row = db
    .prepare(
      `SELECT id, username, password_hash, role, active FROM users WHERE username = ?`
    )
    .get(username) as
    | { id: number; username: string; password_hash: string; role: 'manager' | 'admin'; active: number }
    | undefined;
  if (!row || !row.active) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  session = { userId: row.id, username: row.username, role: row.role };
  return session;
}

export function logAudit(
  db: Database,
  action: string,
  details?: { entity_type?: string; entity_id?: number | null; details?: unknown }
) {
  const s = getSession();
  db.prepare(
    `INSERT INTO audit_log (actor_user_id, actor_username, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    s?.userId ?? null,
    s?.username ?? null,
    action,
    details?.entity_type ?? null,
    details?.entity_id ?? null,
    details?.details === undefined ? null : JSON.stringify(details.details)
  );
}
