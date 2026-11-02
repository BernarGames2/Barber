import { PG_ERROR, pgErrorCode } from '@barber-voice/db';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export interface ErrorDetail {
  path: string;
  message: string;
}

/** Erro de domínio com código estável (consumido pelo painel e, futuramente, pela IA). */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[] | Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (details: ErrorDetail[]) => new AppError(400, 'VALIDATION_ERROR', 'Dados inválidos.', details),
  unauthorized: (msg = 'É preciso entrar na sua conta.') => new AppError(401, 'UNAUTHORIZED', msg),
  forbidden: (msg = 'Você não tem permissão para esta ação.') => new AppError(403, 'FORBIDDEN', msg),
  notFound: (what = 'Recurso') => new AppError(404, 'NOT_FOUND', `${what} não encontrado.`),
  conflict: (code: string, msg: string, details?: Record<string, unknown>) => new AppError(409, code, msg, details),
  unprocessable: (code: string, msg: string, details?: Record<string, unknown>) => new AppError(422, code, msg, details),
  tooMany: (msg = 'Muitas tentativas. Aguarde um pouco e tente novamente.') => new AppError(429, 'RATE_LIMITED', msg),
};

export function zodDetails(err: ZodError): ErrorDetail[] {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
  }
  if (error instanceof ZodError) {
    return reply
      .status(400)
      .send({ error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', details: zodDetails(error) } });
  }

  const fe = error as FastifyError;
  if (fe.statusCode === 429) {
    return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Muitas requisições. Tente novamente em instantes.' } });
  }
  if (fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || fe.statusCode === 415) {
    return reply.status(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Envie os dados como application/json.' } });
  }
  if (fe.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return reply.status(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Requisição muito grande.' } });
  }
  if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
    return reply.status(fe.statusCode).send({ error: { code: 'BAD_REQUEST', message: 'Requisição inválida.' } });
  }

  // Fallback para violações de integridade não tratadas explicitamente pelos serviços.
  const pg = pgErrorCode(error);
  if (pg === PG_ERROR.EXCLUSION_VIOLATION) {
    return reply.status(409).send({ error: { code: 'SLOT_UNAVAILABLE', message: 'Este horário acabou de ser ocupado.' } });
  }
  if (pg === PG_ERROR.UNIQUE_VIOLATION) {
    return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'Registro duplicado.' } });
  }
  if (pg === PG_ERROR.FOREIGN_KEY_VIOLATION) {
    return reply.status(409).send({ error: { code: 'REFERENCE_ERROR', message: 'Referência inválida ou em uso.' } });
  }
  if (pg === PG_ERROR.INSUFFICIENT_PRIVILEGE) {
    request.log.error({ err: error }, 'violação de política de acesso no banco');
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } });
  }

  request.log.error({ err: error }, 'erro não tratado');
  return reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro inesperado. Nossa equipe foi notificada.' },
  });
}
