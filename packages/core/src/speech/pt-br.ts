import { MONTH_NAMES_PT, WEEKDAY_NAMES_PT, type IsoWeekday, weekdayOf } from '../time/zone';

/**
 * Preparação de texto para síntese de voz (TTS) em português do Brasil.
 * Motores de TTS leem "15h30" ou "R$ 45,00" de forma imprevisível; por isso a
 * recepcionista converte valores para palavras antes de falar.
 */

const UNITS_M = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const UNITS_F = ['zero', 'uma', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const TEENS = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS_M = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
const HUNDREDS_F = ['', 'cento', 'duzentas', 'trezentas', 'quatrocentas', 'quinhentas', 'seiscentas', 'setecentas', 'oitocentas', 'novecentas'];

export type Gender = 'm' | 'f';

function below1000(n: number, g: Gender): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push((g === 'f' ? HUNDREDS_F : HUNDREDS_M)[h]!);
  if (rest > 0) {
    if (rest < 10) parts.push((g === 'f' ? UNITS_F : UNITS_M)[rest]!);
    else if (rest < 20) parts.push(TEENS[rest - 10]!);
    else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      parts.push(u ? `${TENS[t]} e ${(g === 'f' ? UNITS_F : UNITS_M)[u]}` : TENS[t]!);
    }
  }
  return parts.join(' e ');
}

/** Número inteiro (0 a 999.999.999) por extenso. */
export function numberToWordsPt(n: number, gender: Gender = 'm'): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) throw new RangeError(`Número fora do suportado: ${n}`);
  if (n === 0) return 'zero';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(millions === 1 ? 'um milhão' : `${below1000(millions, 'm')} milhões`);
  if (thousands) parts.push(thousands === 1 ? 'mil' : `${below1000(thousands, gender)} mil`);
  if (rest) parts.push(below1000(rest, gender));
  // conector "e" antes do último grupo quando ele é < 100 ou centena redonda ("mil e cem")
  if (parts.length > 1 && (rest < 100 || rest % 100 === 0) && rest > 0) {
    const last = parts.pop()!;
    return `${parts.join(' ')} e ${last}`;
  }
  return parts.join(' ');
}

