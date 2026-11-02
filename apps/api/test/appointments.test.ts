import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MONDAY_10AM,
  type ShopFixture,
  type TestClient,
  type TestContext,
  createTestContext,
  json,
  setupShop,
  signup,
  sp,
} from './helpers';

let ctx: TestContext;
let owner: TestClient;
let shop: ShopFixture;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(async () => {
  ctx.setNow(MONDAY_10AM);
  // dono e estabelecimento novos por teste: agenda limpa e independente
  // (e respeita o rate limit de criação de estabelecimentos por IP)
  owner = (await signup(ctx)).client;
  shop = await setupShop(owner);
});
afterAll(async () => {
  await ctx.close();
});

const book = (body: Record<string, unknown>, headers?: Record<string, string>) =>
  owner.post(`${shop.base}/appointments`, { newCustomer: { name: 'Cliente' }, ...body }, headers);

const startsOf = (slots: { start: string }[]) => slots.map((s) => new Date(s.start).toISOString());
const iso = (date: string, time: string) => new Date(sp(date, time)).toISOString();

describe('disponibilidade', () => {
  it('lista horários reais respeitando antecedência, jornada e grade', async () => {
    const res = await owner.get(
      `${shop.base}/availability?serviceIds=${shop.services.corte}&professionalId=${shop.professionals.joao}&from=2026-11-02&to=2026-11-02`,
    );
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.timezone).toBe('America/Sao_Paulo');
    const starts = startsOf(body.slots);
    expect(starts[0]).toBe(iso('2026-11-02', '11:00')); // agora 10:00 + 60 min
    expect(starts.at(-1)).toBe(iso('2026-11-02', '18:30'));
  });

  it('usa a duração própria do profissional (Pedro corta em 40 min) e sua jornada', async () => {
    const res = json(
      await owner.get(
        `${shop.base}/availability?serviceIds=${shop.services.corte}&professionalId=${shop.professionals.pedro}&from=2026-11-03&to=2026-11-03`,
      ),
    );
    expect(res.durationByProfessional[shop.professionals.pedro]).toBe(40);
    const starts = startsOf(res.slots);
    expect(starts[0]).toBe(iso('2026-11-03', '10:00'));
    expect(starts.at(-1)).toBe(iso('2026-11-03', '17:00')); // 17:00 + 40 = 17:40 ≤ 18:00
    expect(starts).not.toContain(iso('2026-11-03', '17:30'));
  });

  it('"qualquer profissional" junta as opções e só considera quem faz o serviço', async () => {
    const res = json(
      await owner.get(`${shop.base}/availability?serviceIds=${shop.services.coloracao}&from=2026-11-03&to=2026-11-03`),
    );
    for (const slot of res.slots) expect(slot.professionalIds).toEqual([shop.professionals.joao]);
    const both = json(await owner.get(`${shop.base}/availability?serviceIds=${shop.services.corte}&from=2026-11-03&to=2026-11-03`));
    const at11 = both.slots.find((s: { start: string }) => new Date(s.start).toISOString() === iso('2026-11-03', '11:00'));
    expect(at11.professionalIds).toHaveLength(2);
  });

  it('serviço que o profissional não faz → 422', async () => {
    const res = await owner.get(
      `${shop.base}/availability?serviceIds=${shop.services.coloracao}&professionalId=${shop.professionals.pedro}&from=2026-11-03&to=2026-11-03`,
    );
    expect(res.statusCode).toBe(422);
    expect(json(res).error.code).toBe('PROFESSIONAL_CANNOT_PERFORM');
  });

  it('folga e feriado somem da disponibilidade', async () => {
    await owner.post(`${shop.base}/time-off`, {
      professionalId: shop.professionals.joao,
      kind: 'BLOCK',
      startsAt: sp('2026-11-03', '14:00'),
      endsAt: sp('2026-11-03', '16:00'),
    });
    await owner.post(`${shop.base}/closures`, {
      kind: 'HOLIDAY',
      title: 'Proclamação da República',
      startsAt: sp('2026-11-04', '00:00'),
      endsAt: sp('2026-11-05', '00:00'),
    });
    const res = json(
      await owner.get(
        `${shop.base}/availability?serviceIds=${shop.services.corte}&professionalId=${shop.professionals.joao}&from=2026-11-03&to=2026-11-04`,
      ),
    );
    const starts = startsOf(res.slots);
    expect(starts).toContain(iso('2026-11-03', '13:30'));
    expect(starts).not.toContain(iso('2026-11-03', '14:00'));
    expect(starts).not.toContain(iso('2026-11-03', '15:30'));
    expect(starts).toContain(iso('2026-11-03', '16:00'));
    expect(starts.some((s) => s.startsWith('2026-11-04'))).toBe(false);
  });
});

