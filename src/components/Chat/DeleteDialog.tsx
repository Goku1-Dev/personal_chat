import { Modal } from '@/components/UI/Modal';
import { Spinner } from '@/components/UI/Spinner';

export type ConfirmKind = 'single' | 'selected' | 'mine' | 'clear' | 'logout';

interface DeleteDialogProps {
  kind: ConfirmKind | null;
  /** How many messages the action will remove, where that is meaningful. */
  count?: number;
  working: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

interface Copy {
  title: string;
  description: string;
  confirm: string;
  danger: boolean;
}

function copyFor(kind: ConfirmKind, count: number): Copy {
  switch (kind) {
    case 'single':
      return {
        title: 'Delete message?',
        description: 'This message will be permanently deleted for both of you.',
        confirm: 'Delete',
        danger: true,
      };
    case 'selected':
      return {
        title: count === 1 ? 'Delete message?' : `Delete ${count} messages?`,
        description:
          count === 1
            ? 'This message will be permanently deleted for both of you.'
            : 'These messages will be permanently deleted for both of you.',
        confirm: 'Delete',
        danger: true,
      };
    case 'mine':
      return {
        title: 'Delete all your messages?',
        description:
          'This will permanently remove all messages you sent in this conversation. Messages from the other person stay where they are.',
        confirm: 'Delete',
        danger: true,
      };
    case 'clear':
      return {
        title: 'Clear this chat for you?',
        description:
          'The conversation disappears from your screen only. Nothing is deleted, and the other person still sees everything.',
        confirm: 'Clear',
        danger: false,
      };
    case 'logout':
      return {
        title: 'Log out?',
        description: "You'll need the password again to come back in.",
        confirm: 'Log out',
        danger: false,
      };
  }
}

export function DeleteDialog({
  kind,
  count = 1,
  working,
  onConfirm,
  onCancel,
}: DeleteDialogProps) {
  if (!kind) return null;

  const { title, description, confirm, danger } = copyFor(kind, count);

  return (
    <Modal
      open
      title={title}
      description={description}
      onClose={working ? () => undefined : onCancel}
      actions={
        <>
          <button
            type="button"
            className="modal-button modal-button--ghost"
            onClick={onCancel}
            disabled={working}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`modal-button ${
              danger ? 'modal-button--danger' : 'modal-button--primary'
            }`}
            onClick={onConfirm}
            disabled={working}
          >
            {working ? <Spinner size={14} label="Working" /> : confirm}
          </button>
        </>
      }
    />
  );
}
