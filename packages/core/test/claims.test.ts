import { describe, expect, it } from 'vitest';
import {
  type ClaimEvidence,
  EMPTY_EVIDENCE,
  extractClaims,
  extractTimes,
  normalizeForClaims,
  numberWordsToDigitsPt,
  verifyClaims,
} from '../src';

// segunda-feira, 02/11/2026, 10:00 em São Paulo
const ctx = { now: Date.parse('2026-11-02T13:00:00Z'), timezone: 'America/Sao_Paulo' };

const evidence: ClaimEvidence = {
  catalogPricesCents: [4500, 3000, 9000],
  quotedPricesCents: [],
  slots: [
    { date: '2026-11-03', time: '14:00' },
    { date: '2026-11-03', time: '15:30' },
    { date: '2026-11-06', time: '10:00' },
  ],
  customerTimes: [],
  businessHours: [
    { weekday: 1, start: '09:00', end: '19:00' },
    { weekday: 6, start: '09:00', end: '14:00' },
  ],
  actions: { booked: false, held: false, cancelled: false, rescheduled: false },
};

const check = (text: string, ev: Partial<ClaimEvidence> = {}) =>
  verifyClaims(extractClaims(text, ctx), { ...evidence, ...ev });
const codes = (text: string, ev: Partial<ClaimEvidence> = {}) => check(text, ev).map((v) => v.code);

describe('números por extenso', () => {
  it.each([
    ['quarenta e cinco reais', '45 reais'],
    ['cento e vinte e cinco', '125'],
    ['quinze e trinta', '15 e 30'],
    ['quatorze e quarenta e cinco', '14 e 45'],
    ['mil e quinhentos', '1500'],
    ['dois mil', '2000'],
    ['mil duzentos e trinta', '1230'],
    ['vinte e duas', '22'],
    ['corte e barba', 'corte e barba'],
    ['um corte e uma barba', '1 corte e 1 barba'],
    ['cem reais', '100 reais'],
  ])('%s → %s', (input, expected) => {
    expect(numberWordsToDigitsPt(input)).toBe(expected);
  });

  it('normaliza meio-dia, acentos e marcação do WhatsApp', () => {
    expect(normalizeForClaims('*Meio-dia* às Três')).toBe('12:00 as 3');
  });
});

describe('extração de horários', () => {
  it.each([
    ['às 14h', ['14:00']],
    ['às 14h30', ['14:30']],
    ['às 14:30', ['14:30']],
    ['às quinze e trinta', ['15:30']],
    ['às duas da tarde', ['14:00']],
    ['às três e meia', ['03:30', '15:30']],
    ['quinze para as cinco', ['04:45', '16:45']],
    ['ao meio-dia', ['12:00']],
    ['às 9 da manhã', ['09:00']],
    ['às quatorze horas e trinta minutos', ['14:30']],
  ])('%s', (text, expected) => {
    expect(extractTimes(text)).toEqual(expected);
  });

  it('durações e quantidades não são horários', () => {
    expect(extractTimes('O corte dura 1h.')).toEqual([]);
    expect(extractTimes('Leva cerca de 2 horas.')).toEqual([]);
    expect(extractTimes('São 2 horas de duração.')).toEqual([]);
    expect(extractTimes('Escolha uma das 3 opções.')).toEqual([]);
    expect(extractTimes('Leva uns 40 minutos.')).toEqual([]);
  });
});

describe('verificação de preços', () => {
  it('aceita preço do catálogo, inclusive por extenso', () => {
    expect(codes('O corte custa R$ 45,00.')).toEqual([]);
    expect(codes('O corte fica quarenta e cinco reais.')).toEqual([]);
    expect(codes('Temos o combo por R$90.')).toEqual([]);
  });

  it('aceita soma de serviços do catálogo', () => {
    expect(codes('Corte e barba saem por R$ 75.')).toEqual([]);
  });

  it('bloqueia preço inventado', () => {
    expect(codes('O corte custa R$ 50.')).toEqual(['UNVERIFIED_PRICE']);
    expect(codes('O corte fica cinquenta reais.')).toEqual(['UNVERIFIED_PRICE']);
    expect(codes('O pacote sai por R$ 1.200,00.')).toEqual(['UNVERIFIED_PRICE']);
    expect(codes('Fica 45,90 reais.')).toEqual(['UNVERIFIED_PRICE']);
  });

  it('aceita valor devolvido por ferramenta (total da reserva)', () => {
    expect(codes('O total fica R$ 82,50.', { quotedPricesCents: [8250] })).toEqual([]);
  });
});

