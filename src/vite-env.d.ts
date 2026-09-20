/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SESSION_PERSISTENCE?: 'local' | 'session';
  readonly VITE_CHAT_TITLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.scss';
