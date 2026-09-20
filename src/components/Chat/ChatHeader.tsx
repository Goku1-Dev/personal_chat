import { ChevronLeft, MoreVertical, ShieldCheck } from 'lucide-react';
import type { ConnectionStatus } from '@/types/chat';
import './ChatHeader.scss';

interface ChatHeaderProps {
  title: string;
  /** "Online", "typing…", or the other participant's name. */
  status: string;
  connection: ConnectionStatus;
  onOpenMenu: () => void;
  onBack?: () => void;
  backLabel?: string;
  showAdminLink?: boolean;
  onOpenAdmin?: () => void;
}

const connectionCopy: Record<ConnectionStatus, string | null> = {
  connecting: null,
  connected: null,
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

export function ChatHeader({
  title,
  status,
  connection,
  onOpenMenu,
  onBack,
  backLabel = 'Go back',
  showAdminLink = false,
  onOpenAdmin,
}: ChatHeaderProps) {
  const banner = connectionCopy[connection];

  return (
    <header className="chat-header">
      <div className="chat-header__row">
        {onBack ? (
          <button
            type="button"
            className="chat-header__icon"
            onClick={onBack}
            aria-label={backLabel}
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
        ) : (
          <span className="chat-header__spacer" aria-hidden="true" />
        )}

        <div className="chat-header__identity">
          <h1 className="chat-header__title">{title}</h1>
          <p className="chat-header__status" aria-live="polite">
            {banner ?? status}
          </p>
        </div>

        {showAdminLink && (
          <button
            type="button"
            className="chat-header__icon"
            onClick={onOpenAdmin}
            aria-label="Open admin overview"
          >
            <ShieldCheck size={19} aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          className="chat-header__icon"
          onClick={onOpenMenu}
          aria-label="Chat options"
          aria-haspopup="dialog"
        >
          <MoreVertical size={20} aria-hidden="true" />
        </button>
      </div>

      {banner && (
        <div
          className={`chat-header__banner chat-header__banner--${connection}`}
          role="status"
        >
          {banner}
        </div>
      )}
    </header>
  );
}
