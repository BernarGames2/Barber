import { describe, expect, it } from 'vitest';
import {
  availabilityQuerySchema,
  createAppointmentSchema,
  createTenantSchema,
  customerInputSchema,
  serviceInputSchema,
  signupSchema,
  weeklyScheduleSchema,
} from '../src';

describe('contratos compartilhados (painel ↔ API)', () => {
  it('cadastro: normaliza e-mail e exige aceite dos termos', () => {
    const ok = signupSchema.safeParse({
      name: ' Ana ',
      email: ' ANA@Teste.com ',
      password: 'senhaSegura1',
      acceptTerms: true,
    });
    expect(ok.success && ok.data).toMatchObject({ name: 'Ana', email: 'ana@teste.com' });
    expect(
      signupSchema.safeParse({
        name: 'Ana',
        email: 'ana@teste.com',
        password: 'senhaSegura1',
        acceptTerms: false,
      }).success,
    ).toBe(false);
    expect(
      signupSchema.safeParse({
        name: 'Ana',
        email: 'ana@teste.com',
        password: 'somenteletras',
        acceptTerms: true,
      }).success,
    ).toBe(false);
  });

  it('estabelecimento: telefone vira E.164, CEP e UF normalizados', () => {
    const r = createTenantSchema.parse({
      name: 'Barbearia',
      category: 'BARBERSHOP',
      responsibleName: 'Léo',
      phone: '(11) 3456-7890',
      whatsappNumber: '',
      addressPostalCode: '01310100',
      addressState: 'sp',
    });
    expect(r).toMatchObject({
      phone: '+551134567890',
      whatsappNumber: null,
      addressPostalCode: '01310-100',
      addressState: 'SP',
      timezone: 'America/Sao_Paulo',
    });
  });

  it('serviço: preço obrigatório salvo "sob consulta"', () => {
    expect(serviceInputSchema.safeParse({ name: 'Corte', durationMin: 30 }).success).toBe(false);
    expect(
      serviceInputSchema.safeParse({ name: 'Mega hair', durationMin: 240, priceType: 'ON_REQUEST' }).success,
    ).toBe(true);
    expect(serviceInputSchema.safeParse({ name: 'Corte', durationMin: 3, priceCents: 100 }).success).toBe(
      false,
    );
    expect(serviceInputSchema.safeParse({ name: 'Corte', durationMin: 30, priceCents: 45.5 }).success).toBe(
      false,
    ); // centavos inteiros
  });

  it('jornada semanal: rejeita faixa invertida e sobreposição', () => {
    expect(
      weeklyScheduleSchema.safeParse([
        { weekday: 1, start: '09:00', end: '12:00' },
        { weekday: 1, start: '13:00', end: '18:00' },
      ]).success,
    ).toBe(true);
    expect(weeklyScheduleSchema.safeParse([{ weekday: 1, start: '12:00', end: '09:00' }]).success).toBe(
      false,
    );
    expect(
      weeklyScheduleSchema.safeParse([
        { weekday: 1, start: '09:00', end: '12:00' },
        { weekday: 1, start: '11:00', end: '13:00' },
      ]).success,
    ).toBe(false);
    expect(weeklyScheduleSchema.safeParse([{ weekday: 8, start: '09:00', end: '12:00' }]).success).toBe(
      false,
    );
  });

  it('agendamento: exige cliente existente OU novo, nunca os dois', () => {
    const base = {
      serviceIds: ['0191f0aa-0000-7000-8000-000000000001'],
      startsAt: '2026-11-03T10:00:00-03:00',
    };
    expect(createAppointmentSchema.safeParse({ ...base, newCustomer: { name: 'Carlos' } }).success).toBe(
      true,
    );
    expect(createAppointmentSchema.safeParse({ ...base }).success).toBe(false);
    expect(
      createAppointmentSchema.safeParse({
        ...base,
        customerId: '0191f0aa-0000-7000-8000-000000000002',
        newCustomer: { name: 'Carlos' },
      }).success,
    ).toBe(false);
    expect(
      createAppointmentSchema.safeParse({
        ...base,
        newCustomer: { name: 'Carlos' },
        startsAt: '2026-11-03 10:00',
      }).success,
    ).toBe(false); // sem fuso
  });

  it('disponibilidade: aceita lista separada por vírgula e valida período', () => {
    const ids = '0191f0aa-0000-7000-8000-000000000001,0191f0aa-0000-7000-8000-000000000002';
    const r = availabilityQuerySchema.parse({ serviceIds: ids, from: '2026-11-03', to: '2026-11-04' });
    expect(r.serviceIds).toHaveLength(2);
    expect(
      availabilityQuerySchema.safeParse({ serviceIds: ids, from: '2026-11-05', to: '2026-11-04' }).success,
    ).toBe(false);
  });

  it('cliente: telefone opcional, vazio vira null', () => {
    expect(customerInputSchema.parse({ name: 'Bia', phone: '' }).phone).toBeNull();
    expect(customerInputSchema.safeParse({ name: 'Bia', phone: '123' }).success).toBe(false);
  });
});
