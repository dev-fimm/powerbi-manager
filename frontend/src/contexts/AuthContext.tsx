import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { UNAUTHORIZED_EVENT, api, tokenStorage, userStorage } from '../lib/api';
import type { LoginResponse, Role, User } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  /** true se o usuario tiver QUALQUER uma das roles informadas. */
  hasRole: (...roles: Role[]) => boolean;
  /** true se a conta puder acessar a tela informada (por chave). */
  hasScreen: (screen: string) => boolean;
  isAdmin: boolean;
  /** ADMIN ou GESTOR: perfis que podem criar/editar. */
  canManage: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => userStorage.get<User>());
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    // Registra o logout na auditoria (fire-and-forget). O token ainda existe
    // neste instante porque a requisicao le o header antes de limparmos abaixo.
    api.post('/auth/logout').catch(() => {
      /* logout e sempre local; ignora falha de rede */
    });
    tokenStorage.clear();
    setUser(null);
  }, []);

  // Revalida o token no boot: se estiver expirado ou o usuario tiver sido
  // desativado, o /auth/me retorna 401 e o app cai para a tela de login.
  useEffect(() => {
    const token = tokenStorage.get();
    if (!token) {
      setLoading(false);
      return;
    }

    api
      .get<{ user: User }>('/auth/me')
      .then(({ user: fresh }) => {
        setUser(fresh);
        userStorage.set(fresh);
      })
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  // Qualquer 401 vindo do cliente HTTP derruba a sessao.
  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<LoginResponse>('/auth/login', { email, password });
    tokenStorage.set(data.token);
    userStorage.set(data.user);
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      hasRole: (...roles: Role[]) => (user ? roles.includes(user.role) : false),
      hasScreen: (screen: string) => user?.allowed_screens?.includes(screen) ?? false,
      isAdmin: user?.role === 'ADMIN',
      canManage: user?.role === 'ADMIN' || user?.role === 'GESTOR',
    }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return ctx;
}
