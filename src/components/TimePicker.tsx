import React from 'react';

type Props = {
  /** 24-hour "HH:MM" string, or '' for unset. */
  value: string;
  onChange: (value: string) => void;
};

const pad = (n: number) => String(n).padStart(2, '0');
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,…,55

function parse(value: string): { h12: number; min: number; ampm: 'AM' | 'PM' } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value || '');
  if (!m) return null;
  const H = Math.min(23, parseInt(m[1], 10));
  const M = Math.min(59, parseInt(m[2], 10));
  const ampm = H < 12 ? 'AM' : 'PM';
  const h12 = ((H + 11) % 12) + 1;
  return { h12, min: M, ampm };
}

/**
 * 12-hour clock picker (hour / minute / AM-PM) that reads and writes a 24-hour
 * "HH:MM" string — easier to set at a glance than a raw 24h time field. Only
 * emits onChange when the user changes something, so opening an editor never
 * silently rewrites an existing time.
 */
export default function TimePicker({ value, onChange }: Props) {
  const parsed = parse(value);
  const h12 = parsed?.h12 ?? '';
  const min = parsed?.min ?? 0;
  const ampm = parsed?.ampm ?? 'PM';

  // Minute options include the current value even if it's off the 5-min grid.
  const minuteOpts = MINUTES.includes(min) ? MINUTES : [...MINUTES, min].sort((a, b) => a - b);

  function emit(nextH12: number | '', nextMin: number, nextAmpm: 'AM' | 'PM') {
    if (nextH12 === '') return onChange('');
    const H = (nextH12 % 12) + (nextAmpm === 'PM' ? 12 : 0);
    onChange(`${pad(H)}:${pad(nextMin)}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        className="input w-14"
        value={h12}
        onChange={(e) => emit(e.target.value === '' ? '' : parseInt(e.target.value, 10), min, ampm)}
      >
        <option value="">--</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-stone-400">:</span>
      <select
        className="input w-14"
        value={min}
        disabled={h12 === ''}
        onChange={(e) => emit(h12, parseInt(e.target.value, 10), ampm)}
      >
        {minuteOpts.map((mm) => (
          <option key={mm} value={mm}>
            {pad(mm)}
          </option>
        ))}
      </select>
      <div className="flex rounded-md border border-stone-300 bg-white p-0.5 text-sm">
        {(['AM', 'PM'] as const).map((a) => (
          <button
            key={a}
            type="button"
            disabled={h12 === ''}
            className={`rounded px-2 py-1 ${
              ampm === a ? 'bg-brand-600 text-white' : 'text-stone-700'
            } disabled:opacity-40`}
            onClick={() => emit(h12 === '' ? 12 : h12, min, a)}
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  );
}
