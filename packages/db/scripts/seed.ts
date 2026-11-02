import { createDb } from '../src/client';
import { loadEnv } from '../src/env';
import { seedPlans } from '../src/seed-plans';

loadEnv();

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error('Defina DATABASE_ADMIN_URL.');
  process.exit(1);
}

const handle = createDb(url, { max: 1 });
seedPlans(handle.db)
  .then(() => console.log('[seed] Planos padrão inseridos/atualizados.'))
  .catch((err: unknown) => {
    console.error('[seed] falhou:', err);
    process.exitCode = 1;
  })
  .finally(() => handle.close());
