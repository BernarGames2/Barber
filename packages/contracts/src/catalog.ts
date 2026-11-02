import { z } from 'zod';
import {
  centsSchema,
  instantSchema,
  nameSchema,
  optionalEmailSchema,
  optionalPhoneSchema,
  optionalText,
  uuidSchema,
} from './common';
import { weeklyScheduleSchema } from './tenant';

export const PRICE_TYPES = ['FIXED', 'STARTING_AT', 'ON_REQUEST'] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')
  .nullish();

export const serviceInputSchema = z
  .object({
    name: nameSchema('Nome do serviço', 80),
    description: optionalText(500),
    category: optionalText(60),
    durationMin: z.number().int().min(5, 'Duração mínima de 5 minutos').max(720, 'Duração máxima de 12 horas'),
    bufferAfterMin: z.number().int().min(0).max(240).default(0),
    priceType: z.enum(PRICE_TYPES).default('FIXED'),
    priceCents: centsSchema.nullish(),
    active: z.boolean().default(true),
    bookableByAi: z.boolean().default(true),
    color: colorSchema,
    sortOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .superRefine((v, ctx) => {
    if (v.priceType !== 'ON_REQUEST' && (v.priceCents === null || v.priceCents === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Informe o preço (ou marque como "sob consulta")', path: ['priceCents'] });
    }
  });
export type ServiceInput = z.infer<typeof serviceInputSchema>;

export const serviceUpdateSchema = z
  .object({
    name: nameSchema('Nome do serviço', 80),
    description: optionalText(500),
    category: optionalText(60),
    durationMin: z.number().int().min(5).max(720),
    bufferAfterMin: z.number().int().min(0).max(240),
    priceType: z.enum(PRICE_TYPES),
    priceCents: centsSchema.nullable(),
    active: z.boolean(),
    bookableByAi: z.boolean(),
    color: colorSchema,
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial();

export const professionalInputSchema = z.object({
  name: nameSchema('Nome', 80),
  bio: optionalText(500),
  email: optionalEmailSchema,
  phone: optionalPhoneSchema,
  color: colorSchema,
  active: z.boolean().default(true),
  bookableByAi: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  /** Serviços que realiza (ids). */
  serviceIds: z.array(uuidSchema).max(200).default([]),
  /** null = segue o horário de funcionamento. */
  workingHours: weeklyScheduleSchema.nullish(),
});
export type ProfessionalInput = z.infer<typeof professionalInputSchema>;

export const professionalUpdateSchema = z
  .object({
    name: nameSchema('Nome', 80),
    bio: optionalText(500),
    email: optionalEmailSchema,
    phone: optionalPhoneSchema,
    color: colorSchema,
    active: z.boolean(),
    bookableByAi: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial();

export const professionalScheduleSchema = z.object({
  /** null = segue o horário de funcionamento do estabelecimento. */
  workingHours: weeklyScheduleSchema.nullable(),
});

export const professionalServicesSchema = z.object({
  services: z
    .array(
      z.object({
        serviceId: uuidSchema,
        durationMin: z.number().int().min(5).max(720).nullish(),
        priceCents: centsSchema.nullish(),
      }),
    )
    .max(200),
});

export const TIME_OFF_KINDS = ['DAY_OFF', 'VACATION', 'BLOCK', 'SICK_LEAVE', 'OTHER'] as const;

export const timeOffInputSchema = z
  .object({
    professionalId: uuidSchema,
    kind: z.enum(TIME_OFF_KINDS).default('BLOCK'),
    reason: optionalText(200),
    startsAt: instantSchema,
    endsAt: instantSchema,
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: 'O fim deve ser depois do início', path: ['endsAt'] });

export interface ServiceDto {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  durationMin: number;
  bufferAfterMin: number;
  priceType: PriceType;
  priceCents: number | null;
  active: boolean;
  bookableByAi: boolean;
  color: string | null;
  sortOrder: number;
}

export interface ProfessionalDto {
  id: string;
  name: string;
  bio: string | null;
  email: string | null;
  phone: string | null;
  color: string | null;
  active: boolean;
  bookableByAi: boolean;
  sortOrder: number;
  usesBusinessHours: boolean;
  workingHours: { weekday: number; start: string; end: string }[] | null;
  services: { serviceId: string; durationMin: number | null; priceCents: number | null }[];
}

export interface TimeOffDto {
  id: string;
  professionalId: string;
  kind: (typeof TIME_OFF_KINDS)[number];
  reason: string | null;
  startsAt: string;
  endsAt: string;
}
