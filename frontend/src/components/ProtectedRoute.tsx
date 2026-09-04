import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { firstAllowedPath } from '../lib/screens';
import type { Role } from '../types';

/**
 * Guarda de rota do frontend.
 * IMPORTANTE: isto e apenas usabilidade (esconder telas que o usuario nao usa).
 * A autorizacao real acontece no backend, que valida token e role em toda rota.
 *
 * - roles: restringe por perfil (legado).
 * - screen: restringe pela tela liberada para a conta (gestao por conta). Quando
 *   a conta nao tem acesso, redireciona para a primeira tela permitida.
 */
export function ProtectedRoute({
  children,
  roles,
  screen,
}: {
  children: ReactNode;
  roles?: Role[];
  screen?: string;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <svg className="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={firstAllowedPath(user.allowed_screens)} replace />;
  }

  // Bloqueio por tela: se a conta nao tem a tela liberada, manda para a
  // primeira tela permitida (evita loop quando o proprio destino e negado).
  if (screen && !user.allowed_screens?.includes(screen)) {
    const fallback = firstAllowedPath(user.allowed_screens);
    if (fallback !== location.pathname) {
      return <Navigate to={fallback} replace />;
    }
  }

  return <>{children}</>;
}
