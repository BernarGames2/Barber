import { validateWeeklyIntervals } from '@barber-voice/core';
import { z } from 'zod';
import {
  instantSchema,
  nameSchema,
  optionalEmailSchema,
  optionalPhoneSchema,
  optionalText,
  phoneSchema,
  timezoneSchema,
  weeklyIntervalSchema,
} from './common';

export const BUSINESS_CATEGORIES = [
  'BARBERSHOP',
  'BEAUTY_SALON',
  'UNISEX_SALON',
  'HAIR_STUDIO',
  'CURLY_HAIR_STUDIO',
  'BRAIDS_STUDIO',
  'COLOR_STUDIO',
  'AESTHETICS',
  'OTHER',
] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];

export const businessCategorySchema = z.enum(BUSINESS_CATEGORIES, { error: 'Categoria inválida' });

const UF = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;
export const BRAZIL_STATES = UF;

const addressFields = {
  addressStreet: optionalText(160),
  addressNumber: optionalText(20),
  addressComplement: optionalText(80),
  addressDistrict: optionalText(80),
  addressCity: optionalText(80),
  addressState: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || (UF as readonly string[]).includes(v), 'UF inválida')
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  addressPostalCode: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || v.length === 8, 'CEP deve ter 8 dígitos')
    .transform((v) => (v === '' ? null : `${v.slice(0, 5)}-${v.slice(5)}`))
    .nullish(),
};

export const createTenantSchema = z.object({
  name: nameSchema('Nome do estabelecimento', 120),
  category: businessCategorySchema,
  responsibleName: nameSchema('Nome do responsável', 120),
  phone: phoneSchema,
  whatsappNumber: optionalPhoneSchema,
  email: optionalEmailSchema,
  timezone: timezoneSchema.default('America/Sao_Paulo'),
  ...addressFields,
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z
  .object({
    name: nameSchema('Nome do estabelecimento', 120),
    category: businessCategorySchema,
    responsibleName: nameSchema('Nome do responsável', 120),
    phone: phoneSchema,
    whatsappNumber: optionalPhoneSchema,
    email: optionalEmailSchema,
    legalName: optionalText(160),
    document: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v === '' || v.length === 11 || v.length === 14, 'CPF (11) ou CNPJ (14 dígitos)')
      .transform((v) => (v === '' ? null : v))
      .nullish(),
    timezone: timezoneSchema,
    slotIntervalMin: z.number().int().refine((v) => [5, 10, 15, 20, 30, 45, 60].includes(v), 'Intervalo de grade inválido'),
    minBookingNoticeMin: z.number().int().min(0).max(10080),
    maxBookingDaysAhead: z.number().int().min(1).max(365),
    cancellationMinNoticeMin: z.number().int().min(0).max(10080),
    ...addressFields,
  })
  .partial();
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const weeklyScheduleSchema = z
  .array(weeklyIntervalSchema)
  .max(70)
  .superRefine((list, ctx) => {
    const err = validateWeeklyIntervals(list as Parameters<typeof validateWeeklyIntervals>[0]);
    if (err) ctx.addIssue({ code: 'custom', message: err });
  });

export const businessHoursInputSchema = z.object({ intervals: weeklyScheduleSchema });

export const CLOSURE_KINDS = ['HOLIDAY', 'CLOSURE', 'EVENT', 'OTHER'] as const;

export const closureInputSchema = z
  .object({
    kind: z.enum(CLOSURE_KINDS).default('CLOSURE'),
    title: nameSchema('Título', 120),
    startsAt: instantSchema,
    endsAt: instantSchema,
    allDay: z.boolean().default(true),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: 'O fim deve ser depois do início', path: ['endsAt'] });

export const ONBOARDING_STEPS = ['business', 'hours', 'services', 'professionals', 'channels', 'receptionist', 'review'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface TenantDto {
  id: string;
  slug: string;
  name: string;
  category: BusinessCategory;
  status: 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  responsibleName: string | null;
  legalName: string | null;
  document: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressDistrict: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostalCode: string | null;
  timezone: string;
  slotIntervalMin: number;
  minBookingNoticeMin: number;
  maxBookingDaysAhead: number;
  cancellationMinNoticeMin: number;
  onboardingCompletedAt: string | null;
  aiEnabled: boolean;
  isDemo: boolean;
  createdAt: string;
}

export interface WeeklyIntervalDto {
  weekday: number;
  start: string;
  end: string;
}

export interface ClosureDto {
  id: string;
  kind: (typeof CLOSURE_KINDS)[number];
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}

export interface OnboardingStatusDto {
  steps: { key: OnboardingStep; done: boolean; required: boolean }[];
  canComplete: boolean;
  completedAt: string | null;
}
