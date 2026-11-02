import { isUuid } from '@barber-voice/core';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Banco ou transação: funções de repositório aceitam ambos. */
export type DbExecutor = Database | Tx;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  max?: number;
  applicationName?: string;
  /** Tempo máximo de uma instrução SQL (ms). Evita consultas presas segurando conexões. */
  statementTimeoutMs?: number;
  onError?: (err: Error) => void;
}

export function createDb(url: string, options: CreateDbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'barber-voice',
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
  });
  // Erros em conexões ociosas não podem derrubar o processo.
  pool.on('error', (err) => (options.onError ? options.onError(err) : console.error('[db] erro no pool', err.message)));
  const db = drizzle({ client: pool, schema });
  return { db, pool, close: () => pool.end() };
}

export interface TransactionOptions {
  isolationLevel?: 'read committed' | 'repeatable read' | 'serializable';
}

/**
 * Executa `fn` numa transação com o estabelecimento corrente definido para o RLS.
 * TODA operação de dados de estabelecimento deve passar por aqui: sem contexto,
 * as políticas de Row-Level Security retornam zero linhas e bloqueiam escritas.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  if (!isUuid(tenantId)) throw new Error('withTenant: tenantId inválido');
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  }, options);
}

/** Bloqueio transacional por profissional: serializa reservas e bloqueios da mesma agenda. */
export async function lockProfessionalSchedule(tx: Tx, professionalId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`professional:${professionalId}`}, 0))`);
}

export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  NOT_NULL_VIOLATION: '23502',
  INSUFFICIENT_PRIVILEGE: '42501',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
} as const;

interface PgLikeError {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

function walkCause(err: unknown, pick: (e: PgLikeError) => string | undefined): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur && typeof cur === 'object'; i++) {
    const found = pick(cur as PgLikeError);
    if (found) return found;
    cur = (cur as PgLikeError).cause;
  }
  return undefined;
}

/** Código SQLSTATE do erro do PostgreSQL (o Drizzle encapsula o erro original em `cause`). */
export function pgErrorCode(err: unknown): string | undefined {
  return walkCause(err, (e) => (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : undefined));
}

export function pgConstraintName(err: unknown): string | undefined {
  return walkCause(err, (e) => (typeof e.constraint === 'string' ? e.constraint : undefined));
}
