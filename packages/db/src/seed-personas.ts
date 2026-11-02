import { PERSONA_LIBRARY } from '@barber-voice/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from './client';
import { personas } from './schema';

/** JSON canônico (chaves ordenadas): o jsonb do PostgreSQL não preserva a ordem das chaves. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Sincroniza a biblioteca de personagens (idempotente). Quando a definição muda, a versão
 * é incrementada — estabelecimentos guardam a versão escolhida em `receptionist_configs`.
 * Requer conexão administrativa (a biblioteca não é gravável pelo papel da aplicação).
 */
export async function seedPersonaLibrary(db: Database): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const def of PERSONA_LIBRARY) {
    const [existing] = await db
      .select()
      .from(personas)
      .where(and(isNull(personas.tenantId), eq(personas.key, def.key)))
      .limit(1);
    if (!existing) {
      await db
        .insert(personas)
        .values({ key: def.key, name: def.name, segment: def.segment, definition: def });
      created++;
    } else if (canonicalJson(existing.definition) !== canonicalJson(def)) {
      await db
        .update(personas)
        .set({ name: def.name, segment: def.segment, definition: def, version: sql`${personas.version} + 1` })
        .where(eq(personas.id, existing.id));
      updated++;
    }
  }
  return { created, updated };
}