describe('criação de agendamentos', () => {
  it('agenda com cliente novo, congela preço/duração e aparece na agenda', async () => {
    const res = await book({
      newCustomer: { name: 'Carlos Lima', phone: '(11) 99999-1111' },
      professionalId: shop.professionals.joao,
      serviceIds: [shop.services.corte, shop.services.barba],
      startsAt: sp('2026-11-03', '10:00'),
    });
    expect(res.statusCode).toBe(201);
    const a = json(res);
    expect(a.status).toBe('CONFIRMED');
    expect(a.totalDurationMin).toBe(60);
    expect(a.totalPriceCents).toBe(8000);
    expect(new Date(a.endsAt).toISOString()).toBe(iso('2026-11-03', '11:00'));
    expect(new Date(a.blockedUntil).toISOString()).toBe(iso('2026-11-03', '11:10')); // +10 min de limpeza da barba
    expect(a.items.map((i: { serviceName: string }) => i.serviceName)).toEqual(['Corte', 'Barba']);
    expect(a.customer.phone).toBe('+5511999991111');

    const list = json(await owner.get(`${shop.base}/appointments?from=2026-11-03&to=2026-11-03`)).appointments;
    expect(list.map((x: { id: string }) => x.id)).toEqual([a.id]);
  });

  it('reutiliza o cliente existente pelo telefone (sem duplicar cadastro)', async () => {
    const first = json(await book({ newCustomer: { name: 'Maria', phone: '11 98888-2222' }, professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:00') }));
    const second = json(await book({ newCustomer: { name: 'Maria S.', phone: '+55 11 98888-2222' }, professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '11:00') }));
    expect(second.customer.id).toBe(first.customer.id);
  });

  it('preço "a partir de" fica marcado como estimativa', async () => {
    const a = json(await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.coloracao], startsAt: sp('2026-11-03', '10:00') }));
    expect(a.priceIsEstimate).toBe(true);
    expect(a.totalPriceCents).toBe(12000);
  });

  it.each([
    ['domingo (fechado)', sp('2026-11-08', '10:00'), 'CLOSED'],
    ['depois do fechamento', sp('2026-11-03', '18:45'), 'CLOSED'],
    ['no passado', sp('2026-11-02', '08:00'), 'IN_PAST'],
  ])('recusa horário inválido: %s', async (_label, startsAt, reason) => {
    const res = await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt });
    expect(res.statusCode).toBe(409);
    expect(json(res).error).toMatchObject({ code: 'SLOT_UNAVAILABLE', details: { reason } });
  });

  it('recusa fora da jornada do profissional', async () => {
    const res = await book({ professionalId: shop.professionals.pedro, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '09:00') });
    expect(json(res).error.details.reason).toBe('OUTSIDE_WORKING_HOURS');
  });

  it('recusa conflito, inclusive com o intervalo de limpeza do anterior', async () => {
    expect((await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.barba], startsAt: sp('2026-11-03', '10:00') })).statusCode).toBe(201);
    const overlap = await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:30') });
    expect(overlap.statusCode).toBe(409);
    expect(json(overlap).error.details.reason).toBe('CONFLICT');
    const after = await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:40') });
    expect(after.statusCode).toBe(201);
  });

  it('CONCORRÊNCIA: 15 pedidos simultâneos pelo mesmo horário → 1 confirmado, 14 recusados', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        book({ newCustomer: { name: `Cliente ${i}` }, professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '16:00') }),
      ),
    );
    const codes = attempts.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(14);
    const list = json(await owner.get(`${shop.base}/appointments?from=2026-11-03&to=2026-11-03`)).appointments;
    expect(list).toHaveLength(1);
  });

  it('CONCORRÊNCIA com "qualquer profissional": 6 pedidos, 2 profissionais → exatamente 2 reservas', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        book({ newCustomer: { name: `Cliente ${i}` }, serviceIds: [shop.services.barba], startsAt: sp('2026-11-03', '11:00') }),
      ),
    );
    const ok = attempts.filter((r) => r.statusCode === 201).map((r) => json(r).professional.id);
    expect(ok).toHaveLength(2);
    expect(new Set(ok)).toEqual(new Set([shop.professionals.joao, shop.professionals.pedro]));
    for (const r of attempts.filter((x) => x.statusCode !== 201)) expect(r.statusCode).toBe(409);
  });

  it('"qualquer profissional" distribui para o menos ocupado', async () => {
    // João já tem dois atendimentos no dia; Pedro, nenhum
    await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:00') });
    await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:30') });
    const a = json(await book({ serviceIds: [shop.services.barba], startsAt: sp('2026-11-03', '14:00') }));
    expect(a.professional.id).toBe(shop.professionals.pedro);
  });

  it('idempotência: a mesma chave não duplica a reserva', async () => {
    const body = { professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '12:00') };
    const key = `teste-${Date.now()}`;
    const first = await book(body, { 'idempotency-key': key });
    const replay = await book(body, { 'idempotency-key': key });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(json(replay).id).toBe(json(first).id);
    // repetições simultâneas com a mesma chave também resultam em uma única reserva
    const key2 = `${key}-b`;
    const burst = await Promise.all(
      Array.from({ length: 5 }, () => book({ ...body, startsAt: sp('2026-11-03', '13:00') }, { 'idempotency-key': key2 })),
    );
    expect(new Set(burst.map((r) => json(r).id)).size).toBe(1);
  });

  it('encaixe deliberado permite sobrepor; gestor pode agendar fora do horário', async () => {
    await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:00') });
    const overbook = await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:00'), isOverbook: true });
    expect(overbook.statusCode).toBe(201);
    expect(json(overbook).isOverbook).toBe(true);
    const late = await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '19:30'), allowOutsideHours: true });
    expect(late.statusCode).toBe(201);
  });

  it('o painel pode agendar em cima da hora; política do cliente vale para disponibilidade', async () => {
    const res = await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-02', '10:15') });
    expect(res.statusCode).toBe(201);
  });
});

