import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Carrega o `.env` da raiz do monorepo (se existir) sem sobrescrever variáveis já definidas.
 * Em produção as variáveis vêm do ambiente da plataforma, e não de arquivo.
 */
export function loadEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate) && existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        // arquivo ilegível: segue com o ambiente atual
      }
      return;
    }
    dir = resolve(dir, '..');
  }
}
