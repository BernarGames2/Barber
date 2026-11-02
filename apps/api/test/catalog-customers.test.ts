import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type TestClient,
  type TestContext,
  createShop,
  createTestContext,
  json,
  setupShop,
  signup,
  sp,
} from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe('onboarding do estabelecimento', () => {
  it('cria estabelecimento com teste gratuito limitado e acompanha as etapas obrigatórias', async () => {
    const { client } = await signup(ctx);
    const res = await client.post('/v1/tenants', {
      name: 'Rock & Navalha Barbearia',
      category: 'BARBERSHOP',
      responsibleName: 'Léo Rocha',
      phone: '(21) 3456-7890',
      whatsappNumber: '(21) 99876-5432',
      addressCity: 'Rio de Janeiro',
      addressState: 'rj',
      addressPostalCode: '22041-001',
    });
    expect(res.statusCode).toBe(201);
    const tenant = json(res);
    expect(tenant).toMatchObject({
      status: 'ONBOARDING',
      phone: '+552134567890',
      addressState: 'RJ',
      addressPostalCode: '22041-001',
      aiEnabled: false,
    });
    expect(tenant.slug).toMatch(/^rock-navalha-barbearia-[a-z0-9]+$/);

    const sub = await ctx.admin.pool.query(
      `SELECT s.status, p.code, (p.limits->>'voiceMinutes')::int AS minutes FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN tenants t ON t.organization_id = s.organization_id WHERE t.id = $1`,
      [tenant.id],
    );
    expect(sub.rows[0]).toMatchObject({ status: 'TRIALING', code: 'TRIAL' });
    expect(sub.rows[0].minutes).toBeGreaterThan(0); // franquia finita

    const me = json(await client.get('/v1/auth/me'));
    expect(me.memberships[0]).toMatchObject({
      tenantId: tenant.id,
      role: 'OWNER',
      onboardingCompleted: false,
    });

    const base = `/v1/tenants/${tenant.id}`;
    const before = json(await client.get(`${base}/onboarding`));
    expect(before.canComplete).toBe(false);
    expect((await client.post(`${base}/onboarding/complete`)).statusCode).toBe(422);

    await setupShop(client, tenant.id);
    const after = json(await client.get(`${base}/onboarding`));
    expect(
      after.steps
        .filter((s: { required: boolean; done: boolean }) => s.required)
        .every((s: { done: boolean }) => s.done),
    ).toBe(true);
    const done = await client.post(`${base}/onboarding/complete`);
    expect(json(done)).toMatchObject({ status: 'ACTIVE' });
    expect(json(done).onboardingCompletedAt).toBeTruthy();
  });

  it('valida telefone, UF e CEP com mensagens claras', async () => {
    const { client } = await signup(ctx);
    const res = await client.post('/v1/tenants', {
      name: 'Salão',
      category: 'BEAUTY_SALON',
      responsibleName: 'Ana',
      phone: '123',
      addressState: 'XX',
      addressPostalCode: '123',
    });
    expect(res.statusCode).toBe(400);
    const paths = json(res).error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['phone', 'addressState', 'addressPostalCode']));
  });

  it('atualiza política de agenda com limites válidos', async () => {
    const { client } = await signup(ctx);
    const id = await createShop(client);
    const ok = await client.patch(`/v1/tenants/${id}`, { slotIntervalMin: 15, minBookingNoticeMin: 120 });
    expect(json(ok)).toMatchObject({ slotIntervalMin: 15, minBookingNoticeMin: 120 });
    expect((await client.patch(`/v1/tenants/${id}`, { slotIntervalMin: 7 })).statusCode).toBe(400);
  });
});

