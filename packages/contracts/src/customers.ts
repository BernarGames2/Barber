import { z } from 'zod';
import {
  localDateSchema,
  nameSchema,
  optionalEmailSchema,
  optionalPhoneSchema,
  optionalText,
  uuidSchema,
} from './common';

export const customerInputSchema = z.object({
  name: nameSchema('Nome', 120),
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  birthDate: localDateSchema.nullish(),
  notes: optionalText(2000),
  preferences: z
    .object({ style: optionalText(300), other: optionalText(300) })
    .partial()
    .default({}),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  preferredProfessionalId: uuidSchema.nullish(),
});
export type CustomerInput = z.infer<typeof customerInputSchema>;

export const customerUpdateSchema = z
  .object({
    name: nameSchema('Nome', 120),
    phone: optionalPhoneSchema,
    email: optionalEmailSchema,
    birthDate: localDateSchema.nullable(),
    notes: optionalText(2000),
    preferences: z.object({ style: optionalText(300), other: optionalText(300) }).partial(),
    tags: z.array(z.string().trim().min(1).max(30)).max(20),
    preferredProfessionalId: uuidSchema.nullable(),
  })
  .partial();

export const customerListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const CONSENT_PURPOSES = [
  'WHATSAPP_TRANSACTIONAL',
  'WHATSAPP_MARKETING',
  'CALL_RECORDING',
  'DATA_PROCESSING',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const consentInputSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean(),
  channel: z.enum(['IN_PERSON', 'PHONE', 'WHATSAPP', 'FORM', 'OTHER']),
  evidence: optionalText(500),
});

export interface CustomerDto {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  notes: string | null;
  preferences: { style?: string | null; other?: string | null };
  tags: string[];
  source: string;
  preferredProfessionalId: string | null;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
  visitsCount: number;
  noShowCount: number;
  cancellationCount: number;
  createdAt: string;
}

export interface ConsentStateDto {
  purpose: ConsentPurpose;
  granted: boolean;
  channel: string;
  recordedAt: string;
}
