import React from 'react';
import { NavLink } from 'react-router-dom';
import { useStore } from '../store';

const navItems = [
  { to: '/', label: 'Tables' },
  { to: '/quick', label: 'Quick / Takeaway' },
  { to: '/preorders', label: 'Pre-orders' },
  { to: '/bills', label: 'Bills' },
  { to: '/summary', label: 'Day Summary' },
  { to: '/menu', label: 'Menu' },
  { to: '/settings', label: 'Settings' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, logout, settings } = useStore();
  const restaurantName = settings.restaurant_name || 'Tables POS';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-stone-200 bg-white px-4 py-2 shadow-sm">
        <div className="font-bold text-brand-700">{restaurantName} <span className="text-stone-400 font-normal">· Tables</span></div>
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
