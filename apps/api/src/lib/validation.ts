import type { z } from 'zod';
import { Errors, zodDetails } from './errors';

/** Valida a entrada com um schema Zod e lança erro 400 padronizado. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw Errors.validation(zodDetails(result.error));
  return result.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida parâmetros de rota do tipo UUID; inválido = 404 (não revela formato interno). */
export function uuidParam(value: unknown, what = 'Recurso'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw Errors.notFound(what);
  return value.toLowerCase();
}