describe('cancelamento, remarcação e status', () => {
  it('cancelar libera o horário', async () => {
    const a = json(await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:00') }));
    const cancel = await owner.post(`${shop.base}/appointments/${a.id}/cancel`, { reason: 'Cliente pediu', cancelledBy: 'CUSTOMER' });
    expect(json(cancel).status).toBe('CANCELLED');
    expect((await owner.post(`${shop.base}/appointments/${a.id}/cancel`, {})).statusCode).toBe(409);
    const again = await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:00') });
    expect(again.statusCode).toBe(201);
    const customer = json(await owner.get(`${shop.base}/customers/${a.customer.id}`)).customer;
    expect(customer.cancellationCount).toBe(1);
  });

  it('remarcação é atômica: novo horário ocupado → nada muda', async () => {
    const a = json(await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:00') }));
    await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '15:00') });
    const fail = await owner.post(`${shop.base}/appointments/${a.id}/reschedule`, { startsAt: sp('2026-11-03', '15:00') });
    expect(fail.statusCode).toBe(409);
    expect(json(await owner.get(`${shop.base}/appointments/${a.id}`)).status).toBe('CONFIRMED');

    const ok = await owner.post(`${shop.base}/appointments/${a.id}/reschedule`, { startsAt: sp('2026-11-03', '10:15') });
    expect(ok.statusCode).toBe(200); // sobrepõe o próprio horário antigo: permitido
    const moved = json(ok);
    expect(moved.rescheduledFromId).toBe(a.id);
    expect(moved.totalPriceCents).toBe(a.totalPriceCents);
    const old = json(await owner.get(`${shop.base}/appointments/${a.id}`));
    expect(old).toMatchObject({ status: 'CANCELLED', cancelReason: 'Remarcado' });
  });

  it('remarcar para outro profissional respeita a jornada dele', async () => {
    const a = json(await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '09:00') }));
    const bad = await owner.post(`${shop.base}/appointments/${a.id}/reschedule`, { startsAt: sp('2026-11-03', '09:30'), professionalId: shop.professionals.pedro });
    expect(json(bad).error.details.reason).toBe('OUTSIDE_WORKING_HOURS');
    const ok = await owner.post(`${shop.base}/appointments/${a.id}/reschedule`, { startsAt: sp('2026-11-03', '11:00'), professionalId: shop.professionals.pedro });
    expect(json(ok).professional.id).toBe(shop.professionals.pedro);
  });

  it('concluir/falta só após o início e atualizam o CRM', async () => {
    const a = json(await book({ newCustomer: { name: 'Fiel', phone: '11 97777-3333' }, professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:00') }));
    const early = await owner.post(`${shop.base}/appointments/${a.id}/status`, { status: 'COMPLETED' });
    expect(json(early).error.code).toBe('APPOINTMENT_NOT_STARTED');
    ctx.setNow(new Date(sp('2026-11-03', '10:45')));
    const done = await owner.post(`${shop.base}/appointments/${a.id}/status`, { status: 'COMPLETED' });
    expect(json(done).status).toBe('COMPLETED');
    expect((await owner.post(`${shop.base}/appointments/${a.id}/cancel`, {})).statusCode).toBe(409);
    const c = json(await owner.get(`${shop.base}/customers/${a.customer.id}`)).customer;
    expect(c.visitsCount).toBe(1);
    expect(new Date(c.lastVisitAt).toISOString()).toBe(iso('2026-11-03', '10:00'));
  });

  it('reserva temporária vencida não bloqueia a agenda', async () => {
    const { createAppointment } = await import('../src/modules/appointments/booking');
    const { serviceContextForTest } = await import('./service-context');
    const sctx = await serviceContextForTest(ctx, shop.tenantId);
    const held = await createAppointment(
      sctx,
      { newCustomer: { name: 'Em conversa' }, professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:00'), source: 'AI_WHATSAPP' },
      { holdTtlSec: 120, customerFacing: true, forAi: true },
    );
    expect(held.appointment.status).toBe('HELD');
    expect((await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:00') })).statusCode).toBe(409);
    ctx.setNow(new Date(MONDAY_10AM.getTime() + 3 * 60_000));
    expect((await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:00') })).statusCode).toBe(201);
  });

  it('IA não pode criar encaixe nem agendar fora do horário', async () => {
    const { createAppointment } = await import('../src/modules/appointments/booking');
    const { serviceContextForTest } = await import('./service-context');
    const sctx = await serviceContextForTest(ctx, shop.tenantId);
    await expect(
      createAppointment(
        sctx,
        { newCustomer: { name: 'X' }, professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '10:00'), source: 'AI_PHONE', isOverbook: true },
        { forAi: true, customerFacing: true },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    // e respeita a antecedência mínima (60 min)
    await expect(
      createAppointment(
        sctx,
        { newCustomer: { name: 'X' }, professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-02', '10:30'), source: 'AI_PHONE' },
        { forAi: true, customerFacing: true },
      ),
    ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE', reason: 'TOO_SOON' });
  });
});

describe('bloqueios com agendamentos existentes', () => {
  it('folga sobre agendamento exige confirmação explícita', async () => {
    await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '15:00') });
    const body = { professionalId: shop.professionals.joao, kind: 'DAY_OFF', startsAt: sp('2026-11-03', '00:00'), endsAt: sp('2026-11-04', '00:00') };
    const conflict = await owner.post(`${shop.base}/time-off`, body);
    expect(conflict.statusCode).toBe(409);
    expect(json(conflict).error.details.appointments).toHaveLength(1);
    expect((await owner.post(`${shop.base}/time-off?force=true`, body)).statusCode).toBe(201);
  });

  it('profissional com agendamentos futuros não pode ser removido', async () => {
    await book({ professionalId: shop.professionals.pedro, serviceIds: [shop.services.corte], startsAt: sp('2026-11-03', '11:00') });
    const res = await owner.delete(`${shop.base}/professionals/${shop.professionals.pedro}`);
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe('PROFESSIONAL_HAS_UPCOMING_APPOINTMENTS');
  });
});

describe('dashboard com dados reais', () => {
  it('conta agendamentos, faturamento registrado (só concluídos), faltas e cancelamentos', async () => {
    const a1 = json(await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-02', '10:15') }));
    const a2 = json(await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.barba], startsAt: sp('2026-11-02', '11:00') }));
    const a3 = json(await book({ professionalId: shop.professionals.joao, serviceIds: [shop.services.corte], startsAt: sp('2026-11-02', '12:00') }));
    await book({ professionalId: shop.professionals.pedro, serviceIds: [shop.services.corte], startsAt: sp('2026-11-04', '10:00') });
    ctx.setNow(new Date(sp('2026-11-02', '12:30')));
    await owner.post(`${shop.base}/appointments/${a1.id}/status`, { status: 'COMPLETED' });
    await owner.post(`${shop.base}/appointments/${a2.id}/status`, { status: 'NO_SHOW' });
    await owner.post(`${shop.base}/appointments/${a3.id}/cancel`, { cancelledBy: 'CUSTOMER' });

    const s = json(await owner.get(`${shop.base}/dashboard/summary`));
    expect(s.date).toBe('2026-11-02');
    expect(s.appointments.today).toBe(2); // concluído + falta (cancelado não conta)
    expect(s.appointments.week).toBe(3);
    expect(s.revenue.registeredThisMonthCents).toBe(4500);
    expect(s.quality).toEqual({ cancellationsThisMonth: 1, noShowsThisMonth: 1 });
    expect(s.channels).toEqual({ phone: null, whatsapp: null });
    expect(s.occupancy.weekRate).toBeGreaterThan(0);
    expect(s.occupancy.weekRate).toBeLessThan(1);
    expect(s.topProfessionals[0].professionalId).toBe(shop.professionals.joao);
    expect(s.todayAgenda.map((x: { id: string }) => x.id)).toEqual([a1.id, a2.id]);
  });
});
