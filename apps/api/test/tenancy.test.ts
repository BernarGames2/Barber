import { memberships } from '@barber-voice/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ShopFixture,
  type TestContext,
  TestClient,
  createTestContext,
  json,
  setupShop,
  signup,
  sp,
} from './helpers';

let ctx: TestContext;
let ownerA: TestClient;
let ownerB: TestClient;
let shopA: ShopFixture;
let shopB: ShopFixture;
let customerA: string;
let appointmentA: string;

beforeAll(async () => {
  ctx = await createTestContext();
  ownerA = (await signup(ctx, 'Dono A')).client;
  ownerB = (await signup(ctx, 'Dono B')).client;
  shopA = await setupShop(ownerA);
  shopB = await setupShop(ownerB);
  const c = await ownerA.post(`${shopA.base}/customers`, {
    name: 'Cliente Secreto A',
    phone: '11 91234-0001',
  });
  customerA = json(c).id;
  const a = await ownerA.post(`${shopA.base}/appointments`, {
    customerId: customerA,
    professionalId: shopA.professionals.joao,
    serviceIds: [shopA.services.corte],
    startsAt: sp('2026-11-03', '10:00'),
  });
  expect(a.statusCode).toBe(201);
  appointmentA = json(a).id;
});

afterAll(async () => {
  await ctx.close();
});

describe('isolamento entre estabelecimentos (API)', () => {
  it('o dono de B não acessa nenhum dado de A (404, sem revelar existência)', async () => {
    const urls = [
      shopA.base,
      `${shopA.base}/services`,
      `${shopA.base}/professionals`,
      `${shopA.base}/customers`,
      `${shopA.base}/customers/${customerA}`,
      `${shopA.base}/appointments?from=2026-11-01&to=2026-11-30`,
      `${shopA.base}/appointments/${appointmentA}`,
      `${shopA.base}/dashboard/summary`,
      `${shopA.base}/business-hours`,
    ];
    for (const url of urls) {
      const res = await ownerB.get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.body).not.toContain('Cliente Secreto A');
    }
  });

  it('o dono de B não altera dados de A', async () => {
    const attempts = [
      ownerB.patch(shopA.base, { name: 'Invadido' }),
      ownerB.post(`${shopA.base}/services`, { name: 'Hack', durationMin: 30, priceCents: 1 }),
      ownerB.patch(`${shopA.base}/services/${shopA.services.corte}`, { priceCents: 1 }),
      ownerB.post(`${shopA.base}/appointments/${appointmentA}/cancel`, {}),
      ownerB.delete(`${shopA.base}/professionals/${shopA.professionals.joao}`),
    ];
    for (const res of await Promise.all(attempts)) expect(res.statusCode).toBe(404);
    const svc = json(await ownerA.get(`${shopA.base}/services`)).services;
    expect(svc.find((s: { id: string }) => s.id === shopA.services.corte).priceCents).toBe(4500);
    const appt = json(await ownerA.get(`${shopA.base}/appointments/${appointmentA}`));
    expect(appt.status).toBe('CONFIRMED');
  });

  it('IDs de A usados DENTRO do escopo de B não vazam nem são aceitos', async () => {
    // B tenta ler/alterar recursos de A pela rota do próprio estabelecimento
    expect((await ownerB.get(`${shopB.base}/customers/${customerA}`)).statusCode).toBe(404);
    expect((await ownerB.get(`${shopB.base}/appointments/${appointmentA}`)).statusCode).toBe(404);
    expect(
      (await ownerB.patch(`${shopB.base}/services/${shopA.services.corte}`, { priceCents: 1 })).statusCode,
    ).toBe(404);
    expect((await ownerB.post(`${shopB.base}/appointments/${appointmentA}/cancel`, {})).statusCode).toBe(404);

    // B tenta agendar o cliente de A, ou com o profissional/serviço de A
    const withForeignCustomer = await ownerB.post(`${shopB.base}/appointments`, {
      customerId: customerA,
      professionalId: shopB.professionals.joao,
      serviceIds: [shopB.services.corte],
      startsAt: sp('2026-11-03', '11:00'),
    });
    expect(withForeignCustomer.statusCode).toBe(404);
    const withForeignProfessional = await ownerB.post(`${shopB.base}/appointments`, {
      newCustomer: { name: 'Alguém' },
      professionalId: shopA.professionals.joao,
      serviceIds: [shopB.services.corte],
      startsAt: sp('2026-11-03', '11:00'),
    });
    expect(withForeignProfessional.statusCode).toBe(422);
    const withForeignService = await ownerB.post(`${shopB.base}/appointments`, {
      newCustomer: { name: 'Alguém' },
      serviceIds: [shopA.services.corte],
      startsAt: sp('2026-11-03', '11:00'),
    });
    expect(withForeignService.statusCode).toBe(422);
    // profissional de B não pode receber serviço de A
    const linkForeign = await ownerB.put(`${shopB.base}/professionals/${shopB.professionals.joao}/services`, {
      services: [{ serviceId: shopA.services.corte }],
    });
    expect(linkForeign.statusCode).toBe(422);
  });

  it('a busca de clientes de B nunca retorna clientes de A', async () => {
    const res = json(await ownerB.get(`${shopB.base}/customers?q=Secreto`));
    expect(res.total).toBe(0);
  });

  it('a mesma pessoa pode ser cliente de dois estabelecimentos (telefone único por estabelecimento)', async () => {
    const res = await ownerB.post(`${shopB.base}/customers`, {
      name: 'Mesmo Telefone',
      phone: '11 91234-0001',
    });
    expect(res.statusCode).toBe(201);
  });

  it('sem sessão: 401; tenantId malformado: 404', async () => {
    const anon = new TestClient(ctx);
    expect((await anon.get(`${shopA.base}/services`)).statusCode).toBe(401);
    expect((await ownerA.get('/v1/tenants/nao-e-uuid/services')).statusCode).toBe(404);
    expect((await ownerA.get('/v1/tenants/00000000-0000-4000-8000-000000000000/services')).statusCode).toBe(
      404,
    );
  });

  it('auditoria registra operações com o estabelecimento correto', async () => {
    const r = await ctx.admin.pool.query(
      `SELECT action, tenant_id FROM audit_logs WHERE entity_id = $1 AND action = 'appointment.created'`,
      [appointmentA],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].tenant_id).toBe(shopA.tenantId);
  });
});

