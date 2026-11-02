import { createDb, type DbHandle } from '@barber-voice/db';
import { testDatabaseUrls } from '@barber-voice/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { MemoryMailer } from '../src/lib/mailer';

export const ORIGIN = 'http://localhost:3000';
/** Segunda-feira, 2 de novembro de 2026, 10:00 em São Paulo. */
export const MONDAY_10AM = new Date('2026-11-02T13:00:00Z');

export interface TestContext {
  app: Awaited<ReturnType<typeof buildApp>>;
  mailer: MemoryMailer;
  admin: DbHandle;
  setNow(d: Date): void;
  now(): Date;
  close(): Promise<void>;
}

export async function createTestContext(start: Date = MONDAY_10AM): Promise<TestContext> {
  const urls = testDatabaseUrls();
  const handle = createDb(urls.appUrl, { max: 25 });
  const admin = createDb(urls.adminUrl, { max: 2 });
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: urls.appUrl,
    LOG_LEVEL: 'silent',
    WEB_ORIGIN: ORIGIN,
    PUBLIC_WEB_URL: ORIGIN,
    RATE_LIMIT_GLOBAL_PER_MIN: '100000',
  });
  const mailer = new MemoryMailer();
  let current = start.getTime();
  const app = await buildApp(
    { config, db: handle.db, mailer, clock: () => new Date(current) },
    { logger: false },
  );
  await app.ready();
  return {
    app,
    mailer,
    admin,
    setNow: (d) => {
      current = d.getTime();
    },
    now: () => new Date(current),
    close: async () => {
      await app.close();
      await handle.close();
      await admin.close();
    },
  };
}

let ipCounter = 1;
const nextIp = () => {
  ipCounter++;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

let emailCounter = 0;
export const uniqueEmail = (prefix = 'user') =>
  `${prefix}.${Date.now().toString(36)}.${++emailCounter}@teste.com.br`;

/** Cliente HTTP de teste com cookie de sessão e IP próprio (rate limit por IP). */
export class TestClient {
  cookie: string | null = null;
  readonly ip = nextIp();
  constructor(private readonly ctx: TestContext) {}

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const res = await this.ctx.app.inject({
      method,
      url,
      remoteAddress: this.ip,
      headers: {
        origin: ORIGIN,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const c of list) {
      const [pair] = c.split(';');
      if (!pair?.startsWith('bv_session=')) continue;
      const value = pair.slice('bv_session='.length);
      this.cookie = value ? `bv_session=${value}` : null;
      if (/Expires=Thu, 01 Jan 1970/i.test(c)) this.cookie = null;
    }
    return res;
  }

  get = (url: string, headers?: Record<string, string>) => this.request('GET', url, undefined, headers);
  post = (url: string, body: unknown = {}, headers?: Record<string, string>) =>
    this.request('POST', url, body, headers);
  put = (url: string, body: unknown, headers?: Record<string, string>) =>
    this.request('PUT', url, body, headers);
  patch = (url: string, body: unknown, headers?: Record<string, string>) =>
    this.request('PATCH', url, body, headers);
  delete = (url: string, headers?: Record<string, string>) => this.request('DELETE', url, undefined, headers);
}

export const json = <T = any>(res: LightMyRequestResponse): T => res.json() as T;

export async function signup(
  ctx: TestContext,
  name = 'Dono Teste',
  email = uniqueEmail('dono'),
  password = 'senhaSegura123',
) {
  const client = new TestClient(ctx);
  const res = await client.post('/v1/auth/signup', { name, email, password, acceptTerms: true });
  if (res.statusCode !== 201) throw new Error(`signup falhou: ${res.statusCode} ${res.body}`);
  return { client, email, password, userId: json(res).user.id as string };
}

export async function createShop(client: TestClient, name = 'Barbearia Teste') {
  const res = await client.post('/v1/tenants', {
    name,
    category: 'BARBERSHOP',
    responsibleName: 'Dono Teste',
    phone: '(11) 98765-4321',
    timezone: 'America/Sao_Paulo',
  });
  if (res.statusCode !== 201) throw new Error(`createShop falhou: ${res.statusCode} ${res.body}`);
  return json(res).id as string;
}

export interface ShopFixture {
  tenantId: string;
  base: string;
  services: { corte: string; barba: string; coloracao: string };
  professionals: { joao: string; pedro: string };
}

/**
 * Estabelecimento padrão de testes:
 * - Seg–Sex 09:00–19:00, Sáb 09:00–14:00, domingo fechado. Grade de 30 min, antecedência 60 min.
 * - Corte (30 min, R$ 45), Barba (30 min, R$ 35, +10 min de limpeza), Coloração (90 min, a partir de R$ 120).
 * - João faz tudo e segue o horário da casa. Pedro faz corte (40 min, R$ 50) e barba, ter–sáb 10:00–18:00.
 */
export async function setupShop(client: TestClient, tenantId?: string): Promise<ShopFixture> {
  const id = tenantId ?? (await createShop(client));
  const base = `/v1/tenants/${id}`;
  const hours = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '19:00' }));
  hours.push({ weekday: 6, start: '09:00', end: '14:00' });
  expect200(await client.put(`${base}/business-hours`, { intervals: hours }));

  const mk = async (body: Record<string, unknown>) => {
    const res = await client.post(`${base}/services`, body);
    if (res.statusCode !== 201) throw new Error(`serviço: ${res.body}`);
    return json(res).id as string;
  };
  const corte = await mk({ name: 'Corte', durationMin: 30, priceCents: 4500 });
  const barba = await mk({ name: 'Barba', durationMin: 30, priceCents: 3500, bufferAfterMin: 10 });
  const coloracao = await mk({
    name: 'Coloração',
    durationMin: 90,
    priceCents: 12000,
    priceType: 'STARTING_AT',
  });

  const joaoRes = await client.post(`${base}/professionals`, {
    name: 'João',
    serviceIds: [corte, barba, coloracao],
  });
  if (joaoRes.statusCode !== 201) throw new Error(`profissional: ${joaoRes.body}`);
  const pedroRes = await client.post(`${base}/professionals`, {
    name: 'Pedro',
    serviceIds: [corte, barba],
    workingHours: [2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '10:00', end: '18:00' })),
  });
  if (pedroRes.statusCode !== 201) throw new Error(`profissional: ${pedroRes.body}`);
  const pedro = json(pedroRes).id as string;
  const svcRes = await client.put(`${base}/professionals/${pedro}/services`, {
    services: [{ serviceId: corte, durationMin: 40, priceCents: 5000 }, { serviceId: barba }],
  });
  expect200(svcRes);

  return {
    tenantId: id,
    base,
    services: { corte, barba, coloracao },
    professionals: { joao: json(joaoRes).id, pedro },
  };
}

function expect200(res: LightMyRequestResponse) {
  if (res.statusCode !== 200) throw new Error(`esperado 200, recebido ${res.statusCode}: ${res.body}`);
}

/** Instante ISO de uma data/hora local de São Paulo (UTC-3, sem horário de verão). */
export const sp = (date: string, time: string) => `${date}T${time}:00-03:00`;
