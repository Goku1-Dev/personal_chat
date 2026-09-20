import { CheckCheck, Trash2, X } from 'lucide-react';
import './SelectionToolbar.scss';

interface SelectionToolbarProps {
  selectedCount: number;
  /** Every message currently on screen, from either participant. */
  totalCount: number;
  allSelected: boolean;
  onCancel: () => void;
  onSelectAll: () => void;
  onDelete: () => void;
}

/**
 * Selection applies to both people's messages, because both delete modes do.
 * There is one delete button; which mode it performs is asked afterwards.
 */
export function SelectionToolbar({
  selectedCount,
  totalCount,
  allSelected,
  onCancel,
  onSelectAll,
  onDelete,
}: SelectionToolbarProps) {
  const label = selectedCount === 0 ? 'Select messages' : `${selectedCount} selected`;

  return (
    <header className="selection-bar">
      <div className="selection-bar__row">
        <button
          type="button"
          className="selection-bar__icon"
          onClick={onCancel}
          aria-label="Leave selection mode"
        >
          <X size={20} aria-hidden="true" />
        </button>

        <p className="selection-bar__count" aria-live="polite">
          {label}
        </p>

        <button
          type="button"
          className="selection-bar__icon"
          onClick={onSelectAll}
          disabled={totalCount === 0}
          aria-label={allSelected ? 'Clear selection' : 'Select all messages'}
          aria-pressed={allSelected}
        >
          <CheckCheck size={20} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="selection-bar__icon selection-bar__icon--danger"
          onClick={onDelete}
          disabled={selectedCount === 0}
          aria-label={
            selectedCount === 0
              ? 'Select messages to delete'
              : `Delete ${selectedCount} selected ${
                  selectedCount === 1 ? 'message' : 'messages'
                }`
          }
        >
          <Trash2 size={19} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
