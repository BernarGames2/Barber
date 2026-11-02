import { loadEnv } from '../src/env';
import { runMigrations } from '../src/migrate';

loadEnv();

const useTest = process.argv.includes('--test');
const url = useTest ? process.env.TEST_DATABASE_ADMIN_URL : process.env.DATABASE_ADMIN_URL;
const role = process.env.DB_APP_ROLE ?? 'barber_app';

if (!url) {
  console.error(`Defina ${useTest ? 'TEST_DATABASE_ADMIN_URL' : 'DATABASE_ADMIN_URL'} (papel dono do schema).`);
  process.exit(1);
}

runMigrations(url, role, (m) => console.log(`[migrate] ${m}`))
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[migrate] falhou:', err);
    process.exit(1);
  });
