import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  MAX_MESSAGE_LENGTH,
  PAGE_SIZE,
  normaliseContent,
  toUserMessage,
} from '@/lib/errors';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import type {
  ConnectionStatus,
  Message,
  Profile,
  UiMessage,
  VisibleMessage,
} from '@/types/chat';

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
  sendMessage: (content: string, replyToMessageId?: string | null) => Promise<void>;
  sendImage: (file: File, replyToMessageId?: string | null) => Promise<void>;
  editMessage: (id: string, content: string) => Promise<void>;
  /** Hide messages for this person only. Works on either sender's messages. */
  deleteForMe: (ids: string[]) => Promise<number>;
  /** Clear the text for both people. Works on either sender's messages. */
  deleteForEveryone: (ids: string[]) => Promise<number>;
  deleteAllMine: () => Promise<number>;
  clearForMe: () => Promise<void>;
  markThreadRead: () => Promise<void>;
  broadcastTyping: (typing: boolean) => void;
}

/** The view resolves per-person hiding and the quoted parent in one query. */
const MESSAGE_VIEW = 'messages_visible';

const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, content, message_type, media_path, created_at, updated_at, edited_at, read_at, deleted_at, deleted_for_everyone, deleted_by, reply_to_message_id, reply_to_sender_id, reply_to_content, reply_to_unavailable';

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

function isLocalId(id: string): boolean {
  return id.startsWith('pending-');
}

