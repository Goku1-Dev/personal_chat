import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useViewportHeight } from '@/hooks/useViewportHeight';
import { PasswordGate } from '@/components/Auth/PasswordGate';
import { Spinner } from '@/components/UI/Spinner';

export function PasswordPage() {
  useViewportHeight();
  const { initialising, isAuthenticated } = useAuth();

  if (initialising) {
    return (
      <div className="route-status">
        <Spinner size={22} label="Opening" />
      </div>
    );
  }

  // Someone arriving with a live session goes straight through to the chat.
  if (isAuthenticated) {
    return <Navigate to="/chat" replace />;
  }

  return <PasswordGate />;
}
