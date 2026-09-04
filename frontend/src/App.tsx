import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ContractsPage } from './pages/ContractsPage';
import { DashboardPage } from './pages/DashboardPage';
import { IframesPage } from './pages/IframesPage';
import { LogsPage } from './pages/LogsPage';
import { LoginPage } from './pages/LoginPage';
import { PermissionsPage } from './pages/PermissionsPage';
import { UsersPage } from './pages/UsersPage';
import { ViewerPage } from './pages/ViewerPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        {/* Cada tela e liberada por conta (gestao de acesso por conta).
            ADMIN sempre tem todas as telas; as telas de gestao (users,
            permissions, logs) sao exclusivas de ADMIN. */}
        <Route
          index
          element={
            <ProtectedRoute screen="dashboard">
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="users"
          element={
            <ProtectedRoute screen="users">
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="permissions"
          element={
            <ProtectedRoute screen="permissions">
              <PermissionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="logs"
          element={
            <ProtectedRoute screen="logs">
              <LogsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="contracts"
          element={
            <ProtectedRoute screen="contracts">
              <ContractsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="iframes"
          element={
            <ProtectedRoute screen="iframes">
              <IframesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="paineis"
          element={
            <ProtectedRoute screen="viewer">
              <ViewerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="paineis/:contractId"
          element={
            <ProtectedRoute screen="viewer">
              <ViewerPage />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
