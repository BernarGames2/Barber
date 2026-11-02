import type {
  ClosureDto,
  CreateTenantInput,
  OnboardingStatusDto,
  TenantDto,
  UpdateTenantInput,
  WeeklyIntervalDto,
} from '@barber-voice/contracts';
import { uuidv7 } from '@barber-voice/core';
import {
  PG_ERROR,
  businessHours,
  closures,
  memberships,
  organizations,
  pgConstraintName,
  pgErrorCode,
  plans,
  professionalServices,
  professionals,
  services,
  subscriptions,
  tenants,
  withTenant,
} from '@barber-voice/db';
import { and, asc, count, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { AppDeps, AuthContext, ServiceContext } from '../../context';
import { audit } from '../../lib/audit';
import { randomToken } from '../../lib/crypto';
import { AppError, Errors } from '../../lib/errors';
import { hhmm, iso, slugify } from '../../lib/serialize';

const MAX_OWNED_TENANTS = 10;
const DAY_MS = 86_400_000;

type TenantRow = typeof tenants.$inferSelect;

export function toTenantDto(t: TenantRow): TenantDto {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    category: t.category,
    status: t.status,
    responsibleName: t.responsibleName,
    legalName: t.legalName,
    document: t.document,
    phone: t.phone,
    whatsappNumber: t.whatsappNumber,
    email: t.email,
    addressStreet: t.addressStreet,
    addressNumber: t.addressNumber,
    addressComplement: t.addressComplement,
    addressDistrict: t.addressDistrict,
    addressCity: t.addressCity,
    addressState: t.addressState,
    addressPostalCode: t.addressPostalCode,
    timezone: t.timezone,
    slotIntervalMin: t.slotIntervalMin,
    minBookingNoticeMin: t.minBookingNoticeMin,
    maxBookingDaysAhead: t.maxBookingDaysAhead,
    cancellationMinNoticeMin: t.cancellationMinNoticeMin,
    onboardingCompletedAt: iso(t.onboardingCompletedAt),
    aiEnabled: t.aiEnabled,
    isDemo: t.isDemo,
    createdAt: t.createdAt.toISOString(),
  };
}

export async function createTenant(
  deps: AppDeps,
  auth: AuthContext,
  input: CreateTenantInput,
  meta: { ip?: string; userAgent?: string },
): Promise<TenantDto> {
  const { db, clock } = deps;
  const [owned] = await db
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.userId, auth.userId), eq(memberships.role, 'OWNER')));
  if ((owned?.n ?? 0) >= MAX_OWNED_TENANTS) {
    throw Errors.unprocessable(
      'TENANT_LIMIT',
      'Limite de estabelecimentos por conta atingido. Fale com o suporte.',
    );
  }
  const [trial] = await db.select().from(plans).where(eq(plans.code, 'TRIAL')).limit(1);
  if (!trial) throw new Error('Plano TRIAL ausente: execute o seed de planos (pnpm db:seed).');

  const base = slugify(input.name) || 'estabelecimento';
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = `${base}-${
      randomToken(4)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 5) || 'x1'
    }`.replace(/^-/, '');
    const tenantId = uuidv7();
    try {
      return await withTenant(db, tenantId, async (tx) => {
        const now = clock();
        const [org] = await tx.insert(organizations).values({ name: input.name, createdAt: now }).returning();
        const [tenant] = await tx
          .insert(tenants)
          .values({
            id: tenantId,
            organizationId: org!.id,
            slug,
            name: input.name,
            category: input.category,
            responsibleName: input.responsibleName,
            phone: input.phone,
            whatsappNumber: input.whatsappNumber ?? null,
            email: input.email ?? null,
            timezone: input.timezone,
            addressStreet: input.addressStreet ?? null,
            addressNumber: input.addressNumber ?? null,
            addressComplement: input.addressComplement ?? null,
            addressDistrict: input.addressDistrict ?? null,
            addressCity: input.addressCity ?? null,
            addressState: input.addressState ?? null,
            addressPostalCode: input.addressPostalCode ?? null,
            onboardingStep: 'hours',
            createdAt: now,
          })
          .returning();
        await tx.insert(memberships).values({ tenantId, userId: auth.userId, role: 'OWNER', createdAt: now });
        const trialEnd = new Date(now.getTime() + trial.trialDays * DAY_MS);
        await tx.insert(subscriptions).values({
          organizationId: org!.id,
          planId: trial.id,
          status: 'TRIALING',
          trialEndsAt: trialEnd,
          currentPeriodStart: now,
          currentPeriodEnd: trialEnd,
        });
        await audit(tx, {
          tenantId,
          actorUserId: auth.userId,
          action: 'tenant.created',
          entityType: 'tenant',
          entityId: tenantId,
          metadata: { plan: 'TRIAL', category: input.category },
          ...meta,
        });
        return toTenantDto(tenant!);
      });
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION && pgConstraintName(err) === 'tenants_slug_key')
        continue;
      throw err;
    }
  }
  throw new AppError(
    500,
    'SLUG_GENERATION_FAILED',
    'Não foi possível criar o estabelecimento. Tente novamente.',
  );
}

