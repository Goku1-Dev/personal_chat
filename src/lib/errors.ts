/** Number of messages fetched per page. Kept small: this is a two-person chat. */
export const PAGE_SIZE = 40;

/** How long a "typing" broadcast stays valid before it is cleared. */
export const TYPING_TTL_MS = 4000;

/** Maximum characters in a single message. Mirrors the database constraint. */
export const MAX_MESSAGE_LENGTH = 4000;

interface MaybeSupabaseError {
  message?: unknown;
  code?: unknown;
  details?: unknown;
}

function readMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const candidate = error as MaybeSupabaseError;
  return typeof candidate.message === 'string' ? candidate.message : '';
}

function readCode(error: unknown): string {
  const candidate = error as MaybeSupabaseError;
  return typeof candidate?.code === 'string' ? candidate.code : '';
}

/**
 * Turn anything thrown by supabase-js or fetch into one short sentence a
 * person can act on. Raw Postgres text never reaches the screen.
 */
export function toUserMessage(error: unknown, fallback: string): string {
  const raw = readMessage(error).toLowerCase();
  const code = readCode(error);

  if (!navigator.onLine) return "You're offline. Check your connection and try again.";

  // RLS rejections and immutability triggers.
  if (code === '42501' || raw.includes('row-level security')) {
    return "You can only change messages you sent.";
  }
  if (raw.includes('cannot be changed') || raw.includes('immutable')) {
    return "You can only change messages you sent.";
  }
  if (code === '23514' || raw.includes('check constraint')) {
    return 'That message is empty or too long.';
  }
  if (code === 'PGRST116' || raw.includes('no rows')) {
    return 'That message is no longer here.';
  }
  if (raw.includes('jwt') || raw.includes('token is expired') || code === '401') {
    return 'Your session expired. Enter the password again.';
  }
  if (raw.includes('failed to fetch') || raw.includes('networkerror')) {
    return "Couldn't reach the server. Try again.";
  }
  if (raw.includes('rate limit') || code === '429') {
    return 'Too many attempts. Wait a moment and try again.';
  }

  return fallback;
}

/** Trim, normalise newlines, and collapse runaway blank lines. */
export function normaliseContent(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}
