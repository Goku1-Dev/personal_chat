import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { formatFull, formatTime } from '@/lib/format';
import { MAX_MESSAGE_LENGTH } from '@/lib/errors';
import { Spinner } from '@/components/UI/Spinner';
import type { UiMessage } from '@/types/chat';
import './MessageBubble.scss';

interface MessageBubbleProps {
  message: UiMessage;
  isOwn: boolean;
  /** Last bubble of a run: carries the tail, the timestamp and the ticks. */
  showMeta: boolean;
  selecting: boolean;
  selected: boolean;
  editing: boolean;
  savingEdit: boolean;
  onToggleSelect: (id: string) => void;
  onOpenMenu: (message: UiMessage) => void;
  onSaveEdit: (id: string, content: string) => void;
  onCancelEdit: () => void;
  onRetry: (message: UiMessage) => void;
}

export function MessageBubble({
  message,
  isOwn,
  showMeta,
  selecting,
  selected,
  editing,
  savingEdit,
  onToggleSelect,
  onOpenMenu,
  onSaveEdit,
  onCancelEdit,
  onRetry,
}: MessageBubbleProps) {
  const [draft, setDraft] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) setDraft(message.content);
  }, [editing, message.content]);

  // Grow the edit field to fit, and put the caret at the end.
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!editing || !node) return;

    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }, [editing, draft]);

  useEffect(() => {
    if (!editing) return;
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, [editing]);

  const trimmedDraft = draft.trim();
  const canSave =
    trimmedDraft.length > 0 &&
    trimmedDraft.length <= MAX_MESSAGE_LENGTH &&
    trimmedDraft !== message.content &&
    !savingEdit;

  const handleEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancelEdit();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSave) onSaveEdit(message.id, trimmedDraft);
    }
  };

  const handleActivate = () => {
    if (selecting) {
      onToggleSelect(message.id);
      return;
    }
    if (message.failed) {
      onRetry(message);
      return;
    }
    if (!message.pending) onOpenMenu(message);
  };

  const handleContextMenu = (event: MouseEvent) => {
    if (selecting || message.pending) return;
    event.preventDefault();
    onOpenMenu(message);
  };

  const side = isOwn ? 'own' : 'their';
  const rowClassName = [
    'bubble-row',
    `bubble-row--${side}`,
    showMeta ? 'bubble-row--run-end' : '',
    selecting ? 'bubble-row--selecting' : '',
    selected ? 'bubble-row--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (editing) {
    return (
      <div className={`${rowClassName} bubble-row--editing`}>
        <div className="bubble-edit" role="group" aria-label="Editing message">
          <p className="bubble-edit__label">Editing message</p>

          <label className="visually-hidden" htmlFor={`edit-${message.id}`}>
            Message text
          </label>
          <textarea
            id={`edit-${message.id}`}
            ref={textareaRef}
            className="bubble-edit__field"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleEditKeyDown}
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            disabled={savingEdit}
          />

          <div className="bubble-edit__actions">
            <button
              type="button"
              className="bubble-edit__button"
              onClick={onCancelEdit}
              disabled={savingEdit}
            >
              Cancel
            </button>
            <button
              type="button"
              className="bubble-edit__button bubble-edit__button--primary"
              onClick={() => onSaveEdit(message.id, trimmedDraft)}
              disabled={!canSave}
            >
              {savingEdit ? <Spinner size={14} label="Saving" /> : 'Save'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={rowClassName}>
      {selecting && (
        <span
          className={`bubble-row__check ${selected ? 'bubble-row__check--on' : ''}`}
          aria-hidden="true"
        >
          {selected && <Check size={13} strokeWidth={3} />}
        </span>
      )}

      <div className="bubble-row__stack">
        <button
          type="button"
          className="bubble"
          onClick={handleActivate}
          onContextMenu={handleContextMenu}
          aria-haspopup={selecting ? undefined : 'dialog'}
          aria-pressed={selecting ? selected : undefined}
          aria-label={
            selecting
              ? `${selected ? 'Deselect' : 'Select'} message: ${message.content}`
              : undefined
          }
          title={formatFull(message.created_at)}
        >
          <span className="bubble__text">{message.content}</span>
        </button>

        {showMeta && (
          <p className="bubble-meta">
            <span className="bubble-meta__time">{formatTime(message.created_at)}</span>

            {message.edited_at && (
              <span className="bubble-meta__edited"> · edited</span>
            )}

            {isOwn && (
              <span className="bubble-meta__status">
                {message.failed ? (
                  <>
                    <AlertCircle size={13} aria-hidden="true" />
                    <span className="bubble-meta__retry">Not sent — tap to retry</span>
                  </>
                ) : message.pending ? (
                  <Clock size={13} aria-label="Sending" />
                ) : message.read_at ? (
                  <CheckCheck size={14} aria-label="Read" />
                ) : (
                  <Check size={14} aria-label="Sent" />
                )}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
