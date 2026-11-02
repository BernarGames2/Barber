import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './src/env';

loadEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_ADMIN_URL ?? 'postgres://barber_owner:barber_owner_dev@localhost:5432/barber_voice',
  },
  strict: true,
  verbose: true,
});
