import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loudly and early: a missing key otherwise surfaces as a confusing
  // "Failed to fetch" much later, on the password screen.
  throw new Error(
    'Supabase is not configured. Copy .env.example to .env and set ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  );
}

/**
 * Where the auth session lives.
 *
 * The site password is never stored anywhere in the browser. What is stored
 * here is the ordinary Supabase session (a short-lived access token plus a
 * rotating refresh token), which is what every Supabase app keeps client-side.
 * Set VITE_SESSION_PERSISTENCE=session to drop it when the tab closes.
 */
const persistence = import.meta.env.VITE_SESSION_PERSISTENCE ?? 'local';

function pickStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return persistence === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    // Private-mode browsers can throw on access; fall back to in-memory.
    return undefined;
  }
}

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    storage: pickStorage(),
    storageKey: 'pc.session',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'implicit',
  },
  realtime: {
    params: { eventsPerSecond: 8 },
  },
  global: {
    headers: { 'x-client-info': 'private-chat' },
  },
});

/** Base URL of the project's Edge Functions, derived from the project URL. */
export const functionsUrl = `${url.replace(/\/$/, '')}/functions/v1`;

export const supabaseAnonKey = anonKey;

export const chatTitle = import.meta.env.VITE_CHAT_TITLE?.trim() || 'Our Chat';
