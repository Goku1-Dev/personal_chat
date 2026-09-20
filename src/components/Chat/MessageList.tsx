import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Heart } from 'lucide-react';
import { groupByDay, isRunEnd } from '@/lib/format';
import { MessageBubble } from '@/components/Chat/MessageBubble';
import { TypingIndicator } from '@/components/Chat/TypingIndicator';
import { Spinner } from '@/components/UI/Spinner';
import type { UiMessage } from '@/types/chat';
import './MessageList.scss';

interface MessageListProps {
  messages: UiMessage[];
  currentUserId: string;
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  typing: boolean;
  typingName: string | null;
  selecting: boolean;
  selectedIds: Set<string>;
  editingId: string | null;
  savingEdit: boolean;
  onLoadOlder: () => void;
  onToggleSelect: (id: string) => void;
  onOpenMenu: (message: UiMessage) => void;
  onSaveEdit: (id: string, content: string) => void;
  onCancelEdit: () => void;
  onRetry: (message: UiMessage) => void;
  /** Resolves the display name of whoever wrote a quoted message. */
  resolveName: (senderId: string | null) => string | null;
  /** The message a reply asked to jump to, highlighted briefly on arrival. */
  highlightId: string | null;
  onJumpToParent: (messageId: string) => void;
  /** Fired when the list settles at the bottom, so receipts can be written. */
  onReachBottom: () => void;
}

const NEAR_BOTTOM_PX = 90;
const NEAR_TOP_PX = 140;

export function MessageList({
  messages,
  currentUserId,
  loading,
  loadingOlder,
  hasMore,
  typing,
  typingName,
  selecting,
  selectedIds,
  editingId,
  savingEdit,
  onLoadOlder,
  onToggleSelect,
  onOpenMenu,
  onSaveEdit,
  onCancelEdit,
  onRetry,
  resolveName,
  highlightId,
  onJumpToParent,
  onReachBottom,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);

  const didInitialScroll = useRef(false);
  const lastCount = useRef(0);
  const lastMessageId = useRef<string | null>(null);
  const topId = useRef<string | null>(null);
  const prependHeight = useRef<number | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    setUnseen(0);
  }, []);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;

    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const bottom = distance <= NEAR_BOTTOM_PX;

    setAtBottom(bottom);
    if (bottom) {
      setUnseen(0);
      onReachBottom();
    }

    if (node.scrollTop <= NEAR_TOP_PX && hasMore && !loadingOlder) {
      prependHeight.current = node.scrollHeight;
      onLoadOlder();
    }
  }, [hasMore, loadingOlder, onLoadOlder, onReachBottom]);

  // Keep the reading position steady when an older page is prepended, and
  // follow new messages only when the reader is already at the bottom.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || messages.length === 0) return;

    const newestId = messages[messages.length - 1].id;
    const oldestId = messages[0].id;
    const grew = messages.length > lastCount.current;
    const prepended = topId.current !== null && oldestId !== topId.current;
    const appended = lastMessageId.current !== null && newestId !== lastMessageId.current;

    if (!didInitialScroll.current) {
      node.scrollTop = node.scrollHeight;
      didInitialScroll.current = true;
      onReachBottom();
    } else if (prepended && grew && prependHeight.current !== null) {
      node.scrollTop = node.scrollHeight - prependHeight.current;
      prependHeight.current = null;
    } else if (appended && grew) {
      const fromMe = messages[messages.length - 1].sender_id === currentUserId;
      if (atBottom || fromMe) {
        node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
        setUnseen(0);
      } else {
        setUnseen((count) => count + 1);
      }
    }

    lastCount.current = messages.length;
    lastMessageId.current = newestId;
    topId.current = oldestId;
  }, [messages, atBottom, currentUserId, onReachBottom]);

  // Bring the target of a reply jump into view. If it is not on screen it
  // has not been paged in yet, and the caller loads more before asking again.
  useEffect(() => {
    if (!highlightId) return;
    const node = scrollRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(highlightId)}"]`,
    );
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId]);

  // A typing bubble appearing should not shove the conversation upward
  // unless the reader is already following along.
  useEffect(() => {
    if (typing && atBottom) scrollToBottom();
  }, [typing, atBottom, scrollToBottom]);

  if (loading) {
    return (
      <div className="message-list message-list--centered">
        <Spinner size={20} label="Loading messages" />
      </div>
    );
  }

  const groups = groupByDay(messages);
  const isEmpty = messages.length === 0;

  return (
    <div className="message-list-wrap">
      <div
        className="message-list"
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        aria-relevant="additions"
      >
        {isEmpty && !typing ? (
          <div className="message-list__empty">
            <span className="message-list__empty-mark" aria-hidden="true">
              <Heart size={26} />
            </span>
            <p className="message-list__empty-title">No messages yet.</p>
            <p className="message-list__empty-body">Start the conversation.</p>
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="message-list__older">
                {loadingOlder ? (
                  <Spinner size={16} label="Loading older messages" />
                ) : (
                  <button
                    type="button"
                    className="message-list__older-button"
                    onClick={onLoadOlder}
                  >
                    Load earlier messages
                  </button>
                )}
              </div>
            )}

            {groups.map((group) => (
              <section
                className="message-list__group"
                key={group.dateKey}
                aria-label={group.label}
              >
                <div className="message-list__divider">
                  <span>{group.label}</span>
                </div>

                {group.messages.map((message, index) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isOwn={message.sender_id === currentUserId}
                    showMeta={isRunEnd(message, group.messages[index + 1])}
                    selecting={selecting}
                    selected={selectedIds.has(message.id)}
                    editing={editingId === message.id}
                    savingEdit={savingEdit}
                    onToggleSelect={onToggleSelect}
                    onOpenMenu={onOpenMenu}
                    onSaveEdit={onSaveEdit}
                    onCancelEdit={onCancelEdit}
                    onRetry={onRetry}
                    replyAuthorName={resolveName(message.reply_to_sender_id)}
                    highlighted={highlightId === message.id}
                    onJumpToParent={onJumpToParent}
                  />
                ))}
              </section>
            ))}

            {typing && <TypingIndicator name={typingName} />}
          </>
        )}
      </div>

      {unseen > 0 && (
        <button
          type="button"
          className="new-message-pill"
          onClick={() => scrollToBottom()}
        >
          <ArrowDown size={14} aria-hidden="true" />
          {unseen === 1 ? 'New message' : `${unseen} new messages`}
        </button>
      )}
    </div>
  );
}
