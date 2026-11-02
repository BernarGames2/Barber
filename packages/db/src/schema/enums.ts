import { pgEnum } from 'drizzle-orm/pg-core';

export const platformRoleEnum = pgEnum('platform_role', ['SUPERADMIN', 'SUPPORT']);

export const authTokenTypeEnum = pgEnum('auth_token_type', ['EMAIL_VERIFICATION', 'PASSWORD_RESET']);

export const businessCategoryEnum = pgEnum('business_category', [
  'BARBERSHOP',
  'BEAUTY_SALON',
  'UNISEX_SALON',
  'HAIR_STUDIO',
  'CURLY_HAIR_STUDIO',
  'BRAIDS_STUDIO',
  'COLOR_STUDIO',
  'AESTHETICS',
  'OTHER',
]);

export const tenantStatusEnum = pgEnum('tenant_status', ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED']);

export const memberRoleEnum = pgEnum('member_role', ['OWNER', 'MANAGER', 'STAFF']);

export const membershipStatusEnum = pgEnum('membership_status', ['ACTIVE', 'DISABLED']);

export const priceTypeEnum = pgEnum('price_type', ['FIXED', 'STARTING_AT', 'ON_REQUEST']);

export const closureKindEnum = pgEnum('closure_kind', ['HOLIDAY', 'CLOSURE', 'EVENT', 'OTHER']);

export const timeOffKindEnum = pgEnum('time_off_kind', ['DAY_OFF', 'VACATION', 'BLOCK', 'SICK_LEAVE', 'OTHER']);

export const customerSourceEnum = pgEnum('customer_source', [
  'DASHBOARD',
  'PHONE',
  'WHATSAPP',
  'WALK_IN',
  'IMPORT',
  'ONLINE',
]);

export const consentPurposeEnum = pgEnum('consent_purpose', [
  'WHATSAPP_TRANSACTIONAL',
  'WHATSAPP_MARKETING',
  'CALL_RECORDING',
  'DATA_PROCESSING',
]);

/**
 * HELD       — reserva temporária durante a conversa (expira em `hold_expires_at`)
 * PENDING    — aguardando confirmação do estabelecimento/cliente
 * CONFIRMED  — confirmado
 * COMPLETED  — atendimento realizado (entra no faturamento registrado)
 * CANCELLED  — cancelado
 * NO_SHOW    — cliente não compareceu (libera o horário para encaixe)
 * EXPIRED    — reserva temporária expirada
 */
export const appointmentStatusEnum = pgEnum('appointment_status', [
  'HELD',
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
]);

/** Status que ocupam a agenda (protegidos pela exclusion constraint). */
export const BLOCKING_APPOINTMENT_STATUSES = ['HELD', 'PENDING', 'CONFIRMED', 'COMPLETED'] as const;

export const appointmentSourceEnum = pgEnum('appointment_source', [
  'DASHBOARD',
  'AI_PHONE',
  'AI_WHATSAPP',
  'ONLINE',
  'WALK_IN',
  'IMPORT',
]);

export const cancelledByEnum = pgEnum('cancelled_by', ['CUSTOMER', 'STAFF', 'AI', 'SYSTEM']);

export const waitlistStatusEnum = pgEnum('waitlist_status', ['WAITING', 'OFFERED', 'BOOKED', 'CANCELLED', 'EXPIRED']);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
]);
