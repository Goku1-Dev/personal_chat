import type { MessageGroup, UiMessage } from '@/types/chat';

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' });

const shortDateFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

const longDateFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const fullFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** Local YYYY-MM-DD, used to bucket messages under a date divider. */
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(a).getTime() - startOfDay(b).getTime();
  return Math.round(ms / 86_400_000);
}

/** Clock time for a bubble: "10:30 PM". */
export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/**
 * Age-appropriate stamp used in lists and the admin view:
 * today -> "10:30 PM", yesterday -> "Yesterday", this week -> "Monday",
 * this year -> "Sep 19", older -> "Sep 19, 2024".
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diff = daysBetween(now, date);

  if (diff <= 0) return timeFmt.format(date);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return weekdayFmt.format(date);
  if (date.getFullYear() === now.getFullYear()) return shortDateFmt.format(date);
  return longDateFmt.format(date);
}

/** Label for a date divider. */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diff = daysBetween(now, date);

  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return weekdayFmt.format(date);
  if (date.getFullYear() === now.getFullYear()) return shortDateFmt.format(date);
  return longDateFmt.format(date);
}

/** Verbose stamp for the bubble's title attribute / screen readers. */
export function formatFull(iso: string): string {
  return fullFmt.format(new Date(iso));
}

/** Split an ascending list of messages into date-labelled groups. */
export function groupByDay(messages: UiMessage[], now: Date = new Date()): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (const message of messages) {
    const date = new Date(message.created_at);
    const key = dateKey(date);
    const last = groups[groups.length - 1];

    if (last && last.dateKey === key) {
      last.messages.push(message);
    } else {
      groups.push({
        dateKey: key,
        label: formatDayLabel(message.created_at, now),
        messages: [message],
      });
    }
  }

  return groups;
}

/**
 * Bubbles from the same sender within two minutes are drawn as a run, so only
 * the last one in the run carries a tail and a timestamp.
 */
export function isRunEnd(current: UiMessage, next: UiMessage | undefined): boolean {
  if (!next) return true;
  if (next.sender_id !== current.sender_id) return true;
  const gap =
    new Date(next.created_at).getTime() - new Date(current.created_at).getTime();
  if (gap > 2 * 60 * 1000) return true;
  return dateKey(new Date(next.created_at)) !== dateKey(new Date(current.created_at));
}
