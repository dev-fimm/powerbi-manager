import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { AppError } from '../utils/errors';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ message: `Rota nao encontrada: ${req.method} ${req.originalUrl}` });
}

/**
 * Handler global de erros. Converte AppError, ZodError e erros conhecidos do
 * Prisma em respostas JSON com mensagem amigavel (consumida pelos toasts do front).
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(422).json({
      message: 'Dados invalidos.',
      errors: err.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      message: err.message,
      ...(err.details ? { errors: err.details } : {}),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 = violacao de restricao unica (ex.: email duplicado)
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'campo';
      res.status(409).json({ message: `Ja existe um registro com este ${target}.` });
      return;
    }
    // P2025 = registro nao encontrado
    if (err.code === 'P2025') {
      res.status(404).json({ message: 'Registro nao encontrado.' });
      return;
    }
    // P2003 = violacao de chave estrangeira
    if (err.code === 'P2003') {
      res.status(409).json({ message: 'Operacao viola um vinculo existente.' });
      return;
    }
  }

  // eslint-disable-next-line no-console
  console.error('[erro nao tratado]', err);

  res.status(500).json({
    message: 'Erro interno do servidor.',
    ...(isProduction ? {} : { detail: String(err instanceof Error ? err.message : err) }),
  });
}
