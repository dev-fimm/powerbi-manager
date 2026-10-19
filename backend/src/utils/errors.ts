/**
 * Erro de aplicacao com status HTTP. Qualquer camada pode lancar este erro;
 * o errorHandler global converte em resposta JSON padronizada.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Nao autenticado.') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Voce nao tem permissao para executar esta acao.') {
    super(message, 403);
  }
}

/**
 * 429 - usado pela protecao contra forca bruta do login.
 *
 * Carrega os segundos restantes para o chamador montar o header Retry-After
 * sem ter de reconsultar o contador.
 */
export class TooManyRequestsError extends AppError {
  /** null quando o bloqueio nao tem prazo (exige liberacao manual). */
  public readonly retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null) {
    super(message, 429);
    this.name = 'TooManyRequestsError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso nao encontrado.') {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflito de dados.') {
    super(message, 409);
  }
}