describe('horários e catálogo', () => {
  let client: TestClient;
  let base: string;
  beforeAll(async () => {
    client = (await signup(ctx)).client;
    base = `/v1/tenants/${await createShop(client)}`;
  });

  it('horário de funcionamento com intervalo de almoço; recusa sobreposição', async () => {
    const ok = await client.put(`${base}/business-hours`, {
      intervals: [
        { weekday: 1, start: '09:00', end: '12:00' },
        { weekday: 1, start: '13:00', end: '18:00' },
      ],
    });
    expect(json(ok).intervals).toHaveLength(2);
    const bad = await client.put(`${base}/business-hours`, {
      intervals: [
        { weekday: 2, start: '09:00', end: '12:00' },
        { weekday: 2, start: '11:00', end: '18:00' },
      ],
    });
    expect(bad.statusCode).toBe(400);
    const inverted = await client.put(`${base}/business-hours`, {
      intervals: [{ weekday: 3, start: '18:00', end: '09:00' }],
    });
    expect(inverted.statusCode).toBe(400);
  });

  it('serviço exige preço, salvo "sob consulta"; nome único', async () => {
    expect((await client.post(`${base}/services`, { name: 'Corte', durationMin: 30 })).statusCode).toBe(400);
    const consult = await client.post(`${base}/services`, {
      name: 'Mega hair',
      durationMin: 240,
      priceType: 'ON_REQUEST',
    });
    expect(json(consult)).toMatchObject({ priceType: 'ON_REQUEST', priceCents: null });
    expect(
      (await client.post(`${base}/services`, { name: 'Corte', durationMin: 30, priceCents: 4000 }))
        .statusCode,
    ).toBe(201);
    const dup = await client.post(`${base}/services`, { name: 'corte', durationMin: 30, priceCents: 4000 });
    expect(dup.statusCode).toBe(409);
    expect(json(dup).error.code).toBe('SERVICE_NAME_EXISTS');
  });

  it('arquivar serviço o remove da lista e libera o nome', async () => {
    const svc = json(
      await client.post(`${base}/services`, { name: 'Pigmentação', durationMin: 40, priceCents: 6000 }),
    );
    expect((await client.delete(`${base}/services/${svc.id}`)).statusCode).toBe(204);
    const list = json(await client.get(`${base}/services`)).services.map((s: { name: string }) => s.name);
    expect(list).not.toContain('Pigmentação');
    expect(
      (await client.post(`${base}/services`, { name: 'Pigmentação', durationMin: 40, priceCents: 6500 }))
        .statusCode,
    ).toBe(201);
  });

  it('profissional com jornada própria e volta a seguir o horário da casa', async () => {
    const svc = json(
      await client.post(`${base}/services`, { name: 'Barba', durationMin: 30, priceCents: 3000 }),
    );
    const p = json(
      await client.post(`${base}/professionals`, {
        name: 'Rafa',
        serviceIds: [svc.id],
        workingHours: [{ weekday: 2, start: '10:00', end: '16:00' }],
      }),
    );
    expect(p).toMatchObject({
      usesBusinessHours: false,
      workingHours: [{ weekday: 2, start: '10:00', end: '16:00' }],
    });
    expect(p.services).toEqual([{ serviceId: svc.id, durationMin: null, priceCents: null }]);
    const reset = json(await client.put(`${base}/professionals/${p.id}/schedule`, { workingHours: null }));
    expect(reset).toMatchObject({ usesBusinessHours: true, workingHours: null });
  });
});

describe('clientes (CRM) e LGPD', () => {
  let client: TestClient;
  let base: string;
  beforeAll(async () => {
    client = (await signup(ctx)).client;
    base = (await setupShop(client)).base;
  });

  it('cadastro, busca por nome/telefone e duplicidade de telefone', async () => {
    const c = await client.post(`${base}/customers`, {
      name: 'Bruno Ferreira',
      phone: '(11) 97654-3210',
      preferences: { style: 'Degradê baixo' },
      tags: ['vip'],
    });
    expect(c.statusCode).toBe(201);
    const dup = await client.post(`${base}/customers`, { name: 'Outro', phone: '11976543210' });
    expect(dup.statusCode).toBe(409);
    expect(json(dup).error.details.customerId).toBe(json(c).id);

    expect(json(await client.get(`${base}/customers?q=bruno`)).total).toBe(1);
    expect(json(await client.get(`${base}/customers?q=7654`)).total).toBe(1);
    expect(json(await client.get(`${base}/customers?q=100%25`)).total).toBe(0); // curingas escapados
  });

  it('histórico de consentimento: o estado atual é o registro mais recente', async () => {
    const c = json(await client.post(`${base}/customers`, { name: 'Consentido', phone: '11 95555-0000' }));
    await client.post(`${base}/customers/${c.id}/consents`, {
      purpose: 'WHATSAPP_MARKETING',
      granted: true,
      channel: 'WHATSAPP',
    });
    const revoked = await client.post(`${base}/customers/${c.id}/consents`, {
      purpose: 'WHATSAPP_MARKETING',
      granted: false,
      channel: 'PHONE',
    });
    expect(json(revoked).consents).toEqual([
      expect.objectContaining({ purpose: 'WHATSAPP_MARKETING', granted: false, channel: 'PHONE' }),
    ]);
    const history = await ctx.admin.pool.query(
      'SELECT count(*)::int AS n FROM consents WHERE customer_id = $1',
      [c.id],
    );
    expect(history.rows[0].n).toBe(2);
  });

  it('anonimização remove dados pessoais e é bloqueada com agendamento futuro', async () => {
    const c = json(
      await client.post(`${base}/customers`, {
        name: 'Esquecer Meus Dados',
        phone: '11 94444-0000',
        notes: 'alergia',
      }),
    );
    const profs = json(await client.get(`${base}/professionals`)).professionals;
    const svcs = json(await client.get(`${base}/services`)).services;
    const appt = await client.post(`${base}/appointments`, {
      customerId: c.id,
      professionalId: profs[0].id,
      serviceIds: [svcs[0].id],
      startsAt: sp('2026-11-03', '10:00'),
    });
    expect(appt.statusCode).toBe(201);
    expect((await client.post(`${base}/customers/${c.id}/anonymize`)).statusCode).toBe(409);
    await client.post(`${base}/appointments/${json(appt).id}/cancel`, {});
    expect((await client.post(`${base}/customers/${c.id}/anonymize`)).statusCode).toBe(204);
    expect((await client.get(`${base}/customers/${c.id}`)).statusCode).toBe(404);
    const row = await ctx.admin.pool.query('SELECT name, phone, notes FROM customers WHERE id = $1', [c.id]);
    expect(row.rows[0]).toEqual({ name: 'Cliente anonimizado', phone: null, notes: null });
  });
});
