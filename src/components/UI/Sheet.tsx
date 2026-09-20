import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './Sheet.scss';

export interface SheetAction {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  hint?: string;
}

interface SheetProps {
  open: boolean;
  title: string;
  actions: SheetAction[];
  onClose: () => void;
  /** Optional read-only preview shown above the actions. */
  preview?: string;
}

/**
 * A bottom sheet on phones, a centred card from tablet up. Used instead of a
 * desktop-only right-click menu so every action is reachable by thumb.
 */
export function Sheet({ open, title, actions, onClose, preview }: SheetProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    surfaceRef.current?.querySelector<HTMLButtonElement>('button')?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

      const buttons = Array.from(
        surfaceRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
      );
      if (buttons.length === 0) return;

      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (index + delta + buttons.length) % buttons.length;
      buttons[next].focus();
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreFocusTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="sheet" role="presentation" onMouseDown={onClose}>
      <div
        className="sheet__surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={surfaceRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet__grip" aria-hidden="true" />
        <p className="sheet__title" id={titleId}>
          {title}
        </p>

        {preview && <p className="sheet__preview">{preview}</p>}

        <ul className="sheet__list">
          {actions.map((action) => (
            <li key={action.id}>
              <button
                type="button"
                className={`sheet__action sheet__action--${action.tone ?? 'default'}`}
                onClick={() => {
                  onClose();
                  action.onSelect();
                }}
              >
                <span className="sheet__action-icon" aria-hidden="true">
                  {action.icon}
                </span>
                <span className="sheet__action-body">
                  <span className="sheet__action-label">{action.label}</span>
                  {action.hint && (
                    <span className="sheet__action-hint">{action.hint}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <button type="button" className="sheet__cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}
