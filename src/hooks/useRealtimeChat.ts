import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { TYPING_TTL_MS } from '@/lib/errors';
import type { ConnectionStatus, Message } from '@/types/chat';

interface Options {
  conversationId: string | null;
  userId: string | null;
  onInsert: (message: Message) => void;
  onUpdate: (message: Message) => void;
  onDelete: (id: string) => void;
  /** Fired when this same person hides a message from another tab/device. */
  onHiddenForMe?: (messageId: string) => void;
}

interface Result {
  status: ConnectionStatus;
  /** True while the other participant is typing. */
  othersTyping: boolean;
  /** True while the other participant has the chat open. */
  othersPresent: boolean;
  /** Broadcast our own typing state. Safe to call on every keystroke. */
  broadcastTyping: (typing: boolean) => void;
}

interface TypingPayload {
  senderId: string;
  typing: boolean;
}

/**
 * Owns the single realtime channel for the conversation.
 *
 * Database rows arrive through postgres_changes, "is the other person here"
 * through presence, and typing through broadcast — typing is deliberately
 * never written to the database.
 */
export function useRealtimeChat({
  conversationId,
  userId,
  onInsert,
  onUpdate,
  onDelete,
  onHiddenForMe,
}: Options): Result {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [othersTyping, setOthersTyping] = useState(false);
  const [othersPresent, setOthersPresent] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimer = useRef<number | null>(null);
  const lastBroadcast = useRef(0);
  const hasConnected = useRef(false);

  // Keep handlers in refs so the subscription is created once per conversation.
  const handlers = useRef({ onInsert, onUpdate, onDelete, onHiddenForMe });
  useEffect(() => {
    handlers.current = { onInsert, onUpdate, onDelete, onHiddenForMe };
  }, [onInsert, onUpdate, onDelete, onHiddenForMe]);

  const clearTypingTimer = useCallback(() => {
    if (typingTimer.current) {
      window.clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!conversationId || !userId) return;

    const channel = supabase.channel(`conversation:${conversationId}`, {
      config: {
        presence: { key: userId },
        broadcast: { self: false },
      },
    });

    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => handlers.current.onInsert(payload.new as Message),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => handlers.current.onUpdate(payload.new as Message),
      )
      .on(
        'postgres_changes',
        // DELETE payloads carry the old row (the table uses REPLICA IDENTITY
        // FULL). No filter here: unknown ids are ignored by the handler.
        { event: 'DELETE', schema: 'public', table: 'messages' },
        (payload) => {
          const old = payload.old as Partial<Message>;
          if (old?.id) handlers.current.onDelete(old.id);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_deletions',
          filter: `profile_id=eq.${userId}`,
        },
        (payload) => {
          // Only ever this person's own hide-list: RLS would not deliver
          // anyone else's, and the other participant's view must not change.
          const row = payload.new as { message_id?: string };
          if (row?.message_id) handlers.current.onHiddenForMe?.(row.message_id);
        },
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const data = payload as TypingPayload;
        if (!data || data.senderId === userId) return;

        clearTypingTimer();
        setOthersTyping(data.typing);

        if (data.typing) {
          // Self-heal if the "stopped typing" broadcast never arrives.
          typingTimer.current = window.setTimeout(
            () => setOthersTyping(false),
            TYPING_TTL_MS,
          );
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setOthersPresent(Object.keys(state).some((key) => key !== userId));
      })
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === 'SUBSCRIBED') {
          hasConnected.current = true;
          setStatus('connected');
          void channel.track({ online_at: new Date().toISOString() });
          return;
        }
        if (
          subscriptionStatus === 'CHANNEL_ERROR' ||
          subscriptionStatus === 'TIMED_OUT'
        ) {
          setStatus(hasConnected.current ? 'reconnecting' : 'connecting');
          setOthersTyping(false);
          setOthersPresent(false);
          return;
        }
        if (subscriptionStatus === 'CLOSED') {
          setOthersTyping(false);
          setOthersPresent(false);
        }
      });

    channelRef.current = channel;

    return () => {
      clearTypingTimer();
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, userId, clearTypingTimer]);

  // Treat a dropped network as a disconnection immediately, rather than
  // waiting for the websocket heartbeat to time out.
  useEffect(() => {
    const handleOffline = () => setStatus('offline');
    const handleOnline = () =>
      setStatus((current) => (current === 'offline' ? 'reconnecting' : current));

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    if (!navigator.onLine) setStatus('offline');

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const broadcastTyping = useCallback(
    (typing: boolean) => {
      const channel = channelRef.current;
      if (!channel || !userId) return;

      const now = Date.now();
      // Throttle the "still typing" pings; always let "stopped" through.
      if (typing && now - lastBroadcast.current < 1500) return;
      lastBroadcast.current = now;

      void channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { senderId: userId, typing } satisfies TypingPayload,
      });
    },
    [userId],
  );

  return { status, othersTyping, othersPresent, broadcastTyping };
}