describe('verificação de horários', () => {
  it('aceita horários devolvidos pela agenda para a data citada', () => {
    expect(codes('Tenho amanhã às 14h e às 15h30.')).toEqual([]);
    expect(codes('Na sexta tenho às 10h.')).toEqual([]);
    expect(codes('Amanhã tenho às duas da tarde ou às três e meia da tarde.')).toEqual([]);
  });

  it('bloqueia horário que a agenda não devolveu', () => {
    expect(codes('Tenho amanhã às 16h.')).toEqual(['UNVERIFIED_TIME']);
  });

  it('bloqueia horário real atribuído à data errada', () => {
    // 14h existe na terça, não na sexta
    expect(codes('Na sexta tenho às 14h.')).toEqual(['UNVERIFIED_TIME']);
  });

  it('herda a data da frase anterior (lista no WhatsApp)', () => {
    expect(codes('Para amanhã tenho:\n• 14h\n• 15h30')).toEqual([]);
    expect(codes('Para sexta tenho:\n• 14h')).toEqual(['UNVERIFIED_TIME']);
  });

  it('aceita limites do horário de funcionamento quando o assunto é funcionamento', () => {
    expect(codes('Funcionamos das 9h às 19h.')).toEqual([]);
    expect(codes('Abrimos às 8h.')).toEqual(['UNVERIFIED_TIME']);
    // fora do contexto de funcionamento, 9h precisa ter vindo da agenda
    expect(codes('Tenho amanhã às 9h.')).toEqual(['UNVERIFIED_TIME']);
  });

  it('aceita repetir o horário que o próprio cliente pediu', () => {
    expect(codes('Às 17h não tenho, mas tenho amanhã às 15h30.', { customerTimes: ['17:00'] })).toEqual([]);
  });
});

describe('verificação de ações (agendado, reservado, cancelado, remarcado)', () => {
  it('bloqueia "confirmado" sem confirmação real', () => {
    expect(codes('Pronto, seu horário está confirmado!')).toEqual(['UNCONFIRMED_ACTION']);
    expect(codes('Agendado! Te esperamos amanhã às 14h.')).toEqual(['UNCONFIRMED_ACTION']);
    expect(codes('Já marquei para você.')).toEqual(['UNCONFIRMED_ACTION']);
  });

  it('aceita depois da confirmação', () => {
    const ev = { actions: { ...evidence.actions, booked: true } };
    expect(codes('Pronto, seu horário está confirmado!', ev)).toEqual([]);
    expect(codes('Agendado! Te esperamos amanhã às 14h.', ev)).toEqual([]);
  });

  it('perguntas, negações e condicionais não são afirmações', () => {
    expect(codes('Posso confirmar para amanhã às 14h?')).toEqual([]);
    expect(codes('Posso deixar agendado?')).toEqual([]);
    expect(codes('Se você confirmar, fica agendado.')).toEqual([]);
    expect(codes('Ainda não está confirmado.')).toEqual([]);
    expect(codes('Para deixar agendado, preciso do seu nome.')).toEqual([]);
    expect(codes('Vou confirmar agora mesmo.')).toEqual([]);
  });

  it('reserva temporária', () => {
    expect(codes('Reservei o horário por 10 minutos enquanto você confirma.')).toEqual([
      'UNCONFIRMED_ACTION',
    ]);
    expect(
      codes('Reservei o horário por 10 minutos enquanto você confirma.', {
        actions: { ...evidence.actions, held: true },
      }),
    ).toEqual([]);
  });

  it('cancelamento e remarcação exigem sucesso da ferramenta', () => {
    expect(codes('Seu agendamento foi cancelado.')).toEqual(['UNCONFIRMED_ACTION']);
    expect(
      codes('Seu agendamento foi cancelado.', { actions: { ...evidence.actions, cancelled: true } }),
    ).toEqual([]);
    expect(
      codes('Remarquei para sexta às 10h.', { actions: { ...evidence.actions, rescheduled: true } }),
    ).toEqual([]);
    expect(codes('Remarquei para sexta às 10h.')).toEqual(['UNCONFIRMED_ACTION']);
  });

  it('respostas sem fatos passam mesmo sem evidência', () => {
    expect(verifyClaims(extractClaims('Olá! Como posso ajudar?', ctx), EMPTY_EVIDENCE)).toEqual([]);
    expect(verifyClaims(extractClaims('Qual serviço você gostaria de fazer?', ctx), EMPTY_EVIDENCE)).toEqual(
      [],
    );
  });

  it('mensagens de violação explicam o problema em português', () => {
    const [v] = check('O corte custa R$ 50.');
    expect(v?.message).toContain('R$ 50,00');
  });
});
