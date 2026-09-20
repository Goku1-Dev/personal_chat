import './TypingIndicator.scss';

interface TypingIndicatorProps {
  /** Name of the person typing, when known. */
  name?: string | null;
}

export function TypingIndicator({ name }: TypingIndicatorProps) {
  return (
    <div className="typing" role="status" aria-live="polite">
      <span className="typing__bubble" aria-hidden="true">
        <span className="typing__dot" />
        <span className="typing__dot" />
        <span className="typing__dot" />
      </span>
      <span className="visually-hidden">
        {name ? `${name} is typing` : 'Someone is typing'}
      </span>
    </div>
  );
}