export async function getTenant(ctx: ServiceContext): Promise<TenantDto> {
  const [t] = await ctx.deps.db.select().from(tenants).where(eq(tenants.id, ctx.tenant.id)).limit(1);
  if (!t) throw Errors.notFound('Estabelecimento');
  return toTenantDto(t);
}

export async function updateTenant(ctx: ServiceContext, input: UpdateTenantInput): Promise<TenantDto> {
  const fields = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(fields).length === 0) return getTenant(ctx);
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [t] = await tx.update(tenants).set(fields).where(eq(tenants.id, ctx.tenant.id)).returning();
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'tenant.updated',
      entityType: 'tenant',
      entityId: ctx.tenant.id,
      metadata: { fields: Object.keys(fields) },
      ...ctx.meta,
    });
    return toTenantDto(t!);
  });
}

export async function getBusinessHours(ctx: ServiceContext): Promise<WeeklyIntervalDto[]> {
  const rows = await withTenant(ctx.deps.db, ctx.tenant.id, (tx) =>
    tx.select().from(businessHours).orderBy(asc(businessHours.weekday), asc(businessHours.startTime)),
  );
  return rows.map((r) => ({ weekday: r.weekday, start: hhmm(r.startTime), end: hhmm(r.endTime) }));
}

export async function setBusinessHours(
  ctx: ServiceContext,
  intervals: WeeklyIntervalDto[],
): Promise<WeeklyIntervalDto[]> {
  await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    await tx.delete(businessHours).where(eq(businessHours.tenantId, ctx.tenant.id));
    if (intervals.length) {
      await tx.insert(businessHours).values(
        intervals.map((i) => ({
          tenantId: ctx.tenant.id,
          weekday: i.weekday,
          startTime: i.start,
          endTime: i.end,
        })),
      );
    }
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'business_hours.updated',
      metadata: { intervals: intervals.length },
      ...ctx.meta,
    });
  });
  return getBusinessHours(ctx);
}

type ClosureRow = typeof closures.$inferSelect;
const toClosureDto = (c: ClosureRow): ClosureDto => ({
  id: c.id,
  kind: c.kind,
  title: c.title,
  startsAt: c.startsAt.toISOString(),
  endsAt: c.endsAt.toISOString(),
  allDay: c.allDay,
});

export async function listClosures(ctx: ServiceContext, upcomingOnly = true): Promise<ClosureDto[]> {
  const now = ctx.deps.clock();
  const rows = await withTenant(ctx.deps.db, ctx.tenant.id, (tx) =>
    tx
      .select()
      .from(closures)
      .where(upcomingOnly ? gt(closures.endsAt, now) : undefined)
      .orderBy(asc(closures.startsAt))
      .limit(200),
  );
  return rows.map(toClosureDto);
}

