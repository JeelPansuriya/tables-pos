import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configMissing } from './supabase';
import Login from './Login';
import Dashboard from './Dashboard';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (configMissing) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="card p-5">
          <h1 className="mb-2 text-lg font-bold">Configuration needed</h1>
          <p className="text-sm text-stone-600">
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see{' '}
            <code>.env.example</code>) and redeploy.
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return <div className="flex h-full items-center justify-center text-stone-500">Loading…</div>;
  }

  return session ? <Dashboard session={session} /> : <Login />;
}
