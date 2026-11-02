import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestContext, TestClient, createTestContext, json, signup, uniqueEmail } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe('cadastro e sessão', () => {
  it('cria conta, define cookie seguro e retorna o usuário', async () => {
    const client = new TestClient(ctx);
    const email = uniqueEmail('novo');
    const res = await client.post('/v1/auth/signup', { name: 'Ana Souza', email, password: 'senhaSegura123', acceptTerms: true });
    expect(res.statusCode).toBe(201);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/bv_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(json(res).user).toMatchObject({ name: 'Ana Souza', email, emailVerified: false });
    expect(json(res).memberships).toEqual([]);

    const me = await client.get('/v1/auth/me');
    expect(me.statusCode).toBe(200);
    expect(ctx.mailer.lastTo(email)?.kind).toBe('email_verification');
  });

  it('normaliza e-mail e recusa duplicidade', async () => {
    const email = uniqueEmail('dup');
    await signup(ctx, 'Primeiro', email);
    const client = new TestClient(ctx);
    const res = await client.post('/v1/auth/signup', {
      name: 'Segundo',
      email: `  ${email.toUpperCase()} `,
      password: 'outraSenha123',
      acceptTerms: true,
    });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe('EMAIL_IN_USE');
  });

  it('valida senha fraca e termos com mensagens em português', async () => {
    const client = new TestClient(ctx);
    const res = await client.post('/v1/auth/signup', { name: 'X', email: 'invalido', password: '123', acceptTerms: false });
    expect(res.statusCode).toBe(400);
    const paths = json(res).error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password', 'acceptTerms']));
  });

  it('não armazena a senha em texto e usa Argon2id', async () => {
    const { email } = await signup(ctx);
    const r = await ctx.admin.pool.query('SELECT password_hash FROM users WHERE email = $1', [email]);
    expect(r.rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  it('sessão fica armazenada apenas como hash', async () => {
    const { client, userId } = await signup(ctx);
    const token = client.cookie!.split('=')[1]!;
    const r = await ctx.admin.pool.query('SELECT token_hash FROM sessions WHERE user_id = $1', [userId]);
    expect(r.rows[0].token_hash).not.toContain(token);
    expect(r.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('logout revoga a sessão no servidor', async () => {
    const { client } = await signup(ctx);
    const stolen = client.cookie!;
    expect((await client.post('/v1/auth/logout')).statusCode).toBe(204);
    const attacker = new TestClient(ctx);
    attacker.cookie = stolen;
    expect((await attacker.get('/v1/auth/me')).statusCode).toBe(401);
  });

  it('cookie adulterado ou ausente não autentica', async () => {
    const c = new TestClient(ctx);
    expect((await c.get('/v1/auth/me')).statusCode).toBe(401);
    c.cookie = 'bv_session=token-falso';
    expect((await c.get('/v1/auth/me')).statusCode).toBe(401);
  });

  it('lista e revoga sessões de outros dispositivos', async () => {
    const { email, password, client } = await signup(ctx);
    const other = new TestClient(ctx);
    await other.post('/v1/auth/login', { email, password });
    const list = json(await client.get('/v1/auth/sessions')).sessions as { id: string; current: boolean }[];
    expect(list).toHaveLength(2);
    const otherSession = list.find((s) => !s.current)!;
    expect((await client.delete(`/v1/auth/sessions/${otherSession.id}`)).statusCode).toBe(204);
    expect((await other.get('/v1/auth/me')).statusCode).toBe(401);
    expect((await client.get('/v1/auth/me')).statusCode).toBe(200);
  });
});

describe('login', () => {
  it('mensagem genérica para senha errada e e-mail inexistente', async () => {
    const { email } = await signup(ctx);
    const c = new TestClient(ctx);
    const wrong = await c.post('/v1/auth/login', { email, password: 'senhaErrada999' });
    const missing = await c.post('/v1/auth/login', { email: uniqueEmail('naoexiste'), password: 'qualquer123' });
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(json(wrong).error).toEqual(json(missing).error);
  });

  it('bloqueia a conta após 10 falhas, mesmo com a senha correta depois', async () => {
    const { email, password } = await signup(ctx);
    for (let i = 0; i < 10; i++) {
      // IP diferente a cada tentativa: o bloqueio é por conta, não por IP
      const c = new TestClient(ctx);
      expect((await c.post('/v1/auth/login', { email, password: `errada${i}abc` })).statusCode).toBe(401);
    }
    const res = await new TestClient(ctx).post('/v1/auth/login', { email, password });
    expect(res.statusCode).toBe(429);
    expect(json(res).error.code).toBe('ACCOUNT_LOCKED');

    // após 15 minutos, volta a funcionar
    ctx.setNow(new Date(ctx.now().getTime() + 16 * 60_000));
    const ok = await new TestClient(ctx).post('/v1/auth/login', { email, password });
    expect(ok.statusCode).toBe(200);
  });

  it('limita tentativas por IP (rate limit)', async () => {
    const c = new TestClient(ctx);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await c.post('/v1/auth/login', { email: uniqueEmail('rl'), password: 'x1234567890' })).statusCode);
    }
    expect(statuses).toContain(429);
  });
});

describe('redefinição de senha', () => {
  it('fluxo completo: token de uso único, sessões antigas encerradas', async () => {
    const { email, client: oldSession } = await signup(ctx);
    const c = new TestClient(ctx);
    expect((await c.post('/v1/auth/password/forgot', { email })).statusCode).toBe(202);
    const mail = ctx.mailer.lastTo(email);
    expect(mail?.kind).toBe('password_reset');
    const token = /token=([\w-]+)/.exec(mail!.text)![1]!;

    const reset = await c.post('/v1/auth/password/reset', { token, password: 'novaSenha2026' });
    expect(reset.statusCode).toBe(200);
    expect((await oldSession.get('/v1/auth/me')).statusCode).toBe(401);
    expect((await c.post('/v1/auth/password/reset', { token, password: 'outraSenha2026' })).statusCode).toBe(400);
    expect((await new TestClient(ctx).post('/v1/auth/login', { email, password: 'novaSenha2026' })).statusCode).toBe(200);
  });

  it('não revela se o e-mail existe', async () => {
    const email = uniqueEmail('fantasma');
    const res = await new TestClient(ctx).post('/v1/auth/password/forgot', { email });
    expect(res.statusCode).toBe(202);
    expect(ctx.mailer.lastTo(email)).toBeUndefined();
  });

  it('token expira em 1 hora', async () => {
    const { email } = await signup(ctx);
    await new TestClient(ctx).post('/v1/auth/password/forgot', { email });
    const token = /token=([\w-]+)/.exec(ctx.mailer.lastTo(email)!.text)![1]!;
    ctx.setNow(new Date(ctx.now().getTime() + 61 * 60_000));
    const res = await new TestClient(ctx).post('/v1/auth/password/reset', { token, password: 'novaSenha2026' });
    expect(res.statusCode).toBe(400);
  });

  it('confirma e-mail com token', async () => {
    const { email, client } = await signup(ctx);
    const token = /token=([\w-]+)/.exec(ctx.mailer.lastTo(email)!.text)![1]!;
    expect((await client.post('/v1/auth/email/verify', { token })).statusCode).toBe(200);
    expect(json(await client.get('/v1/auth/me')).user.emailVerified).toBe(true);
  });
});

describe('proteções HTTP', () => {
  it('rejeita requisição mutável com cookie vinda de outra origem (CSRF)', async () => {
    const { client } = await signup(ctx);
    const res = await client.post('/v1/tenants', { name: 'X' }, { origin: 'https://site-malicioso.com' });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.code).toBe('CSRF_REJECTED');
    const res2 = await client.request('POST', '/v1/auth/logout', {}, { origin: '', 'sec-fetch-site': 'cross-site' });
    expect(res2.statusCode).toBe(403);
  });

  it('aceita apenas JSON (formulários HTML não são interpretados)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=a@b.com&password=x',
    });
    expect(res.statusCode).toBe(415);
  });

  it('envia cabeçalhos de segurança e não permite cache', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('CORS só libera a origem do painel', async () => {
    const ok = await ctx.app.inject({ method: 'OPTIONS', url: '/v1/auth/me', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' } });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const bad = await ctx.app.inject({ method: 'OPTIONS', url: '/v1/auth/me', headers: { origin: 'https://evil.com', 'access-control-request-method': 'GET' } });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('readiness verifica o banco', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(json(res).db.ok).toBe(true);
  });
});
