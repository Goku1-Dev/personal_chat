import { CheckCheck, Trash2, X } from 'lucide-react';
import './SelectionToolbar.scss';

interface SelectionToolbarProps {
  selectedCount: number;
  /** How many of the selected messages the current participant may delete. */
  deletableCount: number;
  allOwnSelected: boolean;
  onCancel: () => void;
  onSelectAllOwn: () => void;
  onDeleteSelected: () => void;
}

export function SelectionToolbar({
  selectedCount,
  deletableCount,
  allOwnSelected,
  onCancel,
  onSelectAllOwn,
  onDeleteSelected,
}: SelectionToolbarProps) {
  const label =
    selectedCount === 0
      ? 'Select messages'
      : `${selectedCount} selected`;

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
          onClick={onSelectAllOwn}
          aria-label={allOwnSelected ? 'Clear selection' : 'Select all your messages'}
          aria-pressed={allOwnSelected}
        >
          <CheckCheck size={20} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="selection-bar__icon selection-bar__icon--danger"
          onClick={onDeleteSelected}
          disabled={deletableCount === 0}
          aria-label={
            deletableCount === 0
              ? 'Nothing selected that you can delete'
              : `Delete ${deletableCount} of your messages`
          }
        >
          <Trash2 size={19} aria-hidden="true" />
        </button>
      </div>

      {selectedCount > deletableCount && (
        <p className="selection-bar__note">
          Only the {deletableCount === 1 ? 'message' : `${deletableCount} messages`} you
          sent can be deleted.
        </p>
      )}
    </header>
  );
}
