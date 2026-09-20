import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  Camera,
  ImagePlus,
  SendHorizontal,
  X,
} from 'lucide-react';
import { MAX_MESSAGE_LENGTH } from '@/lib/errors';
import { Spinner } from '@/components/UI/Spinner';
import type { ReplyTarget } from '@/types/chat';
import './MessageInput.scss';

interface MessageInputProps {
  onSend: (content: string) => Promise<void>;
  onSendImage: (file: File) => Promise<void>;
  onTypingChange: (typing: boolean) => void;
  /** The message being answered, shown above the field until cancelled. */
  replyTo?: ReplyTarget | null;
  onCancelReply?: () => void;
  disabled?: boolean;
}

const MAX_HEIGHT = 132;
const TYPING_IDLE_MS = 2000;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

export function MessageInput({
  onSend,
  onSendImage,
  onTypingChange,
  replyTo = null,
  onCancelReply,
  disabled = false,
}: MessageInputProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const idleTimer = useRef<number | null>(null);
  const isTyping = useRef(false);

  const trimmed = value.trim();

  const canSend =
    trimmed.length > 0 &&
    trimmed.length <= MAX_MESSAGE_LENGTH &&
    !sending;

  const overLimit = trimmed.length > MAX_MESSAGE_LENGTH;

  const stopTyping = useCallback(() => {
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }

    if (isTyping.current) {
      isTyping.current = false;
      onTypingChange(false);
    }
  }, [onTypingChange]);

  const startTyping = useCallback(() => {
    if (!isTyping.current) {
      isTyping.current = true;
      onTypingChange(true);
    }

    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current);
    }

    idleTimer.current = window.setTimeout(() => {
      stopTyping();
    }, TYPING_IDLE_MS);
  }, [onTypingChange, stopTyping]);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;

    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(
      textarea.scrollHeight,
      MAX_HEIGHT,
    )}px`;
  }, []);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = event.target.value;

      setValue(nextValue);

      if (nextValue.trim().length > 0) {
        startTyping();
      } else {
        stopTyping();
      }

      resizeTextarea();
    },
    [resizeTextarea, startTyping, stopTyping],
  );

  const submit = useCallback(async () => {
    if (!canSend || disabled) return;

    const content = trimmed;

    setSending(true);
    stopTyping();

    try {
      await onSend(content);
      setValue('');
      textareaRef.current?.focus();
      resizeTextarea();
    } catch {
      // Parent handles the error.
    } finally {
      setSending(false);
    }
  }, [
    canSend,
    disabled,
    onSend,
    resizeTextarea,
    stopTyping,
    trimmed,
  ]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Escape drops the reply first; only an empty field passes it upward.
      if (event.key === 'Escape' && replyTo) {
        event.preventDefault();
        event.stopPropagation();
        onCancelReply?.();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        // Let IME composition finish before Enter means "send".
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        void submit();
      }
    },
    [submit, replyTo, onCancelReply],
  );

  const handleImageSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) return;

      if (!file.type.startsWith('image/')) {
        alert('Please select an image file.');
        event.target.value = '';
        return;
      }

      if (file.size > MAX_IMAGE_SIZE) {
        alert('Image size must be less than 10 MB.');
        event.target.value = '';
        return;
      }

      try {
        setSending(true);
        stopTyping();

        await onSendImage(file);
      } catch {
        // Parent handles the error.
      } finally {
        setSending(false);
        event.target.value = '';
        textareaRef.current?.focus();
      }
    },
    [onSendImage, stopTyping],
  );

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  useEffect(() => {
    return () => {
      if (idleTimer.current !== null) {
        window.clearTimeout(idleTimer.current);
      }

      if (isTyping.current) {
        onTypingChange(false);
      }
    };
  }, [onTypingChange]);

  // Starting a reply should put the caret where the answer goes.
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  return (
    <div className="composer">
      {replyTo && (
        <div className="composer-reply">
          <div className="composer-reply__body">
            <p className="composer-reply__label">Replying to {replyTo.senderName}</p>
            <p className="composer-reply__text">{replyTo.content}</p>
          </div>
          <button
            type="button"
            className="composer-reply__close"
            onClick={onCancelReply}
            aria-label="Cancel reply"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="composer__inner">
        {/* Image picker */}
        <div className="composer__media-actions">
          <button
            type="button"
            className="composer__media-button"
            onClick={() => imageInputRef.current?.click()}
            disabled={disabled || sending}
            aria-label="Choose image"
            title="Choose image"
          >
            <ImagePlus size={20} strokeWidth={2} />
          </button>

          {/* Camera */}
          <button
            type="button"
            className="composer__media-button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={disabled || sending}
            aria-label="Take photo"
            title="Take photo"
          >
            <Camera size={20} strokeWidth={2} />
          </button>

          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleImageSelected}
          />

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={handleImageSelected}
          />
        </div>

        {/* Message input */}
        <textarea
          ref={textareaRef}
          className="composer__field"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Write a message..."
          rows={1}
          disabled={disabled || sending}
          aria-label="Write a message"
        />

        {/* Send */}
        <button
          type="button"
          className="composer__send"
          onClick={() => void submit()}
          disabled={!canSend || disabled}
          aria-label="Send message"
          title="Send message"
        >
          {sending ? (
            <Spinner size={18} />
          ) : (
            <SendHorizontal size={20} strokeWidth={2.2} />
          )}
        </button>
      </div>

      {overLimit && (
        <div className="composer__limit">
          Message is too long. Maximum {MAX_MESSAGE_LENGTH} characters.
        </div>
      )}
    </div>
  );
}