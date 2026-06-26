/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_TABLE_PREFIX?: string;
  readonly VITE_TIMEZONE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
