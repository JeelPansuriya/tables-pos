import React, { useState } from 'react';
import { useStore } from '../store';

export default function LoginPage() {
  const { login } = useStore();
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await login(username, password);
    setBusy(false);
    if (!r.ok) setError(r.error ?? 'Login failed');
  }

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-brand-50 to-stone-100 p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-brand-700">Girr Kathiyawadi · Tables</h1>
          <p className="text-sm text-stone-500">Sign in to continue</p>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-stone-700">Username</label>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-stone-700">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