describe('papéis e permissões', () => {
  let staff: TestClient;
  let manager: TestClient;

  beforeAll(async () => {
    const s = await signup(ctx, 'Funcionário');
    const m = await signup(ctx, 'Gerente');
    staff = s.client;
    manager = m.client;
    await ctx.admin.db.insert(memberships).values([
      { tenantId: shopA.tenantId, userId: s.userId, role: 'STAFF' },
      { tenantId: shopA.tenantId, userId: m.userId, role: 'MANAGER' },
    ]);
  });

  it('equipe (STAFF) agenda e consulta, mas não altera catálogo, horários nem estabelecimento', async () => {
    expect((await staff.get(`${shopA.base}/services`)).statusCode).toBe(200);
    expect((await staff.get(`${shopA.base}/customers`)).statusCode).toBe(200);
    const book = await staff.post(`${shopA.base}/appointments`, {
      newCustomer: { name: 'Cliente do Balcão' },
      professionalId: shopA.professionals.joao,
      serviceIds: [shopA.services.corte],
      startsAt: sp('2026-11-03', '15:00'),
    });
    expect(book.statusCode).toBe(201);

    expect(
      (await staff.post(`${shopA.base}/services`, { name: 'X', durationMin: 30, priceCents: 100 }))
        .statusCode,
    ).toBe(403);
    expect((await staff.put(`${shopA.base}/business-hours`, { intervals: [] })).statusCode).toBe(403);
    expect((await staff.patch(shopA.base, { name: 'Novo nome' })).statusCode).toBe(403);
    expect((await staff.post(`${shopA.base}/customers/${customerA}/anonymize`)).statusCode).toBe(403);
    // equipe não agenda fora do horário (exceção exclusiva de gestor)
    const outside = await staff.post(`${shopA.base}/appointments`, {
      newCustomer: { name: 'Tarde da noite' },
      professionalId: shopA.professionals.joao,
      serviceIds: [shopA.services.corte],
      startsAt: sp('2026-11-03', '21:00'),
      allowOutsideHours: true,
    });
    expect(outside.statusCode).toBe(403);
  });

  it('gerente altera catálogo e agenda fora do horário', async () => {
    const svc = await manager.post(`${shopA.base}/services`, {
      name: 'Sobrancelha',
      durationMin: 15,
      priceCents: 2000,
    });
    expect(svc.statusCode).toBe(201);
    const outside = await manager.post(`${shopA.base}/appointments`, {
      newCustomer: { name: 'Cliente VIP' },
      professionalId: shopA.professionals.joao,
      serviceIds: [shopA.services.corte],
      startsAt: sp('2026-11-03', '20:00'),
      allowOutsideHours: true,
    });
    expect(outside.statusCode).toBe(201);
  });

  it('vínculo desativado perde o acesso imediatamente', async () => {
    const s = await signup(ctx, 'Ex-funcionário');
    const [m] = await ctx.admin.db
      .insert(memberships)
      .values({ tenantId: shopA.tenantId, userId: s.userId, role: 'STAFF' })
      .returning();
    expect((await s.client.get(`${shopA.base}/services`)).statusCode).toBe(200);
    await ctx.admin.pool.query(`UPDATE memberships SET status = 'DISABLED' WHERE id = $1`, [m!.id]);
    expect((await s.client.get(`${shopA.base}/services`)).statusCode).toBe(404);
  });

  it('estabelecimento suspenso fica somente leitura', async () => {
    const owner = (await signup(ctx, 'Dono Suspenso')).client;
    const shop = await setupShop(owner);
    await ctx.admin.pool.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [shop.tenantId]);
    expect((await owner.get(`${shop.base}/services`)).statusCode).toBe(200);
    const res = await owner.post(`${shop.base}/services`, { name: 'Novo', durationMin: 30, priceCents: 100 });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.code).toBe('TENANT_SUSPENDED');
  });
});
