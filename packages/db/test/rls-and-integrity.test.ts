import { uuidv7 } from '@barber-voice/core';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, PG_ERROR, createDb, pgErrorCode, withTenant } from '../src/client';
import {
  appointments,
  auditLogs,
  customers,
  organizations,
  plans,
  professionals,
  tenants,
} from '../src/schema';
import { testDatabaseUrls } from '../src/testing';

let admin: DbHandle;
let app: DbHandle;
let tenantA: string;
let tenantB: string;
let profA: string;
let custA: string;
let custB: string;

async function createTenant(name: string): Promise<string> {
  const [org] = await admin.db.insert(organizations).values({ name }).returning();
  const [t] = await admin.db
    .insert(tenants)
    .values({ organizationId: org!.id, slug: `${name.toLowerCase()}-${uuidv7().slice(-8)}`, name, category: 'BARBERSHOP' })
    .returning();
  return t!.id;
}

async function expectPgError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err) {
    expect(pgErrorCode(err)).toBe(code);
    return;
  }
  throw new Error(`Era esperado erro ${code}, mas a operação foi aceita`);
}

const T = (iso: string) => new Date(iso);

beforeAll(async () => {
  const urls = testDatabaseUrls();
  admin = createDb(urls.adminUrl, { max: 2 });
  app = createDb(urls.appUrl, { max: 25 });
  tenantA = await createTenant('Alfa');
  tenantB = await createTenant('Beta');

  profA = await withTenant(app.db, tenantA, async (tx) => {
    const [p] = await tx.insert(professionals).values({ tenantId: tenantA, name: 'João' }).returning();
    return p!.id;
  });
  custA = await withTenant(app.db, tenantA, async (tx) => {
    const [c] = await tx.insert(customers).values({ tenantId: tenantA, name: 'Cliente A', phone: '+5511911110000' }).returning();
    return c!.id;
  });
  custB = await withTenant(app.db, tenantB, async (tx) => {
    const [c] = await tx.insert(customers).values({ tenantId: tenantB, name: 'Cliente B', phone: '+5511922220000' }).returning();
    return c!.id;
  });
});

afterAll(async () => {
  await app?.close();
  await admin?.close();
});

