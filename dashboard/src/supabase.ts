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
