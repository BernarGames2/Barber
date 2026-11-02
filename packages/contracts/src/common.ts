import { isValidLocalDate, isValidTimeZone, normalizePhone, timeToMinutes } from '@barber-voice/core';
import { z } from 'zod';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'ID inválido');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'E-mail muito longo')
  .refine((v) => EMAIL_RE.test(v), 'E-mail inválido');

export const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v === '' || EMAIL_RE.test(v), 'E-mail inválido')
  .transform((v) => (v === '' ? null : v))
  .nullish();

export const nameSchema = (label = 'Nome', max = 120) =>
  z.string().trim().min(2, `${label} deve ter pelo menos 2 caracteres`).max(max, `${label} muito longo`);

export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .transform((v) => (v === '' ? null : v))
    .nullish();

/** Telefone obrigatório, normalizado para E.164 (padrão Brasil). */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido. Inclua o DDD.' });
      return z.NEVER;
    }
    return n;
  });

/** Telefone opcional: vazio vira null. */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return null;
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido. Inclua o DDD.' });
      return z.NEVER;
    }
    return n;
  })
  .nullish();

export const localDateSchema = z.string().refine(isValidLocalDate, 'Data inválida (use AAAA-MM-DD)');

export const localTimeSchema = z.string().refine((v) => {
  try {
    timeToMinutes(v);
    return /^\d{2}:\d{2}$/.test(v);
  } catch {
    return false;
  }
}, 'Horário inválido (use HH:mm)');

export const timezoneSchema = z.string().refine(isValidTimeZone, 'Fuso horário inválido');

/** Instante ISO 8601 com fuso (ex.: 2026-11-06T15:00:00-03:00). */
export const instantSchema = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v)), {
    message: 'Data/hora inválida (ISO 8601 com fuso)',
  });

export const centsSchema = z.number().int('Valor em centavos deve ser inteiro').min(0).max(100_000_000);

export const weekdaySchema = z.number().int().min(1).max(7);

export const weeklyIntervalSchema = z
  .object({ weekday: weekdaySchema, start: localTimeSchema, end: localTimeSchema })
  .refine((v) => timeToMinutes(v.end) > timeToMinutes(v.start), {
    message: 'O horário final deve ser maior que o inicial',
    path: ['end'],
  });

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
}
