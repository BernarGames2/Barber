import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { testDatabaseUrls } from '@barber-voice/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stripPathPrefix } from '../src/app';
import { loadConfig } from '../src/config';
import type { ApiRuntime } from '../src/runtime';

describe('prefixo público /api', () => {
  it.each([
    ['/api/v1/meta', '/v1/meta'],
    ['/api/health', '/health'],
    ['/api', '/'],
    ['/api?x=1', '/?x=1'],
    ['/api/v1/tenants/abc/conversations?status=OPEN', '/v1/tenants/abc/conversations?status=OPEN'],
    ['/v1/meta', '/v1/meta'], // chamadas diretas continuam funcionando
    ['/apix/v1', '/apix/v1'], // só remove o segmento exato
    ['/health', '/health'],
  ])('%s → %s', (input, expected) => {
    expect(stripPathPrefix(input, '/api')).toBe(expected);
  });

  it('sem prefixo configurado, nada muda', () => {
    expect(stripPathPrefix('/api/v1/meta', '')).toBe('/api/v1/meta');
  });

  it('na Vercel, o domínio da implantação vira origem confiável (CSRF/CORS)', () => {
    const base = { DATABASE_URL: 'postgres://x', WEB_ORIGIN: 'http://localhost:3000' };
    expect(loadConfig({ ...base, VERCEL_URL: 'barber-abc123.vercel.app' }).allowedOrigins).toEqual([
      'http://localhost:3000',
      'https://barber-abc123.vercel.app',
    ]);
    expect(loadConfig(base).allowedOrigins).toEqual(['http://localhost:3000']);
    expect(() => loadConfig({ ...base, API_PATH_PREFIX: 'api' })).toThrow(/API_PATH_PREFIX/);
  });
});

/**
 * O ponto de entrada da Vercel (`src/vercel.ts`) exporta um handler `(req, res)`. Aqui ele é
 * servido por um servidor HTTP comum, recebendo os caminhos públicos como a Vercel os entrega.
 */
describe('ponto de entrada da Vercel', () => {
  let server: Server;
  let base: string;
  let runtime: Promise<ApiRuntime>;
  const saved = { ...process.env };

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testDatabaseUrls().appUrl,
      WEB_ORIGIN: 'http://localhost:3000',
      VERCEL_URL: 'barber-teste.vercel.app',
      ANTHROPIC_API_KEY: '',
      REDIS_URL: '',
    });
    const mod = await import('../src/vercel');
    runtime = mod.runtime;
    server = createServer((req, res) => void mod.default(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await (await runtime).close();
    process.env = saved;
  });

  it('responde nos caminhos públicos /api/*', async () => {
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
    const meta = await fetch(`${base}/api/v1/meta`);
    expect(meta.status).toBe(200);
    const notFound = await fetch(`${base}/api/v1/nao-existe`);
    expect(notFound.status).toBe(404);
  });

  it('aceita o domínio da implantação como origem e recusa origens estranhas', async () => {
    // a verificação de origem (CSRF) vale para requisições mutáveis que levam o cookie de sessão
    const login = (origin: string) =>
      fetch(`${base}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, cookie: 'bv_session=qualquer' },
        body: JSON.stringify({ email: 'ninguem@teste.com.br', password: 'senhaErrada123' }),
      });
    const ok = await login('https://barber-teste.vercel.app');
    expect(ok.status).toBe(401); // passou pela origem e chegou à autenticação (credenciais inválidas)
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://barber-teste.vercel.app');
    const evil = await login('https://site-malicioso.example');
    expect(evil.status).toBe(403);
    expect((await evil.json()).error.code).toBe('CSRF_REJECTED');
  });
});