/** Valor em centavos por extenso: 4550 → "quarenta e cinco reais e cinquenta centavos". */
export function priceToSpeech(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new RangeError('Valor inválido');
  const reais = Math.floor(cents / 100);
  const cent = cents % 100;
  const parts: string[] = [];
  if (reais > 0) {
    const r = numberToWordsPt(reais);
    const needsDe = reais >= 1_000_000 && reais % 1_000_000 === 0;
    parts.push(`${r}${needsDe ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (cent > 0) parts.push(`${numberToWordsPt(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return parts.length ? parts.join(' e ') : 'zero real';
}

export type ClockStyle = '24h' | 'coloquial';

/**
 * Horário 'HH:mm' para fala.
 * - 24h (padrão, formal e claro ao telefone): "quinze horas", "quinze e trinta", "nove e quinze".
 * - coloquial: "três da tarde", "três e meia da tarde", "meio-dia e meia".
 */
export function timeToSpeech(time: string, style: ClockStyle = '24h'): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) throw new RangeError(`Hora inválida: ${time}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 12 && min === 0) return 'meio-dia';
  if (h === 0 && min === 0) return 'meia-noite';
  if (h === 12 && min === 30) return 'meio-dia e meia';

  if (style === '24h') {
    const hw = numberToWordsPt(h, 'f');
    if (min === 0) return `${hw} ${h === 1 ? 'hora' : 'horas'}`;
    return `${hw} e ${numberToWordsPt(min)}`;
  }

  const period = h < 12 ? 'da manhã' : h < 18 ? 'da tarde' : 'da noite';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const hw = h12 === 12 ? 'meio-dia' : numberToWordsPt(h12, 'f');
  const suffix = h12 === 12 ? '' : ` ${period}`;
  if (min === 0) return `${hw}${suffix}`;
  if (min === 30) return `${hw} e meia${suffix}`;
  return `${hw} e ${numberToWordsPt(min)}${suffix}`;
}

/** 'YYYY-MM-DD' → "sexta-feira, dia seis de novembro". */
export function dateToSpeech(date: string, opts: { includeWeekday?: boolean } = {}): string {
  const [, mm, dd] = date.split('-').map(Number) as [number, number, number];
  const dayWords = dd === 1 ? 'primeiro' : numberToWordsPt(dd);
  const base = `dia ${dayWords} de ${MONTH_NAMES_PT[mm - 1]}`;
  if (opts.includeWeekday === false) return base;
  return `${WEEKDAY_NAMES_PT[weekdayOf(date) as IsoWeekday]}, ${base}`;
}

/** Duração em minutos para fala: 90 → "uma hora e meia"; 40 → "quarenta minutos". */
export function durationToSpeech(minutes: number): string {
  if (minutes < 60) return `${numberToWordsPt(minutes)} ${minutes === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hw = `${numberToWordsPt(h, 'f')} ${h === 1 ? 'hora' : 'horas'}`;
  if (m === 0) return hw;
  if (m === 30) return `${hw} e meia`;
  return `${hw} e ${numberToWordsPt(m)} minutos`;
}

const EMOJI_RE = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|‍|️|⃣|[\u{1f3fb}-\u{1f3ff}])/gu;

export function stripEmojis(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
}

export function countEmojis(text: string): number {
  return (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
}

/** Remove marcações (markdown/WhatsApp) que não fazem sentido na fala. */
export function stripMarkup(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~|~)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/[*_~#>|]/g, ' ');
}

function parseBrlAmount(raw: string): number | null {
  const clean = raw.replace(/\s/g, '');
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(clean);
  if (!m) return null;
  const reais = Number(m[1]!.replace(/\./g, ''));
  const cents = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return reais * 100 + cents;
}

export interface SpeechOptions {
  clockStyle?: ClockStyle;
}

/**
 * Converte texto escrito em texto "falável" para o TTS:
 * remove emojis e markdown, transforma preços, horários e datas em palavras.
 */
export function toSpeechText(text: string, opts: SpeechOptions = {}): string {
  const style = opts.clockStyle ?? '24h';
  let out = stripMarkup(stripEmojis(text));

  out = out.replace(/R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/g, (match, amount: string) => {
    const cents = parseBrlAmount(amount);
    return cents === null ? match : priceToSpeech(cents);
  });

  // 15h30, 15:30, 15h, 9h → fala
  out = out.replace(/\b([01]?\d|2[0-3])(?::|h)([0-5]\d)\b/g, (_, h: string, m: string) =>
    timeToSpeech(`${h.padStart(2, '0')}:${m}`, style),
  );
  out = out.replace(/\b([01]?\d|2[0-3])\s?h(?:s|rs)?\b/g, (_, h: string) => timeToSpeech(`${h.padStart(2, '0')}:00`, style));

  // 06/11 → dia seis de novembro
  out = out.replace(/\b([0-2]?\d|3[01])\/(0?[1-9]|1[0-2])(?:\/\d{2,4})?\b/g, (_, d: string, mo: string) => {
    const dd = Number(d);
    const dayWords = dd === 1 ? 'primeiro' : numberToWordsPt(dd);
    return `${dayWords} de ${MONTH_NAMES_PT[Number(mo) - 1]}`;
  });

  out = out
    .replace(/\b(\d+)\s?min\b/g, (_, n: string) => `${numberToWordsPt(Number(n))} minutos`)
    .replace(/\bSr\.\s?/g, 'senhor ')
    .replace(/\bSra\.\s?/g, 'senhora ')
    .replace(/\bn[º°]\s?/gi, 'número ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return out;
}
