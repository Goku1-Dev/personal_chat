import { Modal } from '@/components/UI/Modal';
import { Spinner } from '@/components/UI/Spinner';

export type ConfirmKind =
  | 'deleteForMe'
  | 'deleteForEveryone'
  | 'mine'
  | 'clear'
  | 'logout';

interface DeleteDialogProps {
  kind: ConfirmKind | null;
  /** How many messages the action will affect. */
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

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function copyFor(kind: ConfirmKind, count: number): Copy {
  switch (kind) {
    case 'deleteForMe':
      return {
        title:
          count === 1
            ? 'Delete message for you?'
            : `Delete ${count} messages for you?`,
        description:
          count === 1
            ? 'It disappears from your side of the chat. The other person still sees it.'
            : 'They disappear from your side of the chat. The other person still sees them.',
        confirm: 'Delete for me',
        danger: false,
      };
    case 'deleteForEveryone':
      return {
        title:
          count === 1
            ? 'Delete message for everyone?'
            : `Delete ${count} messages for everyone?`,
        description: `The text is removed for both of you. ${plural(
          count,
          'It will show as deleted',
          'They will show as deleted',
        )} and this cannot be undone.`,
        confirm: 'Delete',
        danger: true,
      };
    case 'mine':
      return {
        title: 'Delete all your messages?',
        description:
          'Every message you sent is removed for both of you and will show as deleted. Messages from the other person are left alone.',
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

  const { title, description, confirm, danger } = copyFor(kind, Math.max(count, 1));

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
