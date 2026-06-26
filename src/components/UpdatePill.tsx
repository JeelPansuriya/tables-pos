import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';

/**
 * Header indicator for in-app updates — shown to every signed-in user
 * (manager + admin). Idle, it shows the running version and lets you click to
 * check. When a new release is found it auto-downloads (progress shown); once
 * downloaded it turns into a "Restart to update" button that installs it.
 */
type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version?: string }
  | { kind: 'progress'; percent: number }
  | { kind: 'downloaded'; version?: string }
  | { kind: 'none' }
  | { kind: 'error'; message?: string };

export default function UpdatePill() {
  const [version, setVersion] = useState<string>('');
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.update?.status?.().then((r: any) => r?.version && setVersion(r.version));
    const off = api.update?.onEvent?.((p: any) => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      switch (p?.type) {
        case 'checking':
          return setState({ kind: 'checking' });
        case 'available':
          return setState({ kind: 'available', version: p.version });
        case 'progress':
          return setState({ kind: 'progress', percent: p.percent ?? 0 });
        case 'downloaded':
          return setState({ kind: 'downloaded', version: p.version });
        case 'none':
          setState({ kind: 'none' });
          resetTimer.current = setTimeout(() => setState({ kind: 'idle' }), 4000);
          return;
        case 'error':
          setState({ kind: 'error', message: p.message });
          resetTimer.current = setTimeout(() => setState({ kind: 'idle' }), 5000);
          return;
      }
    });
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      off?.();
    };
  }, []);

  async function check() {
    setState({ kind: 'checking' });
    const r = await api.update?.check?.();
    if (r && !r.ok) {
      setState({ kind: 'error', message: r.error });
      resetTimer.current = setTimeout(() => setState({ kind: 'idle' }), 5000);
    } else if (r?.ok && !r.updateVersion) {
      setState({ kind: 'none' });
      resetTimer.current = setTimeout(() => setState({ kind: 'idle' }), 4000);
    }
    // 'available' / 'downloaded' arrive via events.
  }

  let label: string;
  let tone: string;
  let onClick: (() => void) | undefined = check;
  let title = `Version ${version || '?'}`;

  switch (state.kind) {
    case 'checking':
      label = 'Checking…';
      tone = 'bg-sky-50 text-sky-700 border-sky-200';
      onClick = undefined;
      break;
    case 'available':
      label = `Downloading${state.version ? ' ' + state.version : ''}…`;
      tone = 'bg-sky-50 text-sky-700 border-sky-200';
      onClick = undefined;
      break;
    case 'progress':
      label = `Downloading ${state.percent}%`;
      tone = 'bg-sky-50 text-sky-700 border-sky-200';
      onClick = undefined;
      break;
    case 'downloaded':
      label = 'Restart to update';
      tone = 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold';
      onClick = () => api.update?.install?.();
      title = `Update ${state.version ?? ''} ready — click to restart and install`;
      break;
    case 'none':
      label = 'Up to date';
      tone = 'bg-stone-50 text-stone-600 border-stone-200';
      break;
    case 'error':
      label = 'Update check failed';
      tone = 'bg-amber-50 text-amber-800 border-amber-200';
      title = state.message || 'Could not check for updates';
      break;
    default:
      label = `v${version || '—'}`;
      tone = 'bg-stone-50 text-stone-600 border-stone-200';
      title = `Version ${version || '?'} · click to check for updates`;
  }

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={!onClick}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${tone} ${
        onClick ? 'cursor-pointer hover:brightness-95' : 'cursor-default'
      }`}
    >
      <span aria-hidden>{state.kind === 'downloaded' ? '⟳' : '⬇'}</span>
      <span>{label}</span>
    </button>
  );
}
