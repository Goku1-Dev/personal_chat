import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@/components/Auth/ProtectedRoute';
import { PasswordPage } from '@/pages/Password/PasswordPage';
import { ChatPage } from '@/pages/Chat/ChatPage';
import { AdminPage } from '@/pages/Admin/AdminPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<PasswordPage />} />

      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin"
        element={
          <ProtectedRoute requireAdmin>
            <AdminPage />
          </ProtectedRoute>
        }
      />

      {/* Nothing else exists here on purpose: no landing page, no detours. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
