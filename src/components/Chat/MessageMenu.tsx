import { Copy, ListChecks, Pencil, Trash2 } from 'lucide-react';
import { Sheet, type SheetAction } from '@/components/UI/Sheet';
import type { UiMessage } from '@/types/chat';

interface MessageMenuProps {
  message: UiMessage | null;
  isOwn: boolean;
  onClose: () => void;
  onEdit: (message: UiMessage) => void;
  onDelete: (message: UiMessage) => void;
  onSelect: (message: UiMessage) => void;
  onCopy: (message: UiMessage) => void;
}

/**
 * Actions for a single message. Edit and delete only appear on your own
 * messages — the other person's bubble offers selection and copy, and the
 * database refuses anything more even if this menu were bypassed.
 */
export function MessageMenu({
  message,
  isOwn,
  onClose,
  onEdit,
  onDelete,
  onSelect,
  onCopy,
}: MessageMenuProps) {
  if (!message) return null;

  const actions: SheetAction[] = [];

  if (isOwn) {
    actions.push({
      id: 'edit',
      label: 'Edit',
      icon: <Pencil size={18} />,
      onSelect: () => onEdit(message),
    });
  }

  actions.push({
    id: 'copy',
    label: 'Copy text',
    icon: <Copy size={18} />,
    onSelect: () => onCopy(message),
  });

  actions.push({
    id: 'select',
    label: 'Select',
    icon: <ListChecks size={18} />,
    onSelect: () => onSelect(message),
  });

  if (isOwn) {
    actions.push({
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 size={18} />,
      tone: 'danger',
      onSelect: () => onDelete(message),
    });
  }

  return (
    <Sheet
      open
      title={isOwn ? 'Your message' : 'Message'}
      preview={message.content}
      actions={actions}
      onClose={onClose}
    />
  );
}
