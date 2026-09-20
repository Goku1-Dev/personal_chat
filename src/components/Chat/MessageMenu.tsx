import { Copy, CornerUpLeft, EyeOff, ListChecks, Pencil, Trash2 } from 'lucide-react';
import { Sheet, type SheetAction } from '@/components/UI/Sheet';
import type { UiMessage } from '@/types/chat';

interface MessageMenuProps {
  message: UiMessage | null;
  isOwn: boolean;
  onClose: () => void;
  onReply: (message: UiMessage) => void;
  onEdit: (message: UiMessage) => void;
  onDeleteForMe: (message: UiMessage) => void;
  onDeleteForEveryone: (message: UiMessage) => void;
  onSelect: (message: UiMessage) => void;
  onCopy: (message: UiMessage) => void;
}

/**
 * Actions for a single message.
 *
 * Both delete modes are offered on either person's messages, which is the
 * product rule for this chat. Editing stays with the author: changing what
 * someone else said is a different thing from removing it, and the database
 * refuses it regardless of what this menu shows.
 */
export function MessageMenu({
  message,
  isOwn,
  onClose,
  onReply,
  onEdit,
  onDeleteForMe,
  onDeleteForEveryone,
  onSelect,
  onCopy,
}: MessageMenuProps) {
  if (!message) return null;

  const isDeleted = message.deleted_for_everyone;
  const actions: SheetAction[] = [];

  if (!isDeleted) {
    actions.push({
      id: 'reply',
      label: 'Reply',
      icon: <CornerUpLeft size={18} />,
      onSelect: () => onReply(message),
    });
  }

  if (isOwn && !isDeleted) {
    actions.push({
      id: 'edit',
      label: 'Edit',
      icon: <Pencil size={18} />,
      onSelect: () => onEdit(message),
    });
  }

  if (!isDeleted) {
    actions.push({
      id: 'copy',
      label: 'Copy text',
      icon: <Copy size={18} />,
      onSelect: () => onCopy(message),
    });
  }

  actions.push({
    id: 'select',
    label: 'Select',
    icon: <ListChecks size={18} />,
    onSelect: () => onSelect(message),
  });

  actions.push({
    id: 'delete-me',
    label: 'Delete for me',
    icon: <EyeOff size={18} />,
    hint: 'Hides it on this side only',
    onSelect: () => onDeleteForMe(message),
  });

  if (!isDeleted) {
    actions.push({
      id: 'delete-everyone',
      label: 'Delete for everyone',
      icon: <Trash2 size={18} />,
      tone: 'danger',
      hint: 'Removes the text for both of you',
      onSelect: () => onDeleteForEveryone(message),
    });
  }

  return (
    <Sheet
      open
      title={isDeleted ? 'Deleted message' : isOwn ? 'Your message' : 'Message'}
      preview={isDeleted ? undefined : message.content}
      actions={actions}
      onClose={onClose}
    />
  );
}
