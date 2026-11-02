import pg from 'pg';
import { createDb } from './client';
import { loadEnv } from './env';
import { runMigrations } from './migrate';
import { seedPersonaLibrary } from './seed-personas';
import { seedPlans } from './seed-plans';

export interface TestDatabaseUrls {
  appUrl: string;
  adminUrl: string;
  appRole: string;
}

export function testDatabaseUrls(): TestDatabaseUrls {
  loadEnv();
  const appUrl = process.env.TEST_DATABASE_URL;
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (!appUrl || !adminUrl) {
    throw new Error('Defina TEST_DATABASE_URL e TEST_DATABASE_ADMIN_URL (veja .env.example).');
  }
  if (!/test/i.test(new URL(adminUrl).pathname)) {
    throw new Error('Por segurança, o banco de testes precisa ter "test" no nome.');
  }
  return { appUrl, adminUrl, appRole: process.env.DB_APP_ROLE ?? 'barber_app' };
}

/**
 * Recria o schema do banco de TESTES do zero e aplica todas as migrações.
 * Recusa-se a rodar em bancos cujo nome não contenha "test".
 */
export async function resetTestDatabase(): Promise<TestDatabaseUrls> {
  const urls = testDatabaseUrls();
  const client = new pg.Client({ connectionString: urls.adminUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  await runMigrations(urls.adminUrl, urls.appRole);
  const admin = createDb(urls.adminUrl, { max: 1 });
  try {
    await seedPlans(admin.db);
    await seedPersonaLibrary(admin.db);
  } finally {
    await admin.close();
  }
  return urls;
}
