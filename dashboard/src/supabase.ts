import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const TABLE_PREFIX = (import.meta.env.VITE_TABLE_PREFIX as string) || 'v2_';
export const TIMEZONE = (import.meta.env.VITE_TIMEZONE as string) || 'Asia/Kolkata';

export const configMissing = !url || !anonKey;

// Persists the session in localStorage so the dashboard stays logged in on a phone.
export const supabase = createClient(url || 'http://localhost', anonKey || 'public-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Prefixed table name, e.g. table('bills') -> 'v2_bills'. */
export const table = (name: string) => `${TABLE_PREFIX}${name}`;

/**
 * Fetch ALL rows a query would return, paging past PostgREST's ~1000-row cap.
 * `make(from, to)` must build the query with `.range(from, to)` (and an
 * `.order(...)` for stable paging). Without this, a query silently returns only
 * the first 1000 rows, so recent data disappears once a window exceeds 1000.
 */
export async function pageAll<T = any>(
  make: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await make(from, from + size - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}
