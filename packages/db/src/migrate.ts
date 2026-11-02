import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { createDb } from './client';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Concede ao papel da aplicação apenas o necessário. Idempotente; roda após cada migração.
 * - DML nas tabelas (sujeito a RLS), mas auditoria é somente-inserção e planos somente-leitura.
 * - Nenhum acesso ao schema `drizzle` (controle de migrações).
 */
export async function applyGrants(pool: pg.Pool, role: string): Promise<boolean> {
  if (!ROLE_RE.test(role)) throw new Error(`Nome de papel inválido: ${role}`);
  const exists = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (!exists.rowCount) return false;
  const bypass = await pool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
    'SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1',
    [role],
  );
  const r = bypass.rows[0];
  if (r?.rolbypassrls || r?.rolsuper) {
    throw new Error(`O papel da aplicação "${role}" não pode ser SUPERUSER nem BYPASSRLS.`);
  }
  await pool.query(`
    GRANT USAGE ON SCHEMA public TO ${role};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role};
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM ${role};
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON plans FROM ${role};
    REVOKE UPDATE ON conversation_llm_turns FROM ${role};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role};
    GRANT EXECUTE ON FUNCTION app_current_tenant() TO ${role};
  `);
  return true;
}

export async function runMigrations(adminUrl: string, appRole: string, log: (m: string) => void = () => {}) {
  const handle = createDb(adminUrl, {
    max: 1,
    applicationName: 'barber-voice-migrate',
    statementTimeoutMs: 120_000,
  });
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_DIR });
    log('Migrações aplicadas.');
    const granted = await applyGrants(handle.pool, appRole);
    log(
      granted
        ? `Permissões aplicadas ao papel "${appRole}".`
        : `Papel "${appRole}" não existe: permissões não aplicadas.`,
    );
  } finally {
    await handle.close();
  }
}
