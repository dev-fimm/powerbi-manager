/**
 * ============================================================
 * CLIENTE HTTP
 * ============================================================
 * - Anexa automaticamente o token JWT em todas as requisicoes.
 * - Converte respostas de erro da API em ApiError com mensagem amigavel,
 *   que as paginas exibem via toast.
 * - Em 401, limpa a sessao e dispara um evento para o AuthContext deslogar.
 */

const TOKEN_KEY = 'pbi_manager_token';
const USER_KEY = 'pbi_manager_user';

// Se VITE_API_URL nao estiver definido, usa "/api" (proxy do Vite em dev).
const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';

/** Base da API para montar URLs diretas (ex.: src de iframe de embed). */
export const API_BASE_URL = BASE_URL;

export class ApiError extends Error {
  status: number;
  fieldErrors?: { field: string; message: string }[];

  constructor(message: string, status: number, fieldErrors?: { field: string; message: string }[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export const userStorage = {
  get: <T>(): T | null => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  set: (user: unknown) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
};

/** Evento global usado pelo AuthContext para forcar logout quando a API retorna 401. */
export const UNAUTHORIZED_EVENT = 'app:unauthorized';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStorage.get();

  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError('Nao foi possivel conectar ao servidor. Verifique sua conexao.', 0);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data = text ? safeJson(text) : null;

  if (!response.ok) {
    const message =
      (data as { message?: string } | null)?.message ??
      `Erro ${response.status} ao comunicar com o servidor.`;
    const fieldErrors = (data as { errors?: { field: string; message: string }[] } | null)?.errors;

    // Sessao invalida/expirada: limpa e avisa o app.
    if (response.status === 401 && !path.startsWith('/auth/login')) {
      tokenStorage.clear();
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: message }));
    }

    throw new ApiError(message, response.status, fieldErrors);
  }

  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