function getMediaUrl(path: string | null): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from('chat-media').getPublicUrl(path);
  return data.publicUrl || null;
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

  /** Ask the view for one row, used when a quote could not be resolved locally. */
  const refetchOne = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from(MESSAGE_VIEW)
      .select(MESSAGE_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error || !data || !mounted.current) return;

    const row = data as VisibleMessage;
    setMessages((current) =>
      current.map((message) =>
        message.id === row.id ? { ...message, ...row } : message,
      ),
    );
  }, []);

  /**
   * Realtime delivers the raw `messages` row, which carries no quote. Resolve
   * the parent from what is already on screen and fall back to the network
   * only when the reply arrives before its parent has been loaded.
   */
  const handleInsert = useCallback(
    (row: Message) => {
      if (!visible(row.created_at)) return;

      let needsParent = false;

      setMessages((current) => {
        if (current.some((message) => message.id === row.id)) return current;

        const parent = row.reply_to_message_id
          ? current.find((message) => message.id === row.reply_to_message_id)
          : undefined;

        if (row.reply_to_message_id && !parent) {
          // "Not loaded" and "deleted" look identical from here, so ask.
          needsParent = true;
        }

        const enriched: UiMessage = {
          ...row,
          media_url: getMediaUrl(row.media_path),
          reply_to_sender_id: parent?.sender_id ?? null,
          reply_to_content:
            parent && !parent.deleted_for_everyone ? parent.content : null,
          reply_to_unavailable: Boolean(
            row.reply_to_message_id && parent?.deleted_for_everyone,
          ),
        };

        // Our own echo: replace the optimistic bubble rather than duplicating.
        const pendingIndex = current.findIndex(
          (message) =>
            message.pending &&
            message.sender_id === row.sender_id &&
            message.content === row.content,
        );
        if (pendingIndex >= 0) {
          const next = [...current];
          next[pendingIndex] = enriched;
          return sortAscending(next);
        }

        return sortAscending([...current, enriched]);
      });

      if (needsParent) void refetchOne(row.id);
    },
    [visible, refetchOne],
  );

  const handleUpdate = useCallback((row: Message) => {
    setMessages((current) => {
      if (!current.some((message) => message.id === row.id)) return current;

      return current.map((message) => {
        if (message.id === row.id) return { ...message, ...row };

        // A message that just became deleted invalidates every quote of it.
        if (row.deleted_for_everyone && message.reply_to_message_id === row.id) {
          return { ...message, reply_to_content: null, reply_to_unavailable: true };
        }

        return message;
      });
    });
  }, []);

  const handleDelete = useCallback((id: string) => {
    setMessages((current) =>
      current
        .filter((message) => message.id !== id)
        .map((message) =>
          message.reply_to_message_id === id
            ? { ...message, reply_to_content: null, reply_to_unavailable: true }
            : message,
        ),
    );
  }, []);

  /** The same person hid something in another tab or on another device. */
  const handleHiddenForMe = useCallback((messageId: string) => {
    setMessages((current) => current.filter((message) => message.id !== messageId));
  }, []);

  const { status, othersTyping, othersPresent, broadcastTyping } = useRealtimeChat({
    conversationId,
    userId,
    onInsert: handleInsert,
    onUpdate: handleUpdate,
    onDelete: handleDelete,
    onHiddenForMe: handleHiddenForMe,
  });

  // --- loading -------------------------------------------------------------

  const fetchPage = useCallback(
    async (before?: string) => {
      if (!conversationId) return { rows: [] as VisibleMessage[], more: false };

      // Reading the view means hidden messages never cross the wire, so a
      // page of 40 is 40 visible messages rather than 40 minus whatever this
      // person has deleted for themselves.
      let query = supabase
        .from(MESSAGE_VIEW)
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

      const rows = (data ?? []) as VisibleMessage[];
      const more = rows.length > PAGE_SIZE;

      return { rows: more ? rows.slice(0, PAGE_SIZE) : rows, more };
    },
    [conversationId],
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
    async (raw: string, replyToMessageId: string | null = null) => {
      if (!conversationId || !userId) return;

      const content = normaliseContent(raw);
      if (!content) return;
      if (content.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
      }

      // A reply whose target has since gone is sent as an ordinary message
      // rather than failing the insert on a reference that no longer resolves.
      const parent = replyToMessageId
        ? messages.find((message) => message.id === replyToMessageId)
        : undefined;
      const replyId =
        parent && !parent.deleted_for_everyone && !isLocalId(parent.id)
          ? parent.id
          : null;

      // Guard against a double-fire from Enter plus a click on the button.
      const fingerprint = `${replyId ?? ''}|${content}`;
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
        media_url: null,
        created_at: now,
        updated_at: now,
        edited_at: null,
        read_at: null,
        deleted_at: null,
        deleted_for_everyone: false,
        deleted_by: null,
        reply_to_message_id: replyId,
        reply_to_sender_id: replyId ? (parent?.sender_id ?? null) : null,
        reply_to_content: replyId ? (parent?.content ?? null) : null,
        reply_to_unavailable: false,
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
            reply_to_message_id: replyId,
          })
          .select('id')
          .single();

        if (error) throw error;

        const savedId = (data as { id: string }).id;

        // Read the row back through the view so its quote comes from the same
        // source of truth as every other message on screen.
        const { data: full } = await supabase
          .from(MESSAGE_VIEW)
          .select(MESSAGE_COLUMNS)
          .eq('id', savedId)
          .maybeSingle();

        const saved: UiMessage = full
          ? { ...(full as VisibleMessage) }
          : { ...optimistic, id: savedId };

        setMessages((current) =>
          sortAscending(
            current.some((message) => message.id === savedId)
              ? current.filter((message) => message.id !== tempId)
              : current.map((message) =>
                  message.id === tempId ? { ...saved, pending: false } : message,
                ),
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
    [conversationId, userId, messages],
  );

  const sendImage = useCallback(
    async (file: File, replyToMessageId: string | null = null) => {
      if (!conversationId || !userId) return;
      if (!file.type.startsWith('image/')) throw new Error('Please select an image file.');
      if (file.size > 10 * 1024 * 1024) throw new Error('Image size must be less than 10 MB.');

      const parent = replyToMessageId
        ? messages.find((message) => message.id === replyToMessageId)
        : undefined;
      const replyId =
        parent && !parent.deleted_for_everyone && !isLocalId(parent.id) ? parent.id : null;

      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${conversationId}/${userId}/${crypto.randomUUID()}.${ext}`;
      const tempId = makeTempId();
      const now = new Date().toISOString();
      const mediaUrl = URL.createObjectURL(file);

      const optimistic: UiMessage = {
        id: tempId,
        conversation_id: conversationId,
        sender_id: userId,
        content: '',
        message_type: 'image',
        media_path: path,
        media_url: mediaUrl,
        created_at: now,
        updated_at: now,
        edited_at: null,
        read_at: null,
        deleted_at: null,
        deleted_for_everyone: false,
        deleted_by: null,
        reply_to_message_id: replyId,
        reply_to_sender_id: replyId ? (parent?.sender_id ?? null) : null,
        reply_to_content: replyId ? (parent?.content ?? null) : null,
        reply_to_unavailable: false,
        pending: true,
      };

      setMessages((current) => sortAscending([...current, optimistic]));

      try {
        const { error: uploadError } = await supabase.storage
          .from('chat-media')
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;

        const { data, error } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            sender_id: userId,
            content: '',
            message_type: 'image',
            media_path: path,
            reply_to_message_id: replyId,
          })
          .select('id')
          .single();
        if (error) throw error;

        const savedId = (data as { id: string }).id;
        const { data: full, error: readError } = await supabase
          .from(MESSAGE_VIEW)
          .select(MESSAGE_COLUMNS)
          .eq('id', savedId)
          .maybeSingle();
        if (readError) throw readError;

        const saved: UiMessage = full
          ? { ...(full as VisibleMessage), media_url: getMediaUrl((full as VisibleMessage).media_path) }
          : { ...optimistic, id: savedId, pending: false };

        setMessages((current) =>
          sortAscending(current.map((message) => (message.id === tempId ? saved : message))),
        );
        URL.revokeObjectURL(mediaUrl);
      } catch (error) {
        URL.revokeObjectURL(mediaUrl);
        setMessages((current) =>
          current.map((message) =>
            message.id === tempId ? { ...message, pending: false, failed: true } : message,
          ),
        );
        throw new Error(toUserMessage(error, "Couldn't send the image. Try again."));
      }
    },
    [conversationId, userId, messages],
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
      if (previous.deleted_for_everyone) {
        throw new Error('That message was deleted.');
      }
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
        .select('id')
        .single();

      if (error || !data) {
        setMessages((current) =>
          current.map((message) => (message.id === id ? previous : message)),
        );
        throw new Error(toUserMessage(error, "Couldn't edit this message."));
      }

      // Quotes of this message elsewhere in the thread follow the new text.
      setMessages((current) =>
        current.map((message) =>
          message.reply_to_message_id === id && !message.reply_to_unavailable
            ? { ...message, reply_to_content: content }
            : message,
        ),
      );
    },
    [messages, userId],
  );

  /**
   * Hide messages for this person alone.
   *
   * Either participant may do this to either participant's messages. The
   * other side is completely unaffected and nothing leaves the database.
   */
  const deleteForMe = useCallback(
    async (ids: string[]) => {
      if (!userId || ids.length === 0) return 0;

      const snapshot = messages;
      const targets = snapshot.filter((message) => ids.includes(message.id));
      if (targets.length === 0) return 0;

      const realIds = targets
        .filter((message) => !isLocalId(message.id))
        .map((message) => message.id);

      setMessages((current) => current.filter((message) => !ids.includes(message.id)));

      // Local-only rows never reached the database; dropping them is enough.
      if (realIds.length === 0) return targets.length;

      // One RPC for the whole selection, however large it is.
      const { data, error } = await supabase.rpc('delete_messages_for_me', {
        p_message_ids: realIds,
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

      return typeof data === 'number' ? data : realIds.length;
    },
    [messages, userId],
  );

  /**
   * Clear the text for both people, whoever wrote it.
   *
   * The row survives so replies keep a valid target, but the database blanks
   * the content: "deleted" is not merely a flag the client agrees to respect.
   */
  const deleteForEveryone = useCallback(
    async (ids: string[]) => {
      if (!userId || ids.length === 0) return 0;

      const snapshot = messages;
      const targets = snapshot.filter(
        (message) =>
          ids.includes(message.id) &&
          !message.deleted_for_everyone &&
          !isLocalId(message.id),
      );
      if (targets.length === 0) return 0;

      const targetIds = targets.map((message) => message.id);
      const now = new Date().toISOString();

      setMessages((current) =>
        current.map((message) => {
          if (targetIds.includes(message.id)) {
            return {
              ...message,
              content: '',
              media_path: null,
              media_url: null,
              deleted_for_everyone: true,
              deleted_at: now,
              deleted_by: userId,
            };
          }

          if (
            message.reply_to_message_id &&
            targetIds.includes(message.reply_to_message_id)
          ) {
            return { ...message, reply_to_content: null, reply_to_unavailable: true };
          }

          return message;
        }),
      );

      const { data, error } = await supabase.rpc('delete_messages_for_everyone', {
        p_message_ids: targetIds,
      });

      if (error) {
        setMessages(snapshot);
        throw new Error(
          toUserMessage(
            error,
            targetIds.length > 1
              ? "Couldn't delete those messages for everyone."
              : "Couldn't delete this message for everyone.",
          ),
        );
      }

      const mediaPaths = targets
        .map((message) => message.media_path)
        .filter((path): path is string => Boolean(path));
      if (mediaPaths.length) {
        await supabase.storage.from('chat-media').remove(mediaPaths);
      }

      return typeof data === 'number' ? data : targetIds.length;
    },
    [messages, userId],
  );

  /** Delete everything this person wrote, for both of them. */
  const deleteAllMine = useCallback(async () => {
    if (!conversationId || !userId) return 0;

    const mine = messages.filter(
      (message) =>
        message.sender_id === userId &&
        !message.deleted_for_everyone &&
        !isLocalId(message.id),
    );
    if (mine.length === 0) return 0;

    return deleteForEveryone(mine.map((message) => message.id));
  }, [conversationId, userId, messages, deleteForEveryone]);

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
    sendImage,
    editMessage,
    deleteForMe,
    deleteForEveryone,
    deleteAllMine,
    clearForMe,
    markThreadRead,
    broadcastTyping,
  };
}
