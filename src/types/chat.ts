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
}

/** A message plus the client-only state the UI needs to render it. */
export interface UiMessage extends Message {
  /** True while an optimistic message has not been confirmed by the server. */
  pending?: boolean;
  /** Set when the insert failed so the bubble can show a retry affordance. */
  failed?: boolean;
}

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
