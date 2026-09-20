import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  MAX_MESSAGE_LENGTH,
  PAGE_SIZE,
  normaliseContent,
  toUserMessage,
} from '@/lib/errors';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import type { ConnectionStatus, Message, Profile, UiMessage } from '@/types/chat';

interface Options {
  conversationId: string | null;
  userId: string | null;
}

export interface UseMessagesResult {
  messages: UiMessage[];
  participants: Profile[];
  otherParticipant: Profile | null;
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  loadError: string | null;
  connection: ConnectionStatus;
  othersTyping: boolean;
  othersPresent: boolean;
  loadOlder: () => Promise<void>;
  reload: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  editMessage: (id: string, content: string) => Promise<void>;
  deleteMessages: (ids: string[]) => Promise<void>;
  deleteAllMine: () => Promise<number>;
  clearForMe: () => Promise<void>;
  markThreadRead: () => Promise<void>;
  broadcastTyping: (typing: boolean) => void;
}

const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, content, message_type, created_at, updated_at, edited_at, read_at, deleted_at';

function sortAscending(list: UiMessage[]): UiMessage[] {
  return [...list].sort((a, b) => {
    const delta =
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

function makeTempId(): string {
  return `pending-${
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }`;
}

/**
 * Everything the chat needs to read and change the conversation.
 *
 * Writes are optimistic but never authoritative: the row that comes back from
 * the database (or over realtime) always replaces the local guess, so a write
 * the policies reject simply disappears again and the error is surfaced.
 */
export function useMessages({ conversationId, userId }: Options): UseMessagesResult {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [participants, setParticipants] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Messages before this instant are hidden for this participant only. */
  const clearedAt = useRef<string | null>(null);
  const inFlightSends = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const visible = useCallback((createdAt: string) => {
    const boundary = clearedAt.current;
    return !boundary || new Date(createdAt).getTime() > new Date(boundary).getTime();
  }, []);

  // --- realtime handlers ---------------------------------------------------

  const handleInsert = useCallback(
    (row: Message) => {
      if (!visible(row.created_at)) return;
      setMessages((current) => {
        if (current.some((message) => message.id === row.id)) return current;

        // Our own echo: replace the optimistic bubble rather than duplicating.
        const pendingIndex = current.findIndex(
          (message) =>
            message.pending &&
            message.sender_id === row.sender_id &&
            message.content === row.content,
        );
        if (pendingIndex >= 0) {
          const next = [...current];
          next[pendingIndex] = row;
          return sortAscending(next);
        }

        return sortAscending([...current, row]);
      });
    },
    [visible],
  );

  const handleUpdate = useCallback((row: Message) => {
    setMessages((current) =>
      current.map((message) => (message.id === row.id ? { ...message, ...row } : message)),
    );
  }, []);

  const handleDelete = useCallback((id: string) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const { status, othersTyping, othersPresent, broadcastTyping } = useRealtimeChat({
    conversationId,
    userId,
    onInsert: handleInsert,
    onUpdate: handleUpdate,
    onDelete: handleDelete,
  });

  // --- loading -------------------------------------------------------------

  const fetchPage = useCallback(
    async (before?: string) => {
      if (!conversationId || !userId) {
        return { rows: [] as Message[], more: false };
      }

      let query = supabase
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE + 1);

      if (clearedAt.current) {
        query = query.gt('created_at', clearedAt.current);
      }

      if (before) {
        query = query.lt('created_at', before);
      }

      const { data, error } = await query;

      if (error) throw error;

      const rows = (data ?? []) as Message[];

      // Messages that this particular user has deleted.
      const { data: deletionRows, error: deletionError } = await supabase
        .from('message_deletions')
        .select('message_id')
        .eq('profile_id', userId);

      if (deletionError) throw deletionError;

      const deletedIds = new Set(
        (deletionRows ?? []).map(
          (row) => (row as { message_id: string }).message_id,
        ),
      );

      // Hide only messages deleted by the current user.
      const visibleRows = rows.filter((row) => !deletedIds.has(row.id));

      const more = rows.length > PAGE_SIZE;

      return {
        rows: visibleRows,
        more,
      };
    },
    [conversationId, userId],
  );

  const load = useCallback(async () => {
    if (!conversationId || !userId) return;

    setLoading(true);
    setLoadError(null);

    try {
      // The per-participant clear point has to be known before the first page.
      const { data: clearRow } = await supabase
        .from('chat_clears')
        .select('cleared_at')
        .eq('conversation_id', conversationId)
        .eq('profile_id', userId)
        .maybeSingle();

      clearedAt.current = (clearRow as { cleared_at: string } | null)?.cleared_at ?? null;

      const [{ rows, more }, profilesResult] = await Promise.all([
        fetchPage(),
        supabase
          .from('profiles')
          .select('id, role, display_name, created_at')
          .order('role', { ascending: true }),
      ]);

      if (!mounted.current) return;

      setMessages(sortAscending(rows));
      setHasMore(more);
      setParticipants((profilesResult.data as Profile[] | null) ?? []);
    } catch (error) {
      if (!mounted.current) return;
      setLoadError(toUserMessage(error, "Couldn't load your conversation."));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [conversationId, userId, fetchPage]);

  useEffect(() => {
    void load();
  }, [load]);

  // A tab that slept through a reconnect can have missed rows: resync once
  // the channel comes back.
  const previousStatus = useRef<ConnectionStatus>('connecting');
  useEffect(() => {
    if (previousStatus.current !== 'connected' && status === 'connected') {
      if (previousStatus.current === 'reconnecting') void load();
    }
    previousStatus.current = status;
  }, [status, load]);

  const loadOlder = useCallback(async () => {
    if (!hasMore || loadingOlder || messages.length === 0) return;

    setLoadingOlder(true);
    try {
      const oldest = messages[0].created_at;
      const { rows, more } = await fetchPage(oldest);
      if (!mounted.current) return;

      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        const fresh = rows.filter((row) => !known.has(row.id));
        return sortAscending([...fresh, ...current]);
      });
      setHasMore(more);
    } catch (error) {
      if (mounted.current) {
        setLoadError(toUserMessage(error, "Couldn't load older messages."));
      }
    } finally {
      if (mounted.current) setLoadingOlder(false);
    }
  }, [hasMore, loadingOlder, messages, fetchPage]);

  // --- writes --------------------------------------------------------------

  const sendMessage = useCallback(
    async (raw: string) => {
      if (!conversationId || !userId) return;

      const content = normaliseContent(raw);
      if (!content) return;
      if (content.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
      }

      // Guard against a double-fire from Enter plus a click on the button.
      const fingerprint = `${content}`;
      if (inFlightSends.current.has(fingerprint)) return;
      inFlightSends.current.add(fingerprint);

      const tempId = makeTempId();
      const now = new Date().toISOString();
      const optimistic: UiMessage = {
        id: tempId,
        conversation_id: conversationId,
        sender_id: userId,
        content,
        message_type: 'text',
        media_path: null,
        created_at: now,
        updated_at: now,
        edited_at: null,
        read_at: null,
        deleted_at: null,
        pending: true,
      };

      setMessages((current) => sortAscending([...current, optimistic]));

      try {
        const { data, error } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            // sender_id is set by a database default of auth.uid() and is
            // rejected by RLS if it is anything else. Sent here only so the
            // returned row is complete.
            sender_id: userId,
            content,
            message_type: 'text',
          })
          .select(MESSAGE_COLUMNS)
          .single();

        if (error) throw error;

        const saved = data as Message;
        setMessages((current) =>
          sortAscending(
            current.some((message) => message.id === saved.id)
              ? current.filter((message) => message.id !== tempId)
              : current.map((message) => (message.id === tempId ? saved : message)),
          ),
        );
      } catch (error) {
        setMessages((current) =>
          current.map((message) =>
            message.id === tempId
              ? { ...message, pending: false, failed: true }
              : message,
          ),
        );
        throw new Error(toUserMessage(error, "Couldn't send your message. Try again."));
      } finally {
        inFlightSends.current.delete(fingerprint);
      }
    },
    [conversationId, userId],
  );

  const editMessage = useCallback(
    async (id: string, raw: string) => {
      if (!userId) return;

      const content = normaliseContent(raw);
      if (!content) return;
      if (content.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
      }

      const previous = messages.find((message) => message.id === id);
      if (!previous || previous.sender_id !== userId) return;
      if (previous.content === content) return;

      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? { ...message, content, edited_at: new Date().toISOString() }
            : message,
        ),
      );

      const { data, error } = await supabase
        .from('messages')
        .update({ content })
        .eq('id', id)
        .eq('sender_id', userId)
        .select(MESSAGE_COLUMNS)
        .single();

      if (error || !data) {
        setMessages((current) =>
          current.map((message) => (message.id === id ? previous : message)),
        );
        throw new Error(toUserMessage(error, "Couldn't edit this message."));
      }

      const saved = data as Message;
      setMessages((current) =>
        current.map((message) => (message.id === id ? saved : message)),
      );
    },
    [messages, userId],
  );

  const deleteMessages = useCallback(
    async (ids: string[]) => {
      if (!userId || ids.length === 0) return;

      const mine = messages.filter(
        (message) =>
          ids.includes(message.id) && message.sender_id === userId,
      );

      if (mine.length === 0) return;

      // Optimistically hide the messages from this user only.
      const realIds = mine
        .filter((message) => !message.id.startsWith('pending-'))
        .map((message) => message.id);

      const snapshot = messages;

      setMessages((current) =>
        current.filter(
          (message) => !mine.some((target) => target.id === message.id),
        ),
      );

      if (realIds.length === 0) return;

      const deletionRows = realIds.map((messageId) => ({
        message_id: messageId,
        profile_id: userId,
      }));

      const { error } = await supabase
        .from('message_deletions')
        .upsert(deletionRows, {
          onConflict: 'message_id,profile_id',
        });

      if (error) {
        setMessages(snapshot);

        throw new Error(
          toUserMessage(
            error,
            realIds.length > 1
              ? "Couldn't delete those messages."
              : "Couldn't delete this message.",
          ),
        );
      }
    },
    [messages, userId],
  );

  const deleteAllMine = useCallback(async () => {
    if (!conversationId || !userId) return 0;

    const snapshot = messages;

    const mine = snapshot.filter(
      (message) =>
        message.sender_id === userId &&
        !message.id.startsWith('pending-'),
    );

    if (mine.length === 0) return 0;

    setMessages((current) =>
      current.filter((message) => message.sender_id !== userId),
    );

    const deletionRows = mine.map((message) => ({
      message_id: message.id,
      profile_id: userId,
    }));

    const { error } = await supabase
      .from('message_deletions')
      .upsert(deletionRows, {
        onConflict: 'message_id,profile_id',
      });

    if (error) {
      setMessages(snapshot);

      throw new Error(
        toUserMessage(error, "Couldn't delete your messages."),
      );
    }

    return mine.length;
  }, [conversationId, messages, userId]);

  /**
   * Hide the history for this participant only. The other person's copy of
   * the conversation is untouched — nothing is deleted.
   */
  const clearForMe = useCallback(async () => {
    if (!conversationId || !userId) return;

    const now = new Date().toISOString();
    const snapshot = messages;
    const previousBoundary = clearedAt.current;

    clearedAt.current = now;
    setMessages([]);
    setHasMore(false);

    const { error } = await supabase
      .from('chat_clears')
      .upsert(
        { conversation_id: conversationId, profile_id: userId, cleared_at: now },
        { onConflict: 'conversation_id,profile_id' },
      );

    if (error) {
      clearedAt.current = previousBoundary;
      setMessages(snapshot);
      throw new Error(toUserMessage(error, "Couldn't clear this chat."));
    }
  }, [conversationId, messages, userId]);

  const markThreadRead = useCallback(async () => {
    if (!conversationId || !userId) return;

    const unread = messages.some(
      (message) => message.sender_id !== userId && !message.read_at,
    );
    if (!unread) return;

    // A definer function does this: RLS only lets a participant update rows
    // they sent, so read receipts cannot be written directly by the reader.
    await supabase.rpc('mark_messages_read', { p_conversation_id: conversationId });
  }, [conversationId, messages, userId]);

  const otherParticipant = useMemo(
    () => participants.find((participant) => participant.id !== userId) ?? null,
    [participants, userId],
  );

  return {
    messages,
    participants,
    otherParticipant,
    loading,
    loadingOlder,
    hasMore,
    loadError,
    connection: status,
    othersTyping,
    othersPresent,
    loadOlder,
    reload: load,
    sendMessage,
    editMessage,
    deleteMessages,
    deleteAllMine,
    clearForMe,
    markThreadRead,
    broadcastTyping,
  };
}
