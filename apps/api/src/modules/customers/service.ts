import type { ConsentStateDto, CustomerDto, CustomerInput } from '@barber-voice/contracts';
import { customerUpdateSchema } from '@barber-voice/contracts';
import {
  BLOCKING_APPOINTMENT_STATUSES,
  PG_ERROR,
  type Tx,
  appointments,
  consents,
  customers,
  pgConstraintName,
  pgErrorCode,
  professionals,
  withTenant,
} from '@barber-voice/db';
import { and, count, desc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ServiceContext } from '../../context';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { iso } from '../../lib/serialize';
import { loadAppointmentDtos } from '../appointments/queries';

type CustomerRow = typeof customers.$inferSelect;

export const toCustomerDto = (c: CustomerRow): CustomerDto => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  birthDate: c.birthDate,
  notes: c.notes,
  preferences: c.preferences ?? {},
  tags: c.tags ?? [],
  source: c.source,
  preferredProfessionalId: c.preferredProfessionalId,
  firstVisitAt: iso(c.firstVisitAt),
  lastVisitAt: iso(c.lastVisitAt),
  visitsCount: c.visitsCount,
  noShowCount: c.noShowCount,
  cancellationCount: c.cancellationCount,
  createdAt: c.createdAt.toISOString(),
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function phoneConflict(err: unknown): boolean {
  return (
    pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION && pgConstraintName(err) === 'customers_tenant_phone_key'
  );
}

async function existingByPhone(tx: Tx, phone: string) {
  const [c] = await tx
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.phone, phone), isNull(customers.anonymizedAt)))
    .limit(1);
  return c ?? null;
}

async function assertProfessional(tx: Tx, id: string | null | undefined) {
  if (!id) return;
  const [p] = await tx
    .select({ id: professionals.id })
    .from(professionals)
    .where(eq(professionals.id, id))
    .limit(1);
  if (!p) throw Errors.unprocessable('INVALID_PROFESSIONAL', 'Profissional preferido inválido.');
}

export async function listCustomers(
  ctx: ServiceContext,
  query: { q?: string | undefined; limit: number; offset: number },
) {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const q = query.q?.trim();
    const digits = q?.replace(/\D/g, '') ?? '';
    const filter = and(
      isNull(customers.anonymizedAt),
      q
        ? digits.length >= 4
          ? or(ilike(customers.phone, `%${digits}%`), ilike(customers.name, `%${escapeLike(q)}%`))
          : ilike(customers.name, `%${escapeLike(q)}%`)
        : undefined,
    );
    const [total] = await tx.select({ n: count() }).from(customers).where(filter);
    const rows = await tx
      .select()
      .from(customers)
      .where(filter)
      .orderBy(desc(sql`COALESCE(${customers.lastVisitAt}, ${customers.createdAt})`))
      .limit(query.limit)
      .offset(query.offset);
    return { customers: rows.map(toCustomerDto), total: total?.n ?? 0 };
  });
}

async function currentConsents(tx: Tx, customerId: string): Promise<ConsentStateDto[]> {
  const rows = await tx
    .selectDistinctOn([consents.purpose], {
      purpose: consents.purpose,
      granted: consents.granted,
      channel: consents.channel,
      createdAt: consents.createdAt,
    })
    .from(consents)
    .where(eq(consents.customerId, customerId))
    .orderBy(consents.purpose, desc(consents.createdAt));
  return rows.map((r) => ({
    purpose: r.purpose,
    granted: r.granted,
    channel: r.channel,
    recordedAt: r.createdAt.toISOString(),
  }));
}

export async function getCustomer(ctx: ServiceContext, customerId: string) {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!c || c.anonymizedAt) throw Errors.notFound('Cliente');
    const history = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.customerId, customerId))
      .orderBy(desc(appointments.startsAt))
      .limit(30);
    return {
      customer: toCustomerDto(c),
      appointments: await loadAppointmentDtos(
        tx,
        history.map((h) => h.id),
      ),
      consents: await currentConsents(tx, customerId),
    };
  });
}

