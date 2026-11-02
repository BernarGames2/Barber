import { z } from 'zod';
import { instantSchema, localDateSchema, localTimeSchema, nameSchema, optionalText, phoneSchema, uuidSchema } from './common';

export const APPOINTMENT_STATUSES = ['HELD', 'PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_SOURCES = ['DASHBOARD', 'AI_PHONE', 'AI_WHATSAPP', 'ONLINE', 'WALK_IN', 'IMPORT'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

const serviceIdsSchema = z
  .union([z.array(uuidSchema), uuidSchema.transform((v) => [v])])
  .pipe(z.array(uuidSchema).min(1, 'Escolha ao menos um serviço').max(5, 'No máximo 5 serviços por agendamento'));

export const availabilityQuerySchema = z
  .object({
    serviceIds: z
      .union([z.string(), z.array(z.string())])
      .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
      .pipe(z.array(uuidSchema).min(1, 'Escolha ao menos um serviço').max(5)),
    professionalId: uuidSchema.optional(),
    from: localDateSchema,
    to: localDateSchema,
    timeFrom: localTimeSchema.optional(),
    timeTo: localTimeSchema.optional(),
  })
  .refine((v) => v.from <= v.to, { message: 'Período inválido', path: ['to'] });

const newCustomerSchema = z.object({ name: nameSchema('Nome do cliente', 120), phone: phoneSchema.nullish() });

export const createAppointmentSchema = z
  .object({
    customerId: uuidSchema.optional(),
    newCustomer: newCustomerSchema.optional(),
    /** Omitido = qualquer profissional disponível. */
    professionalId: uuidSchema.optional(),
    serviceIds: serviceIdsSchema,
    startsAt: instantSchema,
    notes: optionalText(1000),
    source: z.enum(['DASHBOARD', 'WALK_IN']).default('DASHBOARD'),
    /** Encaixe deliberado: permite sobrepor outro atendimento. */
    isOverbook: z.boolean().default(false),
    /** Gestor autoriza fora da jornada/horário de funcionamento. */
    allowOutsideHours: z.boolean().default(false),
    /** Registro retroativo (ex.: atendimento já realizado sem agendamento). */
    allowPast: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.customerId) !== Boolean(v.newCustomer), {
    message: 'Informe um cliente existente ou os dados de um novo cliente',
    path: ['customerId'],
  });
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const cancelAppointmentSchema = z.object({
  reason: optionalText(300),
  cancelledBy: z.enum(['CUSTOMER', 'STAFF']).default('STAFF'),
});

export const rescheduleAppointmentSchema = z.object({
  startsAt: instantSchema,
  professionalId: uuidSchema.optional(),
  isOverbook: z.boolean().default(false),
  allowOutsideHours: z.boolean().default(false),
});

export const appointmentStatusUpdateSchema = z.object({
  status: z.enum(['CONFIRMED', 'COMPLETED', 'NO_SHOW']),
});

export const appointmentListQuerySchema = z
  .object({
    from: localDateSchema,
    to: localDateSchema,
    professionalId: uuidSchema.optional(),
    customerId: uuidSchema.optional(),
    includeCancelled: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .default(false),
  })
  .refine((v) => v.from <= v.to, { message: 'Período inválido', path: ['to'] });

export interface AppointmentItemDto {
  serviceId: string;
  serviceName: string;
  durationMin: number;
  priceCents: number | null;
  priceType: 'FIXED' | 'STARTING_AT' | 'ON_REQUEST';
}

export interface AppointmentDto {
  id: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  blockedUntil: string;
  totalDurationMin: number;
  totalPriceCents: number | null;
  priceIsEstimate: boolean;
  source: AppointmentSource;
  isOverbook: boolean;
  notes: string | null;
  customer: { id: string; name: string; phone: string | null };
  professional: { id: string; name: string; color: string | null };
  items: AppointmentItemDto[];
  cancelledAt: string | null;
  cancelReason: string | null;
  rescheduledFromId: string | null;
  createdAt: string;
}

export interface AvailabilitySlotDto {
  start: string;
  end: string;
  /** Profissionais livres neste horário (ordem de preferência para distribuição). */
  professionalIds: string[];
}

export interface AvailabilityResponse {
  timezone: string;
  durationByProfessional: Record<string, number>;
  slots: AvailabilitySlotDto[];
}
