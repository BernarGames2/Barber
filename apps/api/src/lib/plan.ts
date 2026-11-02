import {
  type Database,
  type PlanFeatures,
  type PlanLimits,
  plans,
  subscriptions,
  tenants,
} from '@barber-voice/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AppError } from './errors';

export interface TenantPlan {
  code: string;
  name: string;
  features: PlanFeatures;
  limits: PlanLimits;
}

/** Plano vigente da organização do estabelecimento (teste, ativo ou em atraso). */
export async function getTenantPlan(db: Database, tenantId: string): Promise<TenantPlan | null> {
  const [row] = await db
    .select({ code: plans.code, name: plans.name, features: plans.features, limits: plans.limits })
    .from(tenants)
    .innerJoin(subscriptions, eq(subscriptions.organizationId, tenants.organizationId))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(tenants.id, tenantId), inArray(subscriptions.status, ['TRIALING', 'ACTIVE', 'PAST_DUE'])))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return row ?? null;
}

export function planFeatureRequired(feature: string): AppError {
  return new AppError(403, 'PLAN_FEATURE_REQUIRED', `Recurso disponível em um plano superior (${feature}).`, {
    feature,
  });
}
