import { create } from 'zustand';
import { api } from './api';
import type { MenuItem, Session } from './types';

type Settings = Record<string, string>;

export type CloudStatus = {
  enabled: boolean;
  configured: boolean;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
};

type Store = {
  session: Session | null;
  settings: Settings;
  menu: MenuItem[];
  cloud: CloudStatus | null;
  syncing: boolean;
  init: () => Promise<void>;
  refreshSession: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshMenu: () => Promise<void>;
  refreshCloud: () => Promise<void>;
  syncNow: () => Promise<{ ok: boolean; error?: string }>;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
};

export const useStore = create<Store>((set, get) => ({
  session: null,
  settings: {},
  menu: [],
  cloud: null,
  syncing: false,
  async init() {
    const me = await api.auth.me();
    set({ session: me?.session ?? null });
    const s = await api.settings.getAll();
    if (s?.ok) set({ settings: s.settings });
    if (me?.session) {
      const m = await api.menu.list();
      if (m?.ok) set({ menu: m.items });
      await get().refreshCloud();
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
  async refreshCloud() {
    const r = await api.cloud.status();
    if (r?.ok) {
      set({
        cloud: {
          enabled: r.enabled,
          configured: r.configured,
          pending: r.pending,
          lastSyncAt: r.lastSyncAt ?? null,
          lastError: r.lastError ?? null,
        },
      });
    }
  },
  async syncNow() {
    set({ syncing: true });
    try {
      const r = await api.cloud.pushPending();
      await get().refreshCloud();
      return r?.ok ? { ok: true } : { ok: false, error: r?.error || 'Sync failed' };
    } finally {
      set({ syncing: false });
    }
  },
  async login(username, password) {
    const r = await api.auth.login(username, password);
    if (r?.ok) {
      set({ session: r.session });
      const m = await api.menu.list();
      if (m?.ok) set({ menu: m.items });
      await get().refreshCloud();
      return { ok: true };
    }
    return { ok: false, error: r?.error || 'Login failed' };
  },
  async logout() {
    await api.auth.logout();
    set({ session: null, cloud: null });
  },
}));
