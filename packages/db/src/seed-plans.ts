import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { type PlanFeatures, type PlanLimits, plans } from './schema';

interface PlanSeed {
  code: string;
  name: string;
  description: string;
  priceCents: number;
  trialDays: number;
  isPublic: boolean;
  sortOrder: number;
  limits: PlanLimits;
  features: PlanFeatures;
}

const ESSENTIAL: PlanFeatures = {
  voiceStudio: false,
  customPersonas: false,
  phoneChannel: true,
  whatsappChannel: true,
  copilot: false,
  reports: false,
  commercialIntelligence: false,
  multiUnit: false,
};

const PRO_FEATURES: PlanFeatures = {
  ...ESSENTIAL,
  voiceStudio: true,
  customPersonas: true,
  copilot: true,
  reports: true,
  commercialIntelligence: true,
};

/**
 * HIPÓTESES COMERCIAIS iniciais (ver PROJECT_STATUS.md → custos). Preços e franquias
 * devem ser validados com cotações reais de telefonia/IA antes da venda.
 * Todos os planos — inclusive gratuitos — têm franquias finitas.
 */
export const DEFAULT_PLANS: PlanSeed[] = [
  {
    code: 'TRIAL',
    name: 'Teste gratuito',
    description: 'Avaliação com franquia reduzida para conhecer a plataforma.',
    priceCents: 0,
    trialDays: 14,
    isPublic: false,
    sortOrder: 0,
    limits: { voiceMinutes: 30, aiMessages: 200, professionals: 3, units: 1, staffSeats: 2 },
    features: { ...ESSENTIAL, voiceStudio: true },
  },
  {
    code: 'FOUNDING_PARTNER',
    name: 'Founding Partner',
    description: 'Programa piloto: 30 dias gratuitos com implantação assistida e franquias definidas.',
    priceCents: 0,
    trialDays: 30,
    isPublic: false,
    sortOrder: 1,
    limits: { voiceMinutes: 400, aiMessages: 3000, professionals: 10, units: 1, staffSeats: 5 },
    features: PRO_FEATURES,
  },
  {
    code: 'START',
    name: 'Start',
    description: 'Recursos essenciais: atendimento automatizado conforme franquia, agenda e CRM básico.',
    priceCents: 14900,
    trialDays: 0,
    isPublic: true,
    sortOrder: 10,
    limits: { voiceMinutes: 200, aiMessages: 1500, professionals: 3, units: 1, staffSeats: 3 },
    features: ESSENTIAL,
  },
  {
    code: 'PRO',
    name: 'Pro',
    description: 'Voice Studio completo, relatórios, Copilot e inteligência comercial.',
    priceCents: 29900,
    trialDays: 0,
    isPublic: true,
    sortOrder: 20,
    limits: { voiceMinutes: 500, aiMessages: 5000, professionals: 10, units: 1, staffSeats: 10 },
    features: PRO_FEATURES,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'A partir de R$ 599/mês. Múltiplas unidades, gestão ampliada e suporte conforme contrato.',
    priceCents: 59900,
    trialDays: 0,
    isPublic: true,
    sortOrder: 30,
    limits: { voiceMinutes: 1500, aiMessages: 15000, professionals: 50, units: 10, staffSeats: 50 },
    features: { ...PRO_FEATURES, multiUnit: true },
  },
];

/** Insere/atualiza os planos padrão (idempotente). Requer conexão administrativa. */
export async function seedPlans(db: Database): Promise<void> {
  for (const p of DEFAULT_PLANS) {
    await db
      .insert(plans)
      .values(p)
      .onConflictDoUpdate({
        target: plans.code,
        set: {
          name: p.name,
          description: p.description,
          priceCents: p.priceCents,
          trialDays: p.trialDays,
          isPublic: p.isPublic,
          sortOrder: p.sortOrder,
          limits: p.limits,
          features: p.features,
          updatedAt: sql`now()`,
        },
      });
  }
}
