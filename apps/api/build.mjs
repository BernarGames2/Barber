/**
 * Build de produção da API: empacota o código TypeScript (incluindo os pacotes internos
 * @barber-voice/* e as dependências puramente JS deles) em um único ESM.
 * Ficam externas apenas as dependências DECLARADAS em apps/api/package.json — elas são
 * instaladas na imagem de produção (pnpm deploy) e podem conter binários nativos.
 */
import { readFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const declared = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@barber-voice/'));

await rm('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  // dependências declaradas (e subcaminhos, ex.: drizzle-orm/pg-core) + opcional nativo do pg
  external: [...declared, ...declared.map((d) => `${d}/*`), 'pg-native'],
  banner: {
    // permite que dependências CommonJS empacotadas usem require dentro do bundle ESM
    js: "import { createRequire as __bvCreateRequire } from 'node:module'; const require = __bvCreateRequire(import.meta.url);",
  },
});
