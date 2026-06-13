import { create } from 'zustand';
import { api } from './api';
import type { MenuItem, Session } from './types';

type Settings = Record<string, string>;

type Store = {
  session: Session | null;
  settings: Settings;
  menu: MenuItem[];
  init: () => Promise<void>;
  refreshSession: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshMenu: () => Promise<void>;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
};

export const useStore = create<Store>((set) => ({
  session: null,
  settings: {},
  menu: [],
  async init() {
    const me = await api.auth.me();
    set({ session: me?.session ?? null });
    const s = await api.settings.getAll();
    if (s?.ok) set({ settings: s.settings });
    if (me?.session) {
      const m = await api.menu.list();
      if (m?.ok) set({ menu: m.items });
    }
  },
  async refreshSession() {
    const me = await api.auth.me();
    set({ session: me?.session ?? null });
  },
  async refreshSettings() {
    const s = await api.settings.getAll();
    if (s?.ok) set({ settings: s.settings });
  },
  async refreshMenu() {
    const m = await api.menu.list();
    if (m?.ok) set({ menu: m.items });
  },
  async login(username, password) {
    const r = await api.auth.login(username, password);
    if (r?.ok) {
      set({ session: r.session });
      const m = await api.menu.list();
      if (m?.ok) set({ menu: m.items });
      return { ok: true };
    }
    return { ok: false, error: r?.error || 'Login failed' };
  },
  async logout() {
    await api.auth.logout();
    set({ session: null });
  },
}));
