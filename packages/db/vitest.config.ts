import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    // os testes compartilham um banco real: arquivos rodam em sequência
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
