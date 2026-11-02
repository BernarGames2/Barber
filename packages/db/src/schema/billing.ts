import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, tz, updatedAt } from './_shared';
import { subscriptionStatusEnum } from './enums';
import { organizations } from './tenancy';

/**
 * Franquias de uso por período de cobrança. Limites existem em TODOS os planos —
 * inclusive testes gratuitos — para que custos de telefonia/IA nunca fiquem ilimitados.
 */
export interface PlanLimits {
  /** Minutos de ligação atendidos pela IA por mês. */
  voiceMinutes: number;
  /** Mensagens processadas pela IA (WhatsApp + simulador) por mês. */
  aiMessages: number;
  /** Profissionais ativos. */
  professionals: number;
  /** Unidades (estabelecimentos) por organização. */
  units: number;
  /** Membros da equipe com acesso ao painel. */
  staffSeats: number;
}

export interface PlanFeatures {
  voiceStudio: boolean;
  customPersonas: boolean;
  phoneChannel: boolean;
  whatsappChannel: boolean;
  copilot: boolean;
  reports: boolean;
  commercialIntelligence: boolean;
  multiUnit: boolean;
}

export const plans = pgTable(
  'plans',
  {
    id: pk(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Preço mensal em centavos (hipótese comercial, sujeita a validação). */
    priceCents: integer('price_cents').notNull(),
    billingInterval: text('billing_interval').notNull().default('month'),
    trialDays: integer('trial_days').notNull().default(0),
    limits: jsonb('limits').$type<PlanLimits>().notNull(),
    features: jsonb('features').$type<PlanFeatures>().notNull(),
    isPublic: boolean('is_public').notNull().default(true),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('plans_code_key').on(t.code)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: subscriptionStatusEnum('status').notNull(),
    trialEndsAt: timestamp('trial_ends_at', tz),
    currentPeriodStart: timestamp('current_period_start', tz).notNull(),
    currentPeriodEnd: timestamp('current_period_end', tz).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    cancelledAt: timestamp('cancelled_at', tz),
    /** Provedor de pagamento (Fase 6). Nulo enquanto não há cobrança configurada. */
    provider: text('provider'),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    isFoundingPartner: boolean('is_founding_partner').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('subscriptions_organization_idx').on(t.organizationId, t.status)],
);
