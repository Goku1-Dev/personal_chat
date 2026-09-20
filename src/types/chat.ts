export type ParticipantRole = 'admin' | 'user';

export interface Profile {
  id: string;
  role: ParticipantRole;
  display_name: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
}

export type MessageType = 'text' | 'image';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: MessageType;
  media_path: string | null;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  read_at: string | null;
  deleted_at: string | null;
  /** The message this one answers, if any. */
  reply_to_message_id: string | null;
  /** True once the text has been cleared for both participants. */
  deleted_for_everyone: boolean;
  /** Who performed that deletion — either participant may. */
  deleted_by: string | null;
}

/**
 * A row from the `messages_visible` view: the message, minus anything the
 * caller hid for themselves, plus the resolved quote of its parent.
 */
export interface VisibleMessage extends Message {
  reply_to_sender_id: string | null;
  /** Null when the parent is gone, or was hidden by this person. */
  reply_to_content: string | null;
  reply_to_unavailable: boolean;
}

/** A message plus the client-only state the UI needs to render it. */
export interface UiMessage extends VisibleMessage {
  /** True while an optimistic message has not been confirmed by the server. */
  pending?: boolean;
  /** Set when the insert failed so the bubble can show a retry affordance. */
  failed?: boolean;
}

/** What the composer shows while a reply is being written. */
export interface ReplyTarget {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
}

/** Which of the two deletion modes an action should use. */
export type DeleteMode = 'me' | 'everyone';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface TypingState {
  /** Profile id of the other participant, when they are typing. */
  typingId: string | null;
  typingName: string | null;
}

/** A run of messages that belong under the same date divider. */
export interface MessageGroup {
  /** ISO date key, e.g. "2026-09-19". */
  dateKey: string;
  label: string;
  messages: UiMessage[];
}

export interface AdminStats {
  totalMessages: number;
  myMessages: number;
  theirMessages: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  unreadFromThem: number;
  participants: Profile[];
}
