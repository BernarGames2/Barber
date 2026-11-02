import { describe, expect, it } from 'vitest';
import {
  countEmojis,
  dateToSpeech,
  durationToSpeech,
  numberToWordsPt,
  priceToSpeech,
  stripEmojis,
  stripMarkup,
  timeToSpeech,
  toSpeechText,
} from '../src/speech/pt-br';
import { brazilMobileVariants, formatPhoneDisplay, maskPhone, normalizePhone } from '../src/phone';
import { describePrice, formatBRL, parseBRL } from '../src/money';
import { isUuid, uuidv7, uuidv7Timestamp } from '../src/ids';

describe('números por extenso', () => {
  it.each([
    [0, 'zero'],
    [1, 'um'],
    [16, 'dezesseis'],
    [21, 'vinte e um'],
    [100, 'cem'],
    [101, 'cento e um'],
    [245, 'duzentos e quarenta e cinco'],
    [1000, 'mil'],
    [1001, 'mil e um'],
    [1100, 'mil e cem'],
    [1234, 'mil duzentos e trinta e quatro'],
    [2050, 'dois mil e cinquenta'],
    [1_000_000, 'um milhão'],
  ])('%i → %s', (n, words) => expect(numberToWordsPt(n)).toBe(words));

  it('feminino para horas', () => {
    expect(numberToWordsPt(2, 'f')).toBe('duas');
    expect(numberToWordsPt(21, 'f')).toBe('vinte e uma');
  });
});

describe('fala', () => {
  it('preços', () => {
    expect(priceToSpeech(4500)).toBe('quarenta e cinco reais');
    expect(priceToSpeech(4550)).toBe('quarenta e cinco reais e cinquenta centavos');
    expect(priceToSpeech(100)).toBe('um real');
    expect(priceToSpeech(1)).toBe('um centavo');
    expect(priceToSpeech(150000)).toBe('mil e quinhentos reais');
  });

  it('horários nos dois estilos', () => {
    expect(timeToSpeech('15:00')).toBe('quinze horas');
    expect(timeToSpeech('15:30')).toBe('quinze e trinta');
    expect(timeToSpeech('01:00')).toBe('uma hora');
    expect(timeToSpeech('12:00')).toBe('meio-dia');
    expect(timeToSpeech('12:30')).toBe('meio-dia e meia');
    expect(timeToSpeech('15:30', 'coloquial')).toBe('três e meia da tarde');
    expect(timeToSpeech('09:15', 'coloquial')).toBe('nove e quinze da manhã');
    expect(timeToSpeech('20:00', 'coloquial')).toBe('oito da noite');
  });

  it('datas e durações', () => {
    expect(dateToSpeech('2026-11-06')).toBe('sexta-feira, dia seis de novembro');
    expect(dateToSpeech('2026-12-01', { includeWeekday: false })).toBe('dia primeiro de dezembro');
    expect(durationToSpeech(40)).toBe('quarenta minutos');
    expect(durationToSpeech(90)).toBe('uma hora e meia');
    expect(durationToSpeech(120)).toBe('duas horas');
  });

  it('toSpeechText limpa emojis/markdown e verbaliza valores', () => {
    expect(toSpeechText('O corte fica *R$ 45,00* 💈 e dura 40 min.')).toBe(
      'O corte fica quarenta e cinco reais e dura quarenta minutos.',
    );
    expect(toSpeechText('Tenho 15h30 ou 16h, na sexta 06/11.')).toBe(
      'Tenho quinze e trinta ou dezesseis horas, na sexta seis de novembro.',
    );
    expect(toSpeechText('Valor: R$ 1.250,50')).toBe(
      'Valor: mil duzentos e cinquenta reais e cinquenta centavos',
    );
  });

  it('emojis', () => {
    expect(stripEmojis('Fechado! 👍🏽✂️💈')).toBe('Fechado!');
    expect(countEmojis('Oi 😀 tudo bem? 👍')).toBe(2);
    expect(stripMarkup('**Corte** _premium_ ~ok~')).toBe('Corte premium ok');
  });
});

describe('telefone', () => {
  it('normaliza para E.164', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('+5511987654321');
    expect(normalizePhone('+55 21 3456-7890')).toBe('+552134567890');
    expect(normalizePhone('11987654321')).toBe('+5511987654321');
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('formata e mascara', () => {
    expect(formatPhoneDisplay('+5511987654321')).toBe('(11) 98765-4321');
    expect(maskPhone('+5511987654321')).toBe('+5511*****4321');
  });

  it('variantes com/sem nono dígito (WhatsApp legado)', () => {
    expect(brazilMobileVariants('+5511987654321')).toEqual(['+5511987654321', '+551187654321']);
    expect(brazilMobileVariants('+551187654321')).toEqual(['+5511987654321', '+551187654321']);
    expect(brazilMobileVariants('+552134567890')).toEqual(['+552134567890']);
  });
});

describe('dinheiro', () => {
  it('formata e interpreta BRL', () => {
    expect(formatBRL(4550)).toBe('R$ 45,50');
    expect(parseBRL('45')).toBe(4500);
    expect(parseBRL('45,5')).toBe(4550);
    expect(parseBRL('R$ 1.234,56')).toBe(123456);
    expect(parseBRL('45.90')).toBe(4590);
    expect(parseBRL('abc')).toBeNull();
  });

  it('descreve preço sem inventar valores', () => {
    expect(describePrice(4500, 'FIXED')).toBe('R$ 45,00');
    expect(describePrice(12000, 'STARTING_AT')).toBe('a partir de R$ 120,00');
    expect(describePrice(null, 'ON_REQUEST')).toBe('sob consulta');
  });
});

describe('uuidv7', () => {
  it('gera UUIDs v7 válidos, únicos e ordenados no tempo', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe('7');
    expect(a < b).toBe(true);
    expect(uuidv7Timestamp(a)).toBe(1_700_000_000_000);
    const many = new Set(Array.from({ length: 2000 }, () => uuidv7()));
    expect(many.size).toBe(2000);
  });
});
