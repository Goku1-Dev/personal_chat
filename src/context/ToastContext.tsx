import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertCircle, Check, Info, X } from 'lucide-react';
import '@/components/UI/Toast.scss';

export type ToastTone = 'info' | 'error' | 'success';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastContextValue {
  notify: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION = 4200;

const icons: Record<ToastTone, typeof Info> = {
  info: Info,
  error: AlertCircle,
  success: Check,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      setToasts((current) => {
        // Never stack the same message twice, and keep at most three.
        const deduped = current.filter((toast) => toast.message !== message);
        return [...deduped, { id, message, tone }].slice(-3);
      });
      const timer = window.setTimeout(() => dismiss(id), DURATION);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" role="region" aria-label="Notifications">
        <ul className="toast-viewport__list">
          {toasts.map((toast) => {
            const Icon = icons[toast.tone];
            return (
              <li
                key={toast.id}
                className={`toast toast--${toast.tone}`}
                role={toast.tone === 'error' ? 'alert' : 'status'}
              >
                <Icon size={16} aria-hidden="true" className="toast__icon" />
                <span className="toast__text">{toast.message}</span>
                <button
                  type="button"
                  className="toast__close"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss notification"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </ToastContext.Provider>
  );
}
