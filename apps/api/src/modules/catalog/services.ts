import type { ServiceDto, ServiceInput } from '@barber-voice/contracts';
import { PG_ERROR, pgConstraintName, pgErrorCode, services, withTenant } from '@barber-voice/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { serviceUpdateSchema } from '@barber-voice/contracts';
import type { ServiceContext } from '../../context';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';

type ServiceRow = typeof services.$inferSelect;

export const toServiceDto = (s: ServiceRow): ServiceDto => ({
  id: s.id,
  name: s.name,
  description: s.description,
  category: s.category,
  durationMin: s.durationMin,
  bufferAfterMin: s.bufferAfterMin,
  priceType: s.priceType,
  priceCents: s.priceCents,
  active: s.active,
  bookableByAi: s.bookableByAi,
  color: s.color,
  sortOrder: s.sortOrder,
});

function mapWriteError(err: unknown): never {
  const code = pgErrorCode(err);
  if (code === PG_ERROR.UNIQUE_VIOLATION && pgConstraintName(err) === 'services_tenant_name_key') {
    throw Errors.conflict('SERVICE_NAME_EXISTS', 'Já existe um serviço com este nome.');
  }
  if (code === PG_ERROR.CHECK_VIOLATION) {
    throw Errors.unprocessable(
      'INVALID_SERVICE',
      'Dados do serviço inconsistentes (verifique preço e duração).',
    );
  }
  throw err;
}

export async function listServices(ctx: ServiceContext, includeInactive = true): Promise<ServiceDto[]> {
  const rows = await withTenant(ctx.deps.db, ctx.tenant.id, (tx) =>
    tx
      .select()
      .from(services)
      .where(and(isNull(services.archivedAt), includeInactive ? undefined : eq(services.active, true)))
      .orderBy(asc(services.sortOrder), asc(services.name)),
  );
  return rows.map(toServiceDto);
}

export async function createService(ctx: ServiceContext, input: ServiceInput): Promise<ServiceDto> {
  try {
    return await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
      const [s] = await tx
        .insert(services)
        .values({
          tenantId: ctx.tenant.id,
          name: input.name,
          description: input.description ?? null,
          category: input.category ?? null,
          durationMin: input.durationMin,
          bufferAfterMin: input.bufferAfterMin,
          priceType: input.priceType,
          priceCents: input.priceType === 'ON_REQUEST' ? (input.priceCents ?? null) : input.priceCents!,
          active: input.active,
          bookableByAi: input.bookableByAi,
          color: input.color ?? null,
          sortOrder: input.sortOrder,
        })
        .returning();
      await audit(tx, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.actor.userId,
        action: 'service.created',
        entityType: 'service',
        entityId: s!.id,
        metadata: { name: s!.name, priceCents: s!.priceCents, durationMin: s!.durationMin },
        ...ctx.meta,
      });
      return toServiceDto(s!);
    });
  } catch (err) {
    mapWriteError(err);
  }
}

export async function updateService(
  ctx: ServiceContext,
  serviceId: string,
  input: z.output<typeof serviceUpdateSchema>,
): Promise<ServiceDto> {
  const fields = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  try {
    return await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
      const [before] = await tx
        .select()
        .from(services)
        .where(and(eq(services.id, serviceId), isNull(services.archivedAt)))
        .limit(1);
      if (!before) throw Errors.notFound('Serviço');
      if (Object.keys(fields).length === 0) return toServiceDto(before);
      const [s] = await tx.update(services).set(fields).where(eq(services.id, serviceId)).returning();
      await audit(tx, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.actor.userId,
        action: 'service.updated',
        entityType: 'service',
        entityId: serviceId,
        metadata: {
          fields: Object.keys(fields),
          ...(fields.priceCents !== undefined
            ? { priceFrom: before.priceCents, priceTo: s!.priceCents }
            : {}),
        },
        ...ctx.meta,
      });
      return toServiceDto(s!);
    });
  } catch (err) {
    mapWriteError(err);
  }
}

/** Arquiva (não apaga): o histórico de agendamentos continua referenciando o serviço. */
export async function archiveService(ctx: ServiceContext, serviceId: string): Promise<void> {
  await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [s] = await tx
      .update(services)
      .set({ archivedAt: ctx.deps.clock(), active: false })
      .where(and(eq(services.id, serviceId), isNull(services.archivedAt)))
      .returning({ id: services.id });
    if (!s) throw Errors.notFound('Serviço');
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'service.archived',
      entityType: 'service',
      entityId: serviceId,
      ...ctx.meta,
    });
  });
}
