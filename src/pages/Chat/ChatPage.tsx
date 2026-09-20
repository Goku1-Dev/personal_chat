import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Eraser,
  EyeOff,
  ListChecks,
  LogOut,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMessages } from '@/hooks/useMessages';
import { useToast } from '@/hooks/useToast';
import { useViewportHeight } from '@/hooks/useViewportHeight';
import { ChatHeader } from '@/components/Chat/ChatHeader';
import { SelectionToolbar } from '@/components/Chat/SelectionToolbar';
import { MessageList } from '@/components/Chat/MessageList';
import { MessageInput } from '@/components/Chat/MessageInput';
import { MessageMenu } from '@/components/Chat/MessageMenu';
import { DeleteDialog, type ConfirmKind } from '@/components/Chat/DeleteDialog';
import { Sheet, type SheetAction } from '@/components/UI/Sheet';
import { chatTitle } from '@/lib/supabase';
import type { ReplyTarget, UiMessage } from '@/types/chat';
import './ChatPage.scss';

/** How long a jumped-to message keeps its highlight. */
const HIGHLIGHT_MS = 1800;

export function ChatPage() {
  useViewportHeight();

  const navigate = useNavigate();
  const { notify } = useToast();
  const { session, profile, conversationId, isAdmin, signOut } = useAuth();

  const userId = session?.user?.id ?? '';

  const {
    messages,
    participants,
    otherParticipant,
    loading,
    loadingOlder,
    hasMore,
    loadError,
    connection,
    othersTyping,
    othersPresent,
    loadOlder,
    sendMessage,
    sendImage,
    editMessage,
    deleteForMe,
    deleteForEveryone,
    deleteAllMine,
    clearForMe,
    markThreadRead,
    broadcastTyping,
  } = useMessages({ conversationId, userId });

  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [menuMessage, setMenuMessage] = useState<UiMessage | null>(null);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [deleteModeFor, setDeleteModeFor] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; ids: string[] } | null>(
    null,
  );
  const [confirmWorking, setConfirmWorking] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  /** A jump target that has not been paged in yet. */
  const pendingJump = useRef<{ id: string; attempts: number } | null>(null);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const resolveName = useCallback(
    (senderId: string | null) => {
      if (!senderId) return null;
      if (senderId === userId) return 'You';
      return (
        participants.find((participant) => participant.id === senderId)?.display_name ??
        null
      );
    },
    [participants, userId],
  );

  const ownMessages = useMemo(
    () => messages.filter((message) => message.sender_id === userId),
    [messages, userId],
  );

  useEffect(() => {
    if (loadError) notify(loadError, 'error');
  }, [loadError, notify]);

  // Coming back to the tab is as good a signal as scrolling for "I read this".
  useEffect(() => {
    const handleFocus = () => {
      if (document.visibilityState === 'visible') void markThreadRead();
    };
    document.addEventListener('visibilitychange', handleFocus);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleFocus);
      window.removeEventListener('focus', handleFocus);
    };
  }, [markThreadRead]);

  // Escape leaves whichever transient mode is active.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menuMessage || chatMenuOpen || confirm || deleteModeFor) return;
      if (editingId) {
        setEditingId(null);
        return;
      }
      if (replyTo) {
        setReplyTo(null);
        return;
      }
      if (selecting) exitSelection();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    menuMessage,
    chatMenuOpen,
    confirm,
    deleteModeFor,
    editingId,
    replyTo,
    selecting,
    exitSelection,
  ]);

  // Clear the highlight once it has done its job.
  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  /**
   * Walk backwards through the history until the quoted message is loaded.
   * Bounded, so a quote whose parent this person has hidden cannot spin.
   */
  const jumpToParent = useCallback(
    (messageId: string) => {
      if (messages.some((message) => message.id === messageId)) {
        pendingJump.current = null;
        setHighlightId(messageId);
        return;
      }

      if (!hasMore) {
        notify("That message isn't in this chat any more.", 'error');
        return;
      }

      pendingJump.current = { id: messageId, attempts: 0 };
      void loadOlder();
    },
    [messages, hasMore, loadOlder, notify],
  );

  useEffect(() => {
    const pending = pendingJump.current;
    if (!pending || loadingOlder) return;

    if (messages.some((message) => message.id === pending.id)) {
      pendingJump.current = null;
      setHighlightId(pending.id);
      return;
    }

    if (pending.attempts >= 5 || !hasMore) {
      pendingJump.current = null;
      notify("Couldn't find the original message.", 'error');
      return;
    }

    pending.attempts += 1;
    void loadOlder();
  }, [messages, loadingOlder, hasMore, loadOlder, notify]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSend = useCallback(
    async (content: string) => {
      const replyId = replyTo?.id ?? null;
      try {
        await sendMessage(content, replyId);
        setReplyTo(null);
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Couldn't send your message.",
          'error',
        );
        throw error;
      }
    },
    [sendMessage, replyTo, notify],
  );

  const handleSendImage = useCallback(
    async (file: File) => {
      try {
        await sendImage(file, replyTo?.id ?? null);
        setReplyTo(null);
      } catch (error) {
        notify(error instanceof Error ? error.message : "Couldn't send the image.", 'error');
        throw error;
      }
    },
    [sendImage, replyTo, notify],
  );

  const handleRetry = useCallback(
    async (message: UiMessage) => {
      // The failed bubble only ever existed locally, so drop it and resend.
      await deleteForMe([message.id]).catch(() => undefined);
      try {
        await sendMessage(message.content, message.reply_to_message_id);
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Couldn't send your message.",
          'error',
        );
      }
    },
    [deleteForMe, sendMessage, notify],
  );

  const handleSaveEdit = useCallback(
    async (id: string, content: string) => {
      setSavingEdit(true);
      try {
        await editMessage(id, content);
        setEditingId(null);
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Couldn't edit this message.",
          'error',
        );
      } finally {
        setSavingEdit(false);
      }
    },
    [editMessage, notify],
  );

  const handleCopy = useCallback(
    async (message: UiMessage) => {
      try {
        await navigator.clipboard.writeText(message.content);
        notify('Copied', 'success');
      } catch {
        notify("Couldn't copy that message.", 'error');
      }
    },
    [notify],
  );

  const startReply = useCallback(
    (message: UiMessage) => {
      if (message.deleted_for_everyone || message.pending) return;
      setReplyTo({
        id: message.id,
        senderId: message.sender_id,
        senderName: resolveName(message.sender_id) ?? 'Message',
        content: message.message_type === 'image' ? 'Photo' : message.content,
      });
      exitSelection();
    },
    [resolveName, exitSelection],
  );

  const runConfirmed = useCallback(async () => {
    if (!confirm) return;
    setConfirmWorking(true);

    try {
      switch (confirm.kind) {
        case 'deleteForMe': {
          const removed = await deleteForMe(confirm.ids);
          notify(
            removed === 1 ? 'Message deleted for you' : `${removed} messages deleted for you`,
            'success',
          );
          exitSelection();
          break;
        }
        case 'deleteForEveryone': {
          const removed = await deleteForEveryone(confirm.ids);
          notify(
            removed === 0
              ? 'Nothing left to delete'
              : removed === 1
                ? 'Message deleted for everyone'
                : `${removed} messages deleted for everyone`,
            'success',
          );
          exitSelection();
          break;
        }
        case 'mine': {
          const removed = await deleteAllMine();
          notify(
            removed === 0
              ? 'You had no messages to delete'
              : `Deleted ${removed} ${removed === 1 ? 'message' : 'messages'}`,
            'success',
          );
          exitSelection();
          break;
        }
        case 'clear': {
          await clearForMe();
          notify('Chat cleared on your side', 'success');
          break;
        }
        case 'logout': {
          await signOut();
          navigate('/', { replace: true });
          break;
        }
      }

      // A reply whose target has just gone should not stay in the composer.
      if (replyTo && confirm.ids.includes(replyTo.id)) setReplyTo(null);
      setConfirm(null);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'That did not work. Try again.',
        'error',
      );
    } finally {
      setConfirmWorking(false);
    }
  }, [
    confirm,
    deleteForMe,
    deleteForEveryone,
    deleteAllMine,
    clearForMe,
    signOut,
    navigate,
    notify,
    exitSelection,
    replyTo,
  ]);

  const chatActions: SheetAction[] = [
    {
      id: 'select',
      label: 'Select messages',
      icon: <ListChecks size={18} />,
      onSelect: () => setSelecting(true),
    },
    {
      id: 'delete-mine',
      label: 'Delete my messages',
      icon: <Trash2 size={18} />,
      tone: 'danger',
      hint: 'Removes everything you sent, for both of you',
      onSelect: () => setConfirm({ kind: 'mine', ids: [] }),
    },
    {
      id: 'clear',
      label: 'Clear chat',
      icon: <Eraser size={18} />,
      hint: 'Hides the history on this side only',
      onSelect: () => setConfirm({ kind: 'clear', ids: [] }),
    },
    {
      id: 'logout',
      label: 'Log out',
      icon: <LogOut size={18} />,
      onSelect: () => setConfirm({ kind: 'logout', ids: [] }),
    },
  ];

  if (isAdmin) {
    chatActions.splice(3, 0, {
      id: 'admin',
      label: 'Admin overview',
      icon: <ShieldCheck size={18} />,
      onSelect: () => navigate('/admin'),
    });
  }

  /** Asked after the selection's delete button: which of the two modes? */
  const selectionDeleteActions: SheetAction[] = [
    {
      id: 'for-me',
      label: 'Delete for me',
      icon: <EyeOff size={18} />,
      hint: 'They stay visible for the other person',
      onSelect: () =>
        setConfirm({ kind: 'deleteForMe', ids: deleteModeFor ?? [] }),
    },
    {
      id: 'for-everyone',
      label: 'Delete for everyone',
      icon: <Trash2 size={18} />,
      tone: 'danger',
      hint: 'Removes the text for both of you',
      onSelect: () =>
        setConfirm({ kind: 'deleteForEveryone', ids: deleteModeFor ?? [] }),
    },
  ];

  const otherName = otherParticipant?.display_name ?? 'Your person';
  const status = othersTyping
    ? `${otherName} is typing…`
    : othersPresent
      ? 'Online'
      : otherName;

  const allSelected = messages.length > 0 && selectedIds.size === messages.length;

  const confirmCount =
    confirm?.kind === 'mine'
      ? ownMessages.filter((message) => !message.deleted_for_everyone).length
      : (confirm?.ids.length ?? 1);

  return (
    <div className="chat">
      {selecting ? (
        <SelectionToolbar
          selectedCount={selectedIds.size}
          totalCount={messages.length}
          allSelected={allSelected}
          onCancel={exitSelection}
          onSelectAll={() =>
            setSelectedIds(
              allSelected ? new Set() : new Set(messages.map((message) => message.id)),
            )
          }
          onDelete={() => setDeleteModeFor([...selectedIds])}
        />
      ) : (
        <ChatHeader
          title={chatTitle}
          status={status}
          connection={connection}
          onOpenMenu={() => setChatMenuOpen(true)}
          showAdminLink={isAdmin}
          onOpenAdmin={() => navigate('/admin')}
        />
      )}

      <MessageList
        messages={messages}
        currentUserId={userId}
        loading={loading}
        loadingOlder={loadingOlder}
        hasMore={hasMore}
        typing={othersTyping}
        typingName={otherParticipant?.display_name ?? null}
        selecting={selecting}
        selectedIds={selectedIds}
        editingId={editingId}
        savingEdit={savingEdit}
        onLoadOlder={() => void loadOlder()}
        onToggleSelect={toggleSelect}
        onOpenMenu={setMenuMessage}
        onSaveEdit={(id, content) => void handleSaveEdit(id, content)}
        onCancelEdit={() => setEditingId(null)}
        onRetry={(message) => void handleRetry(message)}
        resolveName={resolveName}
        highlightId={highlightId}
        onJumpToParent={jumpToParent}
        onReachBottom={() => void markThreadRead()}
      />

      {!selecting && !editingId && (
        <MessageInput
          onSend={handleSend}
          onSendImage={handleSendImage}
          onTypingChange={broadcastTyping}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          disabled={!conversationId || Boolean(loadError)}
        />
      )}

      <MessageMenu
        message={menuMessage}
        isOwn={menuMessage?.sender_id === userId}
        onClose={() => setMenuMessage(null)}
        onReply={startReply}
        onEdit={(message) => setEditingId(message.id)}
        onDeleteForMe={(message) =>
          setConfirm({ kind: 'deleteForMe', ids: [message.id] })
        }
        onDeleteForEveryone={(message) =>
          setConfirm({ kind: 'deleteForEveryone', ids: [message.id] })
        }
        onSelect={(message) => {
          setSelecting(true);
          setSelectedIds(new Set([message.id]));
        }}
        onCopy={(message) => void handleCopy(message)}
      />

      <Sheet
        open={chatMenuOpen}
        title="Chat options"
        actions={chatActions}
        onClose={() => setChatMenuOpen(false)}
      />

      <Sheet
        open={deleteModeFor !== null}
        title={
          deleteModeFor && deleteModeFor.length === 1
            ? 'Delete message'
            : `Delete ${deleteModeFor?.length ?? 0} messages`
        }
        actions={selectionDeleteActions}
        onClose={() => setDeleteModeFor(null)}
      />

      <DeleteDialog
        kind={confirm?.kind ?? null}
        count={confirmCount}
        working={confirmWorking}
        onConfirm={() => void runConfirmed()}
        onCancel={() => setConfirm(null)}
      />

      <p className="visually-hidden" aria-live="polite">
        {profile ? `Signed in as ${profile.display_name}.` : ''}
      </p>
    </div>
  );
}
