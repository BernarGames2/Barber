import { PERSONA_LIBRARY, uuidv7 } from '@barber-voice/core';
import { eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, PG_ERROR, createDb, pgErrorCode, withTenant } from '../src/client';
import { organizations, personas, receptionistConfigs, tenants } from '../src/schema';
import { seedPersonaLibrary } from '../src/seed-personas';
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

beforeAll(async () => {
  const urls = testDatabaseUrls();
  admin = createDb(urls.adminUrl, { max: 2 });
  app = createDb(urls.appUrl, { max: 5 });
  tenantA = await tenant('vs-alfa');
  tenantB = await tenant('vs-beta');
});
afterAll(async () => {
  await app?.close();
  await admin?.close();
});

describe('Voice Studio no banco', () => {
  it('a biblioteca foi semeada e é idempotente', async () => {
    const lib = await admin.db.select().from(personas).where(isNull(personas.tenantId));
    expect(lib).toHaveLength(PERSONA_LIBRARY.length);
    expect(await seedPersonaLibrary(admin.db)).toEqual({ created: 0, updated: 0 });
  });

  it('todo estabelecimento lê a biblioteca, mas não consegue alterá-la', async () => {
    const seen = await withTenant(app.db, tenantA, (tx) => tx.select().from(personas));
    expect(seen.filter((p) => p.tenantId === null)).toHaveLength(PERSONA_LIBRARY.length);
    const rocker = seen.find((p) => p.key === 'rocker')!;
    const updated = await withTenant(app.db, tenantA, (tx) =>
      tx.update(personas).set({ name: 'Hackeado' }).where(eq(personas.id, rocker.id)).returning(),
    );
    expect(updated).toHaveLength(0);
    try {
      await withTenant(app.db, tenantA, (tx) =>
        tx
          .insert(personas)
          .values({ key: 'falsa', name: 'Falsa', segment: 'ANY', definition: rocker.definition }),
      );
      throw new Error('deveria falhar');
    } catch (err) {
      expect(pgErrorCode(err)).toBe(PG_ERROR.INSUFFICIENT_PRIVILEGE);
    }
  });

  it('personagens próprias ficam isoladas por estabelecimento', async () => {
    const rocker = (await admin.db.select().from(personas).where(eq(personas.key, 'rocker')))[0]!;
    await withTenant(app.db, tenantA, (tx) =>
      tx.insert(personas).values({
        tenantId: tenantA,
        key: 'exclusiva-a',
        name: 'Exclusiva A',
        segment: 'BARBERSHOP',
        definition: { ...rocker.definition, key: 'exclusiva-a', name: 'Exclusiva A' },
      }),
    );
    const seenByB = await withTenant(app.db, tenantB, (tx) => tx.select().from(personas));
    expect(seenByB.some((p) => p.key === 'exclusiva-a')).toBe(false);
    const seenByA = await withTenant(app.db, tenantA, (tx) => tx.select().from(personas));
    expect(seenByA.some((p) => p.key === 'exclusiva-a')).toBe(true);
  });

  it('configuração da recepcionista é isolada e valida faixas', async () => {
    const rocker = (await admin.db.select().from(personas).where(eq(personas.key, 'rocker')))[0]!;
    await withTenant(app.db, tenantA, (tx) =>
      tx
        .insert(receptionistConfigs)
        .values({
          tenantId: tenantA,
          personaId: rocker.id,
          personaVersion: rocker.version,
          formality: 'FORMAL',
        }),
    );
    expect(await withTenant(app.db, tenantB, (tx) => tx.select().from(receptionistConfigs))).toHaveLength(0);
    try {
      await withTenant(app.db, tenantB, (tx) =>
        tx
          .insert(receptionistConfigs)
          .values({ tenantId: tenantB, personaId: rocker.id, personaVersion: 1, enthusiasm: 9 }),
      );
      throw new Error('deveria falhar');
    } catch (err) {
      expect(pgErrorCode(err)).toBe(PG_ERROR.CHECK_VIOLATION);
    }
  });
});
