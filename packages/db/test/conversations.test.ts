import { uuidv7 } from '@barber-voice/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, PG_ERROR, createDb, pgErrorCode, withTenant } from '../src/client';
import {
  conversationLlmTurns,
  conversationMessages,
  conversations,
  customers,
  organizations,
  tenants,
} from '../src/schema';
import { testDatabaseUrls } from '../src/testing';

let admin: DbHandle;
let app: DbHandle;
let tenantA: string;
let tenantB: string;

async function tenant(name: string) {
  const [org] = await admin.db.insert(organizations).values({ name }).returning();
  const [t] = await admin.db
    .insert(tenants)
    .values({ organizationId: org!.id, slug: `${name}-${uuidv7().slice(-8)}`, name, category: 'BARBERSHOP' })
    .returning();
  return t!.id;
}

const expectPgError = async (fn: () => Promise<unknown>, code: string) => {
  try {
    await fn();
    throw new Error('deveria falhar');
  } catch (err) {
    expect(pgErrorCode(err)).toBe(code);
  }
};

beforeAll(async () => {
  const urls = testDatabaseUrls();
  admin = createDb(urls.adminUrl, { max: 2 });
  app = createDb(urls.appUrl, { max: 5 });
  tenantA = await tenant('conv-alfa');
  tenantB = await tenant('conv-beta');
});
afterAll(async () => {
  await app?.close();
  await admin?.close();
});

describe('conversas no banco', () => {
  it('conversas, mensagens e histórico do modelo ficam isolados por estabelecimento', async () => {
    const conv = await withTenant(app.db, tenantA, async (tx) => {
      const [c] = await tx
        .insert(conversations)
        .values({ tenantId: tenantA, channel: 'WHATSAPP', contactPhone: '+5511987654321' })
        .returning();
      await tx
        .insert(conversationMessages)
        .values({ tenantId: tenantA, conversationId: c!.id, role: 'CUSTOMER', content: 'Oi' });
      await tx.insert(conversationLlmTurns).values({
        tenantId: tenantA,
        conversationId: c!.id,
        seq: 1,
        messages: [{ role: 'user', content: 'Oi' }],
      });
      return c!;
    });

    expect(await withTenant(app.db, tenantB, (tx) => tx.select().from(conversations))).toHaveLength(0);
    expect(await withTenant(app.db, tenantB, (tx) => tx.select().from(conversationMessages))).toHaveLength(0);
    expect(await withTenant(app.db, tenantB, (tx) => tx.select().from(conversationLlmTurns))).toHaveLength(0);

    // B não consegue pendurar mensagem na conversa de A (FK composta + RLS)
    await expectPgError(
      () =>
        withTenant(app.db, tenantB, (tx) =>
          tx
            .insert(conversationMessages)
            .values({ tenantId: tenantB, conversationId: conv.id, role: 'CUSTOMER', content: 'invasão' }),
        ),
      PG_ERROR.FOREIGN_KEY_VIOLATION,
    );
    await expectPgError(
      () =>
        withTenant(app.db, tenantB, (tx) =>
          tx
            .insert(conversationMessages)
            .values({ tenantId: tenantA, conversationId: conv.id, role: 'CUSTOMER', content: 'invasão' }),
        ),
      PG_ERROR.INSUFFICIENT_PRIVILEGE,
    );
  });

  it('o histórico enviado ao modelo é somente-acréscimo', async () => {
    const turn = await withTenant(app.db, tenantA, async (tx) => {
      const [c] = await tx
        .insert(conversations)
        .values({ tenantId: tenantA, channel: 'WHATSAPP', isSimulation: true })
        .returning();
      const [t] = await tx
        .insert(conversationLlmTurns)
        .values({ tenantId: tenantA, conversationId: c!.id, seq: 1, messages: [] })
        .returning();
      return t!;
    });
    await expectPgError(
      () =>
        withTenant(app.db, tenantA, (tx) =>
          tx.update(conversationLlmTurns).set({ seq: 9 }).where(eq(conversationLlmTurns.id, turn.id)),
        ),
      PG_ERROR.INSUFFICIENT_PRIVILEGE,
    );
    // nem o papel dono edita (gatilho)
    await expectPgError(
      () => admin.db.update(conversationLlmTurns).set({ seq: 9 }).where(eq(conversationLlmTurns.id, turn.id)),
      PG_ERROR.INSUFFICIENT_PRIVILEGE,
    );
    // sequência duplicada é recusada (corrida entre duas rodadas)
    await expectPgError(
      () =>
        withTenant(app.db, tenantA, (tx) =>
          tx
            .insert(conversationLlmTurns)
            .values({ tenantId: tenantA, conversationId: turn.conversationId, seq: 1, messages: [] }),
        ),
      PG_ERROR.UNIQUE_VIOLATION,
    );
  });

  it('cliente da conversa precisa ser do mesmo estabelecimento; telefone em E.164', async () => {
    const [customerOfB] = await withTenant(app.db, tenantB, (tx) =>
      tx.insert(customers).values({ tenantId: tenantB, name: 'Cliente B' }).returning(),
    );
    await expectPgError(
      () =>
        withTenant(app.db, tenantA, (tx) =>
          tx
            .insert(conversations)
            .values({ tenantId: tenantA, channel: 'PHONE', customerId: customerOfB!.id }),
        ),
      PG_ERROR.FOREIGN_KEY_VIOLATION,
    );
    await expectPgError(
      () =>
        withTenant(app.db, tenantA, (tx) =>
          tx
            .insert(conversations)
            .values({ tenantId: tenantA, channel: 'PHONE', contactPhone: '11987654321' }),
        ),
      PG_ERROR.CHECK_VIOLATION,
    );
  });
});
