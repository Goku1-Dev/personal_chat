// ===========================================================================
// verify-password
//
// The only job here is to turn "I know the shared password" into a real
// Supabase session, without the browser ever learning the password itself or
// the credentials of the account behind it.
//
// Secrets this function needs (set with `supabase secrets set`, never in a
// VITE_ variable, never in the repository):
//
//   SITE_PASSWORD        the password you send in the Instagram story
//   CHAT_USER_EMAIL      email of the "user" account in Supabase Auth
//   CHAT_USER_PASSWORD   password of that account (long and random; nobody types it)
//   ALLOWED_ORIGIN       optional, e.g. https://your-domain.vercel.app
//
// SUPABASE_URL and SUPABASE_ANON_KEY are injected by the platform.
// The service-role key is deliberately not used: signing in as an ordinary
// account is enough, and it keeps the blast radius of this function tiny.
// ===========================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SITE_PASSWORD = Deno.env.get('SITE_PASSWORD') ?? '';
const CHAT_USER_EMAIL = Deno.env.get('CHAT_USER_EMAIL') ?? '';
const CHAT_USER_PASSWORD = Deno.env.get('CHAT_USER_PASSWORD') ?? '';
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Compare two strings without leaking their contents through timing.
 *
 * Both sides are hashed first so the comparison always runs over 32 bytes,
 * which means the length of the guess tells an attacker nothing either.
 */
async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);

  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);

  let difference = 0;
  for (let i = 0; i < bytesA.length; i += 1) {
    difference |= bytesA[i] ^ bytesB[i];
  }
  return difference === 0;
}

// ---------------------------------------------------------------------------
// Rate limiting.
//
// In-memory, so it resets when the isolate is recycled and is not shared
// across instances. That is fine for what it is: a speed bump against someone
// pasting the link into a script. The real protection is that the password is
// never checked in the browser.
// ---------------------------------------------------------------------------

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 12;
const attempts = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);

  // Opportunistic cleanup so the map cannot grow without bound.
  if (attempts.size > 500) {
    for (const [ip, times] of attempts) {
      if (times.every((at) => now - at >= WINDOW_MS)) attempts.delete(ip);
    }
  }

  return recent.length > MAX_ATTEMPTS;
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0].trim() || 'unknown';
}

// ---------------------------------------------------------------------------

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  if (!SITE_PASSWORD || !CHAT_USER_EMAIL || !CHAT_USER_PASSWORD) {
    console.error(
      'verify-password is missing secrets. Set SITE_PASSWORD, CHAT_USER_EMAIL and CHAT_USER_PASSWORD.',
    );
    return json({ error: 'This app is not finished being set up.' }, 500);
  }

  if (isRateLimited(clientKey(request))) {
    return json({ error: 'Too many attempts. Wait a few minutes.' }, 429);
  }

  let password = '';
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === 'string' ? body.password : '';
  } catch {
    return json({ error: 'Send a JSON body with a password field.' }, 400);
  }

  if (!password) {
    return json({ error: 'Enter the password to continue.' }, 401);
  }

  if (!(await constantTimeEquals(password, SITE_PASSWORD))) {
    // Deliberately identical to an empty-password response: a wrong guess
    // learns nothing beyond "not this one".
    return json({ error: 'Incorrect password.' }, 401);
  }

  // The password was right. Mint a session for the shared "user" account.
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email: CHAT_USER_EMAIL,
    password: CHAT_USER_PASSWORD,
  });

  if (error || !data.session) {
    console.error('Could not sign in the chat account:', error?.message);
    return json({ error: "Couldn't open the chat. Try again." }, 500);
  }

  return json(
    {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    },
    200,
  );
});