export async function createCustomer(
  ctx: ServiceContext,
  input: CustomerInput,
  source: CustomerRow['source'] = 'DASHBOARD',
): Promise<CustomerDto> {
  try {
    return await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
      if (input.phone) {
        const dup = await existingByPhone(tx, input.phone);
        if (dup) {
          throw Errors.conflict(
            'CUSTOMER_PHONE_EXISTS',
            `Já existe um cliente com este telefone (${dup.name}).`,
            {
              customerId: dup.id,
            },
          );
        }
      }
      await assertProfessional(tx, input.preferredProfessionalId);
      const [c] = await tx
        .insert(customers)
        .values({
          tenantId: ctx.tenant.id,
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          birthDate: input.birthDate ?? null,
          notes: input.notes ?? null,
          preferences: input.preferences ?? {},
          tags: input.tags ?? [],
          source,
          preferredProfessionalId: input.preferredProfessionalId ?? null,
          createdAt: ctx.deps.clock(),
        })
        .returning();
      await audit(tx, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.actor.userId,
        actorType: ctx.actor.type,
        action: 'customer.created',
        entityType: 'customer',
        entityId: c!.id,
        ...ctx.meta,
      });
      return toCustomerDto(c!);
    });
  } catch (err) {
    if (phoneConflict(err))
      throw Errors.conflict('CUSTOMER_PHONE_EXISTS', 'Já existe um cliente com este telefone.');
    throw err;
  }
}

export async function updateCustomer(
  ctx: ServiceContext,
  customerId: string,
  input: z.output<typeof customerUpdateSchema>,
): Promise<CustomerDto> {
  const fields = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  try {
    return await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
      const [before] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
      if (!before || before.anonymizedAt) throw Errors.notFound('Cliente');
      if (input.preferredProfessionalId) await assertProfessional(tx, input.preferredProfessionalId);
      if (Object.keys(fields).length === 0) return toCustomerDto(before);
      const [c] = await tx.update(customers).set(fields).where(eq(customers.id, customerId)).returning();
      await audit(tx, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.actor.userId,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: customerId,
        metadata: { fields: Object.keys(fields) },
        ...ctx.meta,
      });
      return toCustomerDto(c!);
    });
  } catch (err) {
    if (phoneConflict(err))
      throw Errors.conflict('CUSTOMER_PHONE_EXISTS', 'Já existe um cliente com este telefone.');
    throw err;
  }
}

export async function recordConsent(
  ctx: ServiceContext,
  customerId: string,
  input: {
    purpose: ConsentStateDto['purpose'];
    granted: boolean;
    channel: string;
    evidence?: string | null | undefined;
  },
): Promise<ConsentStateDto[]> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [c] = await tx
      .select({ id: customers.id, anonymizedAt: customers.anonymizedAt })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (!c || c.anonymizedAt) throw Errors.notFound('Cliente');
    await tx.insert(consents).values({
      tenantId: ctx.tenant.id,
      customerId,
      purpose: input.purpose,
      granted: input.granted,
      channel: input.channel,
      evidence: input.evidence ?? null,
      recordedByUserId: ctx.actor.userId,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: input.granted ? 'consent.granted' : 'consent.revoked',
      entityType: 'customer',
      entityId: customerId,
      metadata: { purpose: input.purpose, channel: input.channel },
      ...ctx.meta,
    });
    return currentConsents(tx, customerId);
  });
}

/**
 * LGPD: remove dados pessoais do cliente mantendo métricas agregadas (contagens, valores)
 * e a integridade dos agendamentos históricos. Irreversível.
 */
export async function anonymizeCustomer(ctx: ServiceContext, customerId: string): Promise<void> {
  await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!c || c.anonymizedAt) throw Errors.notFound('Cliente');
    const [upcoming] = await tx
      .select({ n: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.customerId, customerId),
          inArray(appointments.status, [...BLOCKING_APPOINTMENT_STATUSES]),
          gt(appointments.startsAt, ctx.deps.clock()),
        ),
      );
    if ((upcoming?.n ?? 0) > 0) {
      throw Errors.conflict(
        'CUSTOMER_HAS_UPCOMING_APPOINTMENTS',
        'Cancele os agendamentos futuros do cliente antes de anonimizar.',
      );
    }
    await tx
      .update(customers)
      .set({
        name: 'Cliente anonimizado',
        phone: null,
        email: null,
        birthDate: null,
        notes: null,
        preferences: {},
        tags: [],
        anonymizedAt: ctx.deps.clock(),
      })
      .where(eq(customers.id, customerId));
    await tx.update(appointments).set({ notes: null }).where(eq(appointments.customerId, customerId));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'customer.anonymized',
      entityType: 'customer',
      entityId: customerId,
      ...ctx.meta,
    });
  });
}
