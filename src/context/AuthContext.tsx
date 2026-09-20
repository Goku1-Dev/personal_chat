import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, functionsUrl, supabaseAnonKey } from '@/lib/supabase';
import { toUserMessage } from '@/lib/errors';
import type { Profile } from '@/types/chat';

export interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  conversationId: string | null;
  /** True until the first session + profile resolution finishes. */
  initialising: boolean;
  /** True while a sign-in request is in flight. */
  working: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  enterWithPassword: (password: string) => Promise<void>;
  signInAsAdmin: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Thrown for anything the password screen should render inline. */
export class AuthError extends Error {}

interface VerifyResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [initialising, setInitialising] = useState(true);
  const [working, setWorking] = useState(false);

  const mounted = useRef(true);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Load the caller's own profile and the conversation they belong to. */
  const loadIdentity = useCallback(async (userId: string) => {
    const [profileResult, participantResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, role, display_name, created_at')
        .eq('id', userId)
        .maybeSingle(),
      supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('profile_id', userId)
        .limit(1)
        .maybeSingle(),
    ]);

    if (!mounted.current) return;

    setProfile((profileResult.data as Profile | null) ?? null);
    setConversationId(
      (participantResult.data as { conversation_id: string } | null)?.conversation_id ??
        null,
    );
  }, []);

  // Bootstrap from any stored session, then follow auth state changes.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await supabase.auth.signOut();

      if (cancelled) return;

      setSession(null);
      setProfile(null);
      setConversationId(null);

      if (!cancelled && mounted.current) {
        setInitialising(false);
      }
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);

      if (!next?.user) {
        loadedFor.current = null;
        setProfile(null);
        setConversationId(null);
        return;
      }

      // TOKEN_REFRESHED fires often; only reload identity for a new user.
      if (event === 'SIGNED_IN' || loadedFor.current !== next.user.id) {
        loadedFor.current = next.user.id;
        void loadIdentity(next.user.id);
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [loadIdentity]);

  /**
   * Exchange the shared password for a session.
   *
   * The password is posted to an Edge Function and compared against a secret
   * that only exists on the server. The browser never learns the real value,
   * and never sees the account credentials behind the session it gets back.
   */
  const enterWithPassword = useCallback(async (password: string) => {
    setWorking(true);
    try {
      let response: Response;
      try {
        response = await fetch(`${functionsUrl}/verify-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({ password }),
        });
      } catch {
        throw new AuthError("Couldn't reach the server. Check your connection.");
      }

      let payload: VerifyResponse = {};
      try {
        payload = (await response.json()) as VerifyResponse;
      } catch {
        /* Body was not JSON; handled by the status checks below. */
      }

      if (response.status === 401) {
        throw new AuthError('Incorrect password. Please try again.');
      }
      if (response.status === 429) {
        throw new AuthError('Too many attempts. Wait a moment and try again.');
      }
      if (!response.ok || !payload.access_token || !payload.refresh_token) {
        throw new AuthError(payload.error || "Couldn't sign you in. Try again.");
      }

      const { data, error } = await supabase.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      });
      if (error) throw new AuthError(toUserMessage(error, "Couldn't sign you in."));

      if (data.session?.user) {
        loadedFor.current = data.session.user.id;
        await loadIdentity(data.session.user.id);
      }
    } finally {
      if (mounted.current) setWorking(false);
    }
  }, [loadIdentity]);

  /** Admin uses ordinary email + password credentials, entered by hand. */
  const signInAsAdmin = useCallback(
    async (email: string, password: string) => {
      setWorking(true);
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          throw new AuthError(
            error.message.toLowerCase().includes('invalid')
              ? 'Those credentials did not work.'
              : toUserMessage(error, "Couldn't sign you in."),
          );
        }
        if (data.session?.user) {
          loadedFor.current = data.session.user.id;
          await loadIdentity(data.session.user.id);
        }
      } finally {
        if (mounted.current) setWorking(false);
      }
    },
    [loadIdentity],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    if (!mounted.current) return;
    loadedFor.current = null;
    setSession(null);
    setProfile(null);
    setConversationId(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadIdentity(session.user.id);
  }, [session?.user, loadIdentity]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      conversationId,
      initialising,
      working,
      isAuthenticated: Boolean(session?.user),
      isAdmin: profile?.role === 'admin',
      enterWithPassword,
      signInAsAdmin,
      signOut,
      refreshProfile,
    }),
    [
      session,
      profile,
      conversationId,
      initialising,
      working,
      enterWithPassword,
      signInAsAdmin,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
