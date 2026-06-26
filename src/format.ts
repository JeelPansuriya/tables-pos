// Stored timestamps are UTC "YYYY-MM-DD HH:MM:SS" (SQLite datetime('now')),
// with no timezone marker. Parse them as UTC and render in the machine's local
// timezone so the UI doesn't show times hours off.

function parseUtc(s?: string | null): Date | null {
  if (!s) return null;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  // Append Z only when there's no explicit timezone, so the value is read as UTC.
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(iso);
  const d = new Date(hasTz ? iso : iso + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDateTime(s?: string | null): string {
  const d = parseUtc(s);
  if (!d) return '—';
  return d.toLocaleString([], {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtDate(s?: string | null): string {
  const d = parseUtc(s);
  if (!d) return '—';
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function fmtTime(s?: string | null): string {
  const d = parseUtc(s);
  if (!d) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
