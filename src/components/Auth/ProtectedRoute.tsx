import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Spinner } from '@/components/UI/Spinner';
import './ProtectedRoute.scss';

interface ProtectedRouteProps {
  children: ReactNode;
  /** When true, a signed-in non-admin is sent back to the chat. */
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { initialising, isAuthenticated, isAdmin, profile, session, signOut } =
    useAuth();
  const location = useLocation();

  if (initialising) {
    return (
      <div className="route-status">
        <Spinner size={22} label="Opening" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  // Signed in, but no matching profile row: the account exists in Auth and
  // was never linked to a participant. Say so rather than showing an
  // empty chat that silently fails on every write.
  if (session && !profile) {
    return (
      <div className="route-status route-status--message">
        <h1 className="route-status__title">This account isn&apos;t set up yet</h1>
        <p className="route-status__body">
          The sign-in worked, but there is no participant profile linked to it. Add a
          row in <code>profiles</code> and <code>conversation_participants</code> for
          this account, then try again.
        </p>
        <button type="button" className="route-status__action" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/chat" replace />;
  }

  return <>{children}</>;
}