describe('Row-Level Security (papel da aplicação)', () => {
  it('sem contexto de estabelecimento: nenhuma linha visível e escrita bloqueada', async () => {
    const rows = await app.db.select().from(customers);
    expect(rows).toHaveLength(0);
    await expectPgError(
      app.db.insert(customers).values({ tenantId: tenantA, name: 'Sem contexto' }),
      PG_ERROR.INSUFFICIENT_PRIVILEGE,
    );
  });

  it('cada estabelecimento enxerga apenas os próprios dados, mesmo filtrando pelo id do outro', async () => {
    const seenByA = await withTenant(app.db, tenantA, (tx) => tx.select().from(customers));
    expect(seenByA.map((c) => c.id)).toEqual([custA]);

    const peek = await withTenant(app.db, tenantA, (tx) =>
      tx.select().from(customers).where(eq(customers.id, custB)),
    );
    expect(peek).toHaveLength(0);
  });

  it('não permite gravar linha em nome de outro estabelecimento', async () => {
    await expectPgError(
      withTenant(app.db, tenantA, (tx) => tx.insert(customers).values({ tenantId: tenantB, name: 'Invasor' })),
      PG_ERROR.INSUFFICIENT_PRIVILEGE,
    );
  });

  it('UPDATE e DELETE em dados de outro estabelecimento não afetam nada', async () => {
    const updated = await withTenant(app.db, tenantA, (tx) =>
      tx.update(customers).set({ name: 'Hackeado' }).where(eq(customers.id, custB)).returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(app.db, tenantA, (tx) =>
      tx.delete(customers).where(eq(customers.id, custB)).returning(),
    );
    expect(deleted).toHaveLength(0);
    const stillThere = await admin.db.select().from(customers).where(eq(customers.id, custB));
    expect(stillThere[0]?.name).toBe('Cliente B');
  });

  it('o contexto não vaza entre transações na mesma conexão', async () => {
    const single = createDb(testDatabaseUrls().appUrl, { max: 1 });
    try {
      await withTenant(single.db, tenantA, (tx) => tx.select().from(customers));
      const after = await single.db.select().from(customers);
      expect(after).toHaveLength(0);
    } finally {
      await single.close();
    }
  });

  it('o papel dono (administrativo) não é afetado pelo RLS — uso restrito a rotinas de plataforma', async () => {
    const all = await admin.db.select().from(customers);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});

describe('integridade entre estabelecimentos (FKs compostas)', () => {
  it('um agendamento não pode referenciar cliente de outro estabelecimento', async () => {
    await expectPgError(
      withTenant(app.db, tenantA, (tx) =>
        tx.insert(appointments).values({
          tenantId: tenantA,
          customerId: custB,
          professionalId: profA,
          startsAt: T('2030-01-07T13:00:00Z'),
          endsAt: T('2030-01-07T13:30:00Z'),
          blockedUntil: T('2030-01-07T13:30:00Z'),
          totalDurationMin: 30,
          source: 'DASHBOARD',
        }),
      ),
      PG_ERROR.FOREIGN_KEY_VIOLATION,
    );
  });
});

describe('agenda: exclusion constraint anticonflito', () => {
  const base = () => ({
    tenantId: tenantA,
    customerId: custA,
    professionalId: profA,
    totalDurationMin: 30,
    source: 'DASHBOARD' as const,
  });

  it('bloqueia sobreposição, permite horários colados', async () => {
    await withTenant(app.db, tenantA, (tx) =>
      tx.insert(appointments).values({
        ...base(),
        startsAt: T('2030-01-08T13:00:00Z'),
        endsAt: T('2030-01-08T13:30:00Z'),
        blockedUntil: T('2030-01-08T13:40:00Z'),
      }),
    );
    // começa durante o buffer de limpeza do anterior
    await expectPgError(
      withTenant(app.db, tenantA, (tx) =>
        tx.insert(appointments).values({
          ...base(),
          startsAt: T('2030-01-08T13:35:00Z'),
          endsAt: T('2030-01-08T14:05:00Z'),
          blockedUntil: T('2030-01-08T14:05:00Z'),
        }),
      ),
      PG_ERROR.EXCLUSION_VIOLATION,
    );
    // colado ao fim do buffer: permitido
    await withTenant(app.db, tenantA, (tx) =>
      tx.insert(appointments).values({
        ...base(),
        startsAt: T('2030-01-08T13:40:00Z'),
        endsAt: T('2030-01-08T14:10:00Z'),
        blockedUntil: T('2030-01-08T14:10:00Z'),
      }),
    );
  });

  it('agendamentos cancelados, faltas e encaixes deliberados não bloqueiam', async () => {
    const slot = { startsAt: T('2030-01-09T13:00:00Z'), endsAt: T('2030-01-09T13:30:00Z'), blockedUntil: T('2030-01-09T13:30:00Z') };
    await withTenant(app.db, tenantA, async (tx) => {
      await tx.insert(appointments).values({ ...base(), ...slot, status: 'CANCELLED' });
      await tx.insert(appointments).values({ ...base(), ...slot, status: 'NO_SHOW' });
      await tx.insert(appointments).values({ ...base(), ...slot, status: 'CONFIRMED' });
      await tx.insert(appointments).values({ ...base(), ...slot, status: 'CONFIRMED', isOverbook: true });
    });
    const active = await withTenant(app.db, tenantA, (tx) =>
      tx
        .select()
        .from(appointments)
        .where(sql`${appointments.startsAt} = ${slot.startsAt.toISOString()}::timestamptz AND ${appointments.status} = 'CONFIRMED'`),
    );
    expect(active).toHaveLength(2);
  });

  it('reserva temporária (HELD) exige data de expiração', async () => {
    await expectPgError(
      withTenant(app.db, tenantA, (tx) =>
        tx.insert(appointments).values({
          ...base(),
          status: 'HELD',
          startsAt: T('2030-01-10T13:00:00Z'),
          endsAt: T('2030-01-10T13:30:00Z'),
          blockedUntil: T('2030-01-10T13:30:00Z'),
        }),
      ),
      PG_ERROR.CHECK_VIOLATION,
    );
  });

  it('CONCORRÊNCIA: 20 transações simultâneas pelo mesmo horário → exatamente 1 reserva', async () => {
    const attempts = Array.from({ length: 20 }, () =>
      withTenant(app.db, tenantA, (tx) =>
        tx
          .insert(appointments)
          .values({
            ...base(),
            startsAt: T('2030-01-11T13:00:00Z'),
            endsAt: T('2030-01-11T13:30:00Z'),
            blockedUntil: T('2030-01-11T13:30:00Z'),
          })
          .returning({ id: appointments.id }),
      ),
    );
    const results = await Promise.allSettled(attempts);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(19);
    for (const f of failed) expect(pgErrorCode(f.reason)).toBe(PG_ERROR.EXCLUSION_VIOLATION);
  });
});

describe('permissões do papel da aplicação', () => {
  it('auditoria é somente-inserção e isolada por estabelecimento', async () => {
    await withTenant(app.db, tenantA, (tx) =>
      tx.insert(auditLogs).values({ tenantId: tenantA, actorType: 'USER', action: 'test.created' }),
    );
    await withTenant(app.db, tenantB, (tx) =>
      tx.insert(auditLogs).values({ tenantId: tenantB, actorType: 'USER', action: 'test.created' }),
    );
    const seen = await withTenant(app.db, tenantA, (tx) => tx.select().from(auditLogs));
    expect(seen.every((l) => l.tenantId === tenantA)).toBe(true);

    await expectPgError(
      withTenant(app.db, tenantA, (tx) => tx.update(auditLogs).set({ action: 'adulterado' })),
      PG_ERROR.INSUFFICIENT_PRIVILEGE,
    );
    await expectPgError(
      withTenant(app.db, tenantA, (tx) => tx.delete(auditLogs)),
      PG_ERROR.INSUFFICIENT_PRIVILEGE,
    );
  });

  it('planos são somente-leitura e o controle de migrações é inacessível', async () => {
    const list = await app.db.select().from(plans);
    expect(list.map((p) => p.code)).toContain('PRO');
    await expectPgError(
      app.db.insert(plans).values({
        code: 'HACK',
        name: 'x',
        priceCents: 0,
        limits: { voiceMinutes: 1e9, aiMessages: 1e9, professionals: 1e9, units: 1e9, staffSeats: 1e9 },
        features: {
          voiceStudio: true,
          customPersonas: true,
          phoneChannel: true,
          whatsappChannel: true,
          copilot: true,
          reports: true,
          commercialIntelligence: true,
          multiUnit: true,
        },
      }),
      PG_ERROR.INSUFFICIENT_PRIVILEGE,
    );
    await expectPgError(app.pool.query('SELECT * FROM drizzle.__drizzle_migrations'), PG_ERROR.INSUFFICIENT_PRIVILEGE);
  });

  it('o papel da aplicação não tem BYPASSRLS nem é superusuário', async () => {
    const r = await app.pool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user',
    );
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });
});
