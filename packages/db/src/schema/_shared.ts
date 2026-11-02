import { uuidv7 } from '@barber-voice/core';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Chave primária UUID v7 (gerada na aplicação) com fallback gen_random_uuid() no banco. */
export const pk = () =>
  uuid('id')
    .primaryKey()
    .defaultRandom()
    .$defaultFn(() => uuidv7());

export const tz = { withTimezone: true, mode: 'date' } as const;

export const createdAt = () => timestamp('created_at', tz).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', tz)
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
