import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Heart, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { AuthError } from '@/context/AuthContext';
import { Spinner } from '@/components/UI/Spinner';
import './PasswordGate.scss';

type Mode = 'password' | 'admin';

export function PasswordGate() {
  const { enterWithPassword, signInAsAdmin, working } = useAuth();

  const [mode, setMode] = useState<Mode>('password');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setError(null);
  }, [mode]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (working) return;

    setError(null);

    try {
      if (mode === 'admin') {
        if (!email.trim() || !password) {
          setError('Enter both an email and a password.');
          return;
        }
        await signInAsAdmin(email, password);
      } else {
        if (!password) {
          setError('Enter the password to continue.');
          return;
        }
        await enterWithPassword(password);
      }
      setPassword('');
    } catch (caught) {
      setError(
        caught instanceof AuthError || caught instanceof Error
          ? caught.message
          : 'Something went wrong. Try again.',
      );
      setPassword('');
      passwordRef.current?.focus();
    }
  };

  const isAdminMode = mode === 'admin';

  return (
    <main className="gate">
      <form className="gate__panel" onSubmit={handleSubmit} noValidate>
        <span className="gate__mark" aria-hidden="true">
          {isAdminMode ? <Lock size={20} /> : <Heart size={20} />}
        </span>

        <h1 className="gate__heading">
          {isAdminMode ? 'Welcome back.' : 'Just between us.'}
        </h1>
        <p className="gate__subheading">
          {isAdminMode ? (
            'Sign in with your account.'
          ) : (
            <>
              Enter the{' '}
              <span className="gate__highlight">Email Password</span>{' '}
              to continue.
            </>
          )}
        </p>

        {isAdminMode && (
          <div className="gate__field">
            <label className="visually-hidden" htmlFor="gate-email">
              Email
            </label>
            <input
              id="gate-email"
              className="gate__input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={working}
            />
          </div>
        )}

        <div className="gate__field">
          <label className="visually-hidden" htmlFor="gate-password">
            Password
          </label>
          <input
            id="gate-password"
            ref={passwordRef}
            className="gate__input gate__input--with-action"
            type={reveal ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            autoComplete={isAdminMode ? 'current-password' : 'off'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={!isAdminMode}
            disabled={working}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'gate-error' : undefined}
          />
          <button
            type="button"
            className="gate__reveal"
            onClick={() => setReveal((current) => !current)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            aria-pressed={reveal}
            disabled={working}
          >
            {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        <p
          className={`gate__error ${error ? 'gate__error--visible' : ''}`}
          id="gate-error"
          role="alert"
        >
          {error ?? ''}
        </p>

        <button type="submit" className="gate__submit" disabled={working}>
          {working ? <Spinner size={16} label="Checking" /> : 'Continue'}
        </button>

        <button
          type="button"
          className="gate__switch"
          onClick={() => setMode(isAdminMode ? 'password' : 'admin')}
          disabled={working}
        >
          {isAdminMode ? 'Use the shared password' : 'Sign in as admin'}
        </button>
      </form>
    </main>
  );
}
