import { describe, expect, it } from 'vitest';
import { describeTemporalResolution, resolveTemporalExpression } from '../src/nlp/temporal-pt';
import { localToInstant } from '../src/time/zone';

const TZ = 'America/Sao_Paulo';
// Segunda-feira, 2 de novembro de 2026, 10:00
const MONDAY = { now: localToInstant('2026-11-02', '10:00', TZ), timezone: TZ };
// Quarta-feira, 4 de novembro de 2026
const WEDNESDAY = { now: localToInstant('2026-11-04', '10:00', TZ), timezone: TZ };
// Quinta-feira, 5 de novembro de 2026
const THURSDAY = { now: localToInstant('2026-11-05', '10:00', TZ), timezone: TZ };

const r = (text: string, ctx = MONDAY) => resolveTemporalExpression(text, ctx);
const day = (d: string) => ({ from: d, to: d });

describe('datas relativas', () => {
  it.each([
    ['amanhã', '2026-11-03'],
    ['Amanhã!', '2026-11-03'],
    ['depois de amanhã', '2026-11-04'],
    ['hoje', '2026-11-02'],
    ['hj', '2026-11-02'],
    ['daqui a 3 dias', '2026-11-05'],
    ['daqui a três dias', '2026-11-05'],
    ['daqui a uma semana', '2026-11-09'],
    ['daqui a duas semanas', '2026-11-16'],
    ['sexta-feira', '2026-11-06'],
    ['sexta feira', '2026-11-06'],
    ['no sábado', '2026-11-07'],
    ['domingo', '2026-11-08'],
    ['quinta da semana que vem', '2026-11-12'],
    ['semana que vem na quinta', '2026-11-12'],
    ['na outra sexta', '2026-11-13'],
    ['próxima segunda', '2026-11-09'],
  ])('"%s" → %s', (text, date) => {
    const res = r(text);
    expect(res.recognized).toBe(true);
    expect(res.dates).toEqual(day(date));
  });

  it('"na semana que vem" vira a semana inteira (segunda a domingo)', () => {
    expect(r('na semana que vem').dates).toEqual({ from: '2026-11-09', to: '2026-11-15' });
  });

  it('"esta semana" vai de hoje até domingo', () => {
    expect(r('ainda esta semana').dates).toEqual({ from: '2026-11-02', to: '2026-11-08' });
  });

  it('"fim de semana" e "mês que vem"', () => {
    expect(r('no fim de semana').dates).toEqual({ from: '2026-11-07', to: '2026-11-08' });
    expect(r('mês que vem').dates).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(r('em dezembro').dates).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('"segunda" dita numa segunda-feira é ambígua (hoje ou a próxima)', () => {
    const res = r('segunda');
    expect(res.dates).toEqual(day('2026-11-02'));
    expect(res.dateCandidates).toEqual(['2026-11-02', '2026-11-09']);
    expect(res.ambiguities.length).toBeGreaterThan(0);
  });

  it('"terça que vem" dita na véspera é ambígua (amanhã ou a seguinte)', () => {
    const res = r('terça que vem');
    expect(res.dates).toEqual(day('2026-11-03'));
    expect(res.dateCandidates).toEqual(['2026-11-03', '2026-11-10']);
    expect(res.ambiguities[0]).toMatch(/pode ser/);
  });

  it('"sexta que vem" numa quinta é ambígua; "próxima segunda" numa quinta não', () => {
    const sexta = r('sexta que vem', THURSDAY);
    expect(sexta.dateCandidates).toEqual(['2026-11-06', '2026-11-13']);
    const seg = r('próxima segunda', THURSDAY);
    expect(seg.dates).toEqual(day('2026-11-09'));
    expect(seg.ambiguities).toEqual([]);
  });

  it('"segunda ou terça" retorna as opções sem marcar conflito', () => {
    const res = r('pode ser segunda ou terça', WEDNESDAY);
    expect(res.dateCandidates).toEqual(['2026-11-09', '2026-11-10']);
    expect(res.dates).toEqual({ from: '2026-11-09', to: '2026-11-10' });
    expect(res.ambiguities).toEqual([]);
  });

  it('marca o passado', () => {
    expect(r('ontem').pastDate).toBe(true);
    expect(r('01/10/2026').pastDate).toBe(true);
  });
});

describe('datas explícitas', () => {
  it.each([
    ['dia 15', '2026-11-15'],
    ['dia 1', '2026-12-01'],
    ['dia 31', '2026-12-31'],
    ['15/11', '2026-11-15'],
    ['01/02', '2027-02-01'],
    ['20/12/2026', '2026-12-20'],
    ['20 de dezembro', '2026-12-20'],
    ['dia 20 de dezembro', '2026-12-20'],
    ['1º de dezembro', '2026-12-01'],
    ['15 de março', '2027-03-15'],
    ['dia 10 do mês que vem', '2026-12-10'],
  ])('"%s" → %s', (text, date) => {
    expect(r(text).dates).toEqual(day(date));
  });

  it('data inexistente é sinalizada', () => {
    const res = r('31/11');
    expect(res.dates).toBeNull();
    expect(res.recognized).toBe(true);
    expect(res.ambiguities[0]).toMatch(/não existe/);
  });

  it('dia da semana que não bate com o dia do mês gera alerta', () => {
    const res = r('sexta dia 7');
    expect(res.dateCandidates).toEqual(['2026-11-06', '2026-11-07']);
    expect(res.ambiguities[0]).toMatch(/datas diferentes/);
  });
});

describe('horários', () => {
  it.each([
    ['às 3 da tarde', '15:00'],
    ['15h30', '15:30'],
    ['15:30', '15:30'],
    ['às 15', '15:00'],
    ['às 3 e meia', '15:30'],
    ['8 da noite', '20:00'],
    ['às 10 da manhã', '10:00'],
    ['meio-dia', '12:00'],
    ['meio dia e meia', '12:30'],
    ['quinze para as cinco', '16:45'],
    ['às quinze pras cinco', '16:45'],
    ['às 2', '14:00'],
    ['às 10', '10:00'],
    ['às 15 horas e 30 minutos', '15:30'],
    ['uma e meia', '13:30'],
    ['onze e quinze', '11:15'],
    ['duas da tarde', '14:00'],
  ])('"%s" → %s', (text, time) => {
    const res = r(text);
    expect(res.time?.exact).toBe(time);
    expect(res.timeCandidates).toEqual([]);
  });

  it('"às 8" e "às 7" são ambíguos (manhã ou noite)', () => {
    expect(r('às 8').timeCandidates).toEqual(['08:00', '20:00']);
    expect(r('às 7').timeCandidates).toEqual(['07:00', '19:00']);
    expect(r('às 8').ambiguities[0]).toMatch(/ambíguo/);
  });

  it('a faixa plausível (horário do estabelecimento) desambigua', () => {
    const ctx = { ...MONDAY, plausibleHours: { from: '09:00', to: '20:00' } };
    expect(r('às 8', ctx).time?.exact).toBe('20:00');
    const ctx2 = { ...MONDAY, plausibleHours: { from: '09:00', to: '19:30' } };
    expect(r('às 8', ctx2).time?.exact).toBe('08:00');
  });

  it('o período falado desambigua ("de noite às 8", "de manhã às 9")', () => {
    expect(r('hoje de noite às 8').time).toMatchObject({ exact: '20:00', label: 'noite' });
    expect(r('amanhã de manhã às 9')).toMatchObject({ dates: day('2026-11-03'), time: { exact: '09:00' } });
  });

  it('faixas e limites', () => {
    expect(r('depois das 16h').time).toEqual({ from: '16:00' });
    expect(r('antes das 11').time).toEqual({ to: '11:00' });
    expect(r('entre 14h e 16h').time).toEqual({ from: '14:00', to: '16:00' });
    expect(r('das 2 às 5').time).toEqual({ from: '14:00', to: '17:00' });
    expect(r('a partir do meio-dia').time).toEqual({ from: '12:00' });
    expect(r('à tarde depois das 15h').time).toMatchObject({ from: '15:00', to: '18:00', label: 'tarde' });
  });

  it('horário aproximado vira janela de ±30 minutos', () => {
    expect(r('amanhã umas 3')).toMatchObject({
      dates: day('2026-11-03'),
      time: { exact: '15:00', from: '14:30', to: '15:30', approximate: true },
    });
    expect(r('lá pelas 4 da tarde').time).toMatchObject({ exact: '16:00', approximate: true });
  });

  it('horários diferentes na mesma frase são sinalizados', () => {
    const res = r('amanhã às 14h ou 15h');
    expect(res.timeCandidates).toEqual(['14:00', '15:00']);
    expect(res.ambiguities[0]).toMatch(/diferentes/);
  });
});

describe('períodos do dia', () => {
  it.each([
    ['hoje à tarde', '2026-11-02', '12:00', '18:00', 'tarde'],
    ['amanhã depois do almoço', '2026-11-03', '13:00', '15:00', 'depois do almoço'],
    ['sexta-feira no final do dia', '2026-11-06', '17:00', '21:00', 'final do dia'],
    ['sexta de manhã cedo', '2026-11-06', '06:00', '10:00', 'início da manhã'],
    ['quinta no fim da tarde', '2026-11-05', '16:00', '18:30', 'fim da tarde'],
    ['amanhã depois do trabalho', '2026-11-03', '18:00', '21:00', 'depois do trabalho'],
    ['sábado de manhã', '2026-11-07', '06:00', '12:00', 'manhã'],
    ['hoje à noite', '2026-11-02', '18:00', '23:00', 'noite'],
    ['amanhã na hora do almoço', '2026-11-03', '11:30', '14:00', 'horário de almoço'],
  ])('"%s"', (text, date, from, to, label) => {
    const res = r(text);
    expect(res.dates).toEqual(day(date));
    expect(res.time).toEqual({ from, to, label });
  });

  it('"de manhã ou à tarde" é união', () => {
    expect(r('amanhã de manhã ou à tarde').time).toEqual({
      from: '06:00',
      to: '18:00',
      label: 'manhã ou tarde',
    });
  });

  it('"hoje mais tarde" começa uma hora depois de agora', () => {
    expect(r('hoje mais tarde')).toMatchObject({ dates: day('2026-11-02'), time: { from: '11:00' } });
  });
});

describe('intenções especiais e ruído', () => {
  it('primeiro horário disponível', () => {
    expect(r('o primeiro horário disponível').firstAvailable).toBe(true);
    expect(r('o mais cedo possível amanhã')).toMatchObject({
      firstAvailable: true,
      dates: day('2026-11-03'),
    });
    expect(r('qual o próximo horário livre?').firstAvailable).toBe(true);
  });

  it('"sexta agora" não é confundido com "agora mesmo"', () => {
    expect(r('sexta agora')).toMatchObject({ firstAvailable: false, dates: day('2026-11-06') });
  });

  it('mesmo horário da última vez', () => {
    expect(r('no mesmo horário da última vez').sameAsLastTime).toBe(true);
    expect(r('sexta, no horário de sempre')).toMatchObject({
      sameAsLastTime: true,
      dates: day('2026-11-06'),
    });
  });

  it('ignora saudações ("boa tarde" não é período)', () => {
    const res = r('Boa tarde! Queria marcar pra amanhã');
    expect(res.dates).toEqual(day('2026-11-03'));
    expect(res.time).toBeNull();
  });

  it('quantidades não viram horário', () => {
    const res = r('tem vaga pra 2 pessoas amanhã?');
    expect(res.dates).toEqual(day('2026-11-03'));
    expect(res.time).toBeNull();
    expect(r('quero 3 cortes amanhã às 10')).toMatchObject({
      dates: day('2026-11-03'),
      time: { exact: '10:00' },
    });
    expect(r('custa R$ 50?').recognized).toBe(false);
  });

  it('frases sem tempo não são reconhecidas', () => {
    expect(r('quero cortar o cabelo').recognized).toBe(false);
    expect(r('quanto custa a barba?').recognized).toBe(false);
    expect(r('corte e barba').recognized).toBe(false);
  });

  it('combina data, dia da semana e horário em mensagens reais de WhatsApp', () => {
    expect(r('oi, bom dia! tem horário pra hoje às 15h?')).toMatchObject({
      dates: day('2026-11-02'),
      time: { exact: '15:00' },
    });
    expect(r('sexta 15h')).toMatchObject({ dates: day('2026-11-06'), time: { exact: '15:00' } });
    expect(r('15/11 às 9h')).toMatchObject({ dates: day('2026-11-15'), time: { exact: '09:00' } });
    expect(r('dia 15 às 15')).toMatchObject({ dates: day('2026-11-15'), time: { exact: '15:00' } });
    expect(r('hj às 18h')).toMatchObject({ dates: day('2026-11-02'), time: { exact: '18:00' } });
    expect(r('sábado às 10h')).toMatchObject({ dates: day('2026-11-07'), time: { exact: '10:00' } });
  });

  it('describeTemporalResolution gera resumo em português', () => {
    expect(describeTemporalResolution(r('sexta no final do dia'))).toBe(
      'sexta-feira, 6 de novembro, entre 17:00 e 21:00',
    );
    expect(describeTemporalResolution(r('amanhã às 15h'))).toBe('terça-feira, 3 de novembro, às 15:00');
    expect(describeTemporalResolution(r('blá'))).toBe('nenhuma data ou horário reconhecido');
  });
});
