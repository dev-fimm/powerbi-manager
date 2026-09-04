import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Envolve um handler assincrono para que qualquer promise rejeitada
 * caia no errorHandler do Express (que nao captura async por padrao).
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