export async function createClosure(
  ctx: ServiceContext,
  input: { kind: ClosureRow['kind']; title: string; startsAt: string; endsAt: string; allDay: boolean },
): Promise<ClosureDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [c] = await tx
      .insert(closures)
      .values({
        tenantId: ctx.tenant.id,
        kind: input.kind,
        title: input.title,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        allDay: input.allDay,
        createdByUserId: ctx.actor.userId,
      })
      .returning();
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'closure.created',
      entityType: 'closure',
      entityId: c!.id,
      ...ctx.meta,
    });
    return toClosureDto(c!);
  });
}

export async function deleteClosure(ctx: ServiceContext, closureId: string): Promise<void> {
  await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const deleted = await tx
      .delete(closures)
      .where(eq(closures.id, closureId))
      .returning({ id: closures.id });
    if (!deleted[0]) throw Errors.notFound('Fechamento');
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'closure.deleted',
      entityType: 'closure',
      entityId: closureId,
      ...ctx.meta,
    });
  });
}

export async function getOnboardingStatus(ctx: ServiceContext): Promise<OnboardingStatusDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenant.id)).limit(1);
    const [hours] = await tx.select({ n: count() }).from(businessHours);
    const [svc] = await tx
      .select({ n: count() })
      .from(services)
      .where(and(eq(services.active, true), isNull(services.archivedAt)));
    // profissionais ativos que realizam ao menos um serviço ativo
    const [prof] = await tx
      .select({ n: sql<number>`count(DISTINCT ${professionals.id})::int` })
      .from(professionals)
      .innerJoin(professionalServices, eq(professionalServices.professionalId, professionals.id))
      .innerJoin(services, eq(services.id, professionalServices.serviceId))
      .where(
        and(
          eq(professionals.active, true),
          isNull(professionals.archivedAt),
          eq(services.active, true),
          isNull(services.archivedAt),
        ),
      );
    const steps: OnboardingStatusDto['steps'] = [
      { key: 'business', done: Boolean(t?.name && t.phone), required: true },
      { key: 'hours', done: (hours?.n ?? 0) > 0, required: true },
      { key: 'services', done: (svc?.n ?? 0) > 0, required: true },
      { key: 'professionals', done: (prof?.n ?? 0) > 0, required: true },
      // Integrações de telefone/WhatsApp e recepcionista chegam nas Fases 3–4.
      { key: 'channels', done: false, required: false },
      { key: 'receptionist', done: false, required: false },
      { key: 'review', done: Boolean(t?.onboardingCompletedAt), required: false },
    ];
    return {
      steps,
      canComplete: steps.filter((s) => s.required).every((s) => s.done),
      completedAt: iso(t?.onboardingCompletedAt),
    };
  });
}

export async function completeOnboarding(ctx: ServiceContext): Promise<TenantDto> {
  const status = await getOnboardingStatus(ctx);
  if (!status.canComplete) {
    const missing = status.steps.filter((s) => s.required && !s.done).map((s) => s.key);
    throw Errors.unprocessable('ONBOARDING_INCOMPLETE', 'Ainda faltam etapas obrigatórias da configuração.', {
      missing,
    });
  }
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [t] = await tx
      .update(tenants)
      .set({
        onboardingCompletedAt: sql`COALESCE(${tenants.onboardingCompletedAt}, now())`,
        onboardingStep: 'review',
        status: sql`CASE WHEN ${tenants.status} = 'ONBOARDING' THEN 'ACTIVE'::tenant_status ELSE ${tenants.status} END`,
      })
      .where(eq(tenants.id, ctx.tenant.id))
      .returning();
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'onboarding.completed',
      ...ctx.meta,
    });
    return toTenantDto(t!);
  });
}

/** Faixa de fechamentos que intersectam [from, to). */
export function closuresOverlapping(from: Date, to: Date) {
  return and(lt(closures.startsAt, to), gt(closures.endsAt, from));
}
