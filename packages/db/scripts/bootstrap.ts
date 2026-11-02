import pg from 'pg';
import { loadEnv } from '../src/env';

/**
 * Cria papéis e bancos de DESENVOLVIMENTO/TESTE a partir de uma conexão de superusuário.
 * Equivalente a infra/postgres/init/01-roles.sql (usado pelo docker compose).
 *
 *   POSTGRES_SUPERUSER_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm db:bootstrap
 *
 * Em produção, crie os papéis manualmente com senhas fortes (docs/DEPLOYMENT.md).
 */
loadEnv();

const superUrl = process.env.POSTGRES_SUPERUSER_URL;
if (!superUrl) {
  console.error('Defina POSTGRES_SUPERUSER_URL (ex.: postgres://postgres:postgres@localhost:5432/postgres).');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('bootstrap é apenas para desenvolvimento/testes.');
  process.exit(1);
}

function parse(url: string | undefined, fallbackUser: string, fallbackPass: string) {
  const u = new URL(url ?? `postgres://${fallbackUser}:${fallbackPass}@localhost:5432/barber_voice`);
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) };
}

const owner = parse(process.env.DATABASE_ADMIN_URL, 'barber_owner', 'barber_owner_dev');
const app = parse(process.env.DATABASE_URL, 'barber_app', 'barber_app_dev');
const testDb = parse(process.env.TEST_DATABASE_ADMIN_URL, 'barber_owner', 'barber_owner_dev').database || 'barber_voice_test';

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Identificador inválido: ${s}`);
  return s;
};

const client = new pg.Client({ connectionString: superUrl });
await client.connect();
try {
  const ensureRole = async (name: string, password: string, extra: string) => {
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
    const pass = client.escapeLiteral(password);
    if (exists.rowCount) await client.query(`ALTER ROLE ${ident(name)} WITH LOGIN PASSWORD ${pass} ${extra}`);
    else await client.query(`CREATE ROLE ${ident(name)} WITH LOGIN PASSWORD ${pass} ${extra}`);
  };
  await ensureRole(owner.user, owner.password, 'CREATEDB');
  await ensureRole(app.user, app.password, 'NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE');
  for (const db of [owner.database, testDb]) {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
    if (!exists.rowCount) await client.query(`CREATE DATABASE ${ident(db)} OWNER ${ident(owner.user)}`);
  }
  console.log(`[bootstrap] Papéis ${owner.user}/${app.user} e bancos ${owner.database}/${testDb} prontos.`);
} finally {
  await client.end();
}
