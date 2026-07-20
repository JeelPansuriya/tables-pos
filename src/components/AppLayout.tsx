import React, { useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import CloudSyncPill from './CloudSyncPill';
import UpdatePill from './UpdatePill';

const navItems = [
  { to: '/', label: 'Tables' },
  // Quick billing tab removed — counter sales now go through the Counter tile on
  // the Tables page. The page & route are kept (App.tsx) for possible future use.
  { to: '/preorders', label: 'Pre-orders' },
  { to: '/bills', label: 'Bills' },
  { to: '/summary', label: 'Day Summary' },
  { to: '/money', label: 'Money' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/menu', label: 'Menu' },
  { to: '/settings', label: 'Settings' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, logout, settings } = useStore();
  const navigate = useNavigate();
  const restaurantName = settings.restaurant_name || 'Tables POS';

  // Quick "back to Tables" from anywhere: F2 (works even while typing, since
  // function keys don't enter text). Escape is left to the pages/modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        navigate('/');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-stone-200 bg-white px-4 py-2 shadow-sm">
        <button
          className="font-bold text-brand-700 hover:text-brand-800"
          onClick={() => navigate('/')}
          title="Go to Tables (F2)"
        >
          {restaurantName}
        </button>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {navItems.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm ${
                  isActive
                    ? 'bg-brand-100 text-brand-800 font-semibold'
                    : 'text-stone-700 hover:bg-stone-100'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
          {session?.role === 'admin' && (
            <NavLink
              to="/audit"
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm ${
                  isActive ? 'bg-brand-100 text-brand-800 font-semibold' : 'text-stone-700 hover:bg-stone-100'
                }`
              }
            >
              Audit
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <UpdatePill />
          <CloudSyncPill />
          <span className="text-stone-500">
            {session?.username} · {session?.role}
          </span>
          <button className="btn-ghost" onClick={() => logout()}>
            Logout
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-auto p-4">{children}</main>
    </div>
  );
}
