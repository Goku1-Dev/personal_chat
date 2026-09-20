import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eraser, ListChecks, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
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
import type { UiMessage } from '@/types/chat';
import './ChatPage.scss';

export function ChatPage() {
  useViewportHeight();

  const navigate = useNavigate();
  const { notify } = useToast();
  const { session, profile, conversationId, isAdmin, signOut } = useAuth();

  const userId = session?.user?.id ?? '';

  const {
    messages,
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
    editMessage,
    deleteMessages,
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
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; ids: string[] } | null>(
    null,
  );
  const [confirmWorking, setConfirmWorking] = useState(false);

  const ownMessages = useMemo(
    () => messages.filter((message) => message.sender_id === userId),
    [messages, userId],
  );

  const deletableSelected = useMemo(
    () => ownMessages.filter((message) => selectedIds.has(message.id)).map((m) => m.id),
    [ownMessages, selectedIds],
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

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  // Escape leaves whichever transient mode is active.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menuMessage || chatMenuOpen || confirm) return; // handled by the overlay
      if (editingId) {
        setEditingId(null);
        return;
      }
      if (selecting) exitSelection();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [menuMessage, chatMenuOpen, confirm, editingId, selecting, exitSelection]);

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
      try {
        await sendMessage(content);
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Couldn't send your message.",
          'error',
        );
        throw error;
      }
    },
    [sendMessage, notify],
  );

  const handleRetry = useCallback(
    async (message: UiMessage) => {
      await deleteMessages([message.id]).catch(() => undefined);
      try {
        await sendMessage(message.content);
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Couldn't send your message.",
          'error',
        );
      }
    },
    [deleteMessages, sendMessage, notify],
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

  const runConfirmed = useCallback(async () => {
    if (!confirm) return;
    setConfirmWorking(true);

    try {
      switch (confirm.kind) {
        case 'single':
        case 'selected': {
          await deleteMessages(confirm.ids);
          notify(
            confirm.ids.length === 1 ? 'Message deleted' : 'Messages deleted',
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
    deleteMessages,
    deleteAllMine,
    clearForMe,
    signOut,
    navigate,
    notify,
    exitSelection,
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
      hint: 'Removes only what you sent',
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

  const otherName = otherParticipant?.display_name ?? 'Your person';
  const status = othersTyping
    ? `${otherName} is typing…`
    : othersPresent
      ? 'Online'
      : otherName;

  const allOwnSelected =
    ownMessages.length > 0 && deletableSelected.length === ownMessages.length;

  return (
    <div className="chat">
      {selecting ? (
        <SelectionToolbar
          selectedCount={selectedIds.size}
          deletableCount={deletableSelected.length}
          allOwnSelected={allOwnSelected}
          onCancel={exitSelection}
          onSelectAllOwn={() =>
            setSelectedIds(
              allOwnSelected ? new Set() : new Set(ownMessages.map((m) => m.id)),
            )
          }
          onDeleteSelected={() =>
            setConfirm({ kind: 'selected', ids: deletableSelected })
          }
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
        onReachBottom={() => void markThreadRead()}
      />

      {!selecting && !editingId && (
        <MessageInput
          onSend={handleSend}
          onTypingChange={broadcastTyping}
          disabled={!conversationId || Boolean(loadError)}
        />
      )}

      <MessageMenu
        message={menuMessage}
        isOwn={menuMessage?.sender_id === userId}
        onClose={() => setMenuMessage(null)}
        onEdit={(message) => setEditingId(message.id)}
        onDelete={(message) => setConfirm({ kind: 'single', ids: [message.id] })}
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

      <DeleteDialog
        kind={confirm?.kind ?? null}
        count={confirm?.ids.length || (confirm?.kind === 'mine' ? ownMessages.length : 1)}
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
