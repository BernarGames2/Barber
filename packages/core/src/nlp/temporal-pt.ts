import { DateTime } from 'luxon';
import {
  type IsoWeekday,
  MONTH_NAMES_PT,
  addDays,
  formatLongDatePt,
  minutesToTime,
  timeToMinutes,
  todayInZone,
  weekdayOf,
} from '../time/zone';
import { normalizePt, wordsToDigitsPt } from './normalize-pt';

/**
 * Resolvedor determinístico de expressões temporais em português do Brasil.
 *
 * A recepcionista de IA NÃO calcula datas "de cabeça": ela envia o trecho dito pelo
 * cliente (ex.: "sexta no final do dia") para este resolvedor, que devolve datas e
 * faixas de horário explícitas no fuso do estabelecimento. Ambiguidades são sinalizadas
 * para que a IA confirme com o cliente antes de reservar.
 */

export interface TemporalContext {
  /** Instante de referência (epoch ms). */
  now: number;
  /** Fuso IANA do estabelecimento. */
  timezone: string;
  /** Faixa plausível de horários de início (HH:mm), usada para desambiguar "às 8". */
  plausibleHours?: { from: string; to: string };
}

export interface TimeSpec {
  /** Horário exato pedido ('HH:mm'). */
  exact?: string;
  /** Início da faixa aceitável (inclusive). */
  from?: string;
  /** Fim da faixa aceitável (inclusive), referente ao horário de início do atendimento. */
  to?: string;
  /** Rótulo humano (ex.: "depois do almoço"). */
  label?: string;
  /** Pedido aproximado ("umas 3", "por volta das 15h"). */
  approximate?: boolean;
}

export interface TemporalResolution {
  input: string;
  recognized: boolean;
  /** Período de datas locais (inclusive). */
  dates: { from: string; to: string } | null;
  /** Datas alternativas quando há ambiguidade ou opções ("segunda ou terça"). */
  dateCandidates: string[];
  time: TimeSpec | null;
  /** Horários alternativos quando o horário é ambíguo ("às 8" → 08:00 ou 20:00). */
  timeCandidates: string[];
  /** Cliente quer o primeiro horário disponível. */
  firstAvailable: boolean;
  /** Cliente quer repetir dia/horário do último atendimento. */
  sameAsLastTime: boolean;
  /** A expressão aponta para o passado (ex.: "ontem"). */
  pastDate: boolean;
  /** Motivos de ambiguidade, em PT-BR, para a IA confirmar com o cliente. */
  ambiguities: string[];
  /** Trechos reconhecidos (telemetria/depuração). */
  matched: string[];
}

const WEEKDAY_MAP: Record<string, IsoWeekday> = {
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  domingo: 7,
};

const MONTHS_NORMALIZED = MONTH_NAMES_PT.map((m) => m.normalize('NFD').replace(/[̀-ͯ]/g, ''));
const MONTH_RE = MONTHS_NORMALIZED.join('|');

interface PeriodLabel {
  re: RegExp;
  from: string;
  to: string;
  label: string;
}

/** Faixas de período do dia. A ordem importa: expressões mais específicas primeiro. */
export const PERIOD_LABELS: readonly PeriodLabel[] = [
  {
    re: /\b(?:bem cedo|logo cedo|cedinho|inicio da manha|comeco da manha|primeira hora da manha|cedo)\b/,
    from: '06:00',
    to: '10:00',
    label: 'início da manhã',
  },
  { re: /\b(?:fim da manha|final da manha|finalzinho da manha)\b/, from: '10:30', to: '12:00', label: 'fim da manhã' },
  {
    re: /\b(?:depois do almoco|apos o almoco|pos almoco|depois de almocar|depois que eu almocar)\b/,
    from: '13:00',
    to: '15:00',
    label: 'depois do almoço',
  },
  { re: /\bantes do almoco\b/, from: '08:00', to: '11:30', label: 'antes do almoço' },
  {
    re: /\b(?:na hora do almoco|hora do almoco|horario do almoco|horario de almoco|no almoco)\b/,
    from: '11:30',
    to: '14:00',
    label: 'horário de almoço',
  },
  { re: /\b(?:inicio da tarde|comeco da tarde)\b/, from: '12:00', to: '14:30', label: 'início da tarde' },
  { re: /\bmeio da tarde\b/, from: '14:00', to: '16:30', label: 'meio da tarde' },
  {
    re: /\b(?:fim da tarde|final da tarde|finalzinho da tarde|fim de tarde|final de tarde)\b/,
    from: '16:00',
    to: '18:30',
    label: 'fim da tarde',
  },
  {
    re: /\b(?:fim do dia|final do dia|finalzinho do dia|fim do expediente|final do expediente)\b/,
    from: '17:00',
    to: '21:00',
    label: 'final do dia',
  },
  {
    re: /\b(?:depois do trabalho|depois do servico|saindo do trabalho|apos o trabalho|depois do expediente)\b/,
    from: '18:00',
    to: '21:00',
    label: 'depois do trabalho',
  },
  {
    re: /\b(?:de manha|pela manha|na parte da manha|parte da manha|manhazinha|manha)\b/,
    from: '06:00',
    to: '12:00',
    label: 'manhã',
  },
  {
    re: /\b(?:a tarde|de tarde|pela tarde|na parte da tarde|parte da tarde|tardinha|(?<!mais )tarde)\b/,
    from: '12:00',
    to: '18:00',
    label: 'tarde',
  },
  { re: /\b(?:a noitinha|noitinha|a noite|de noite|pela noite|noite)\b/, from: '18:00', to: '23:00', label: 'noite' },
];

const FIRST_AVAILABLE_RE =
  /\b(?:primeiro horario(?: disponivel| livre| vago)?|primeira vaga|primeiro encaixe|horario mais cedo|mais cedo possivel|o quanto antes|quanto antes|mais rapido possivel|o mais rapido|mais proximo possivel|proximo horario(?: disponivel| livre)?|qualquer horario|o que tiver|assim que der|assim que tiver|primeira hora disponivel|agora mesmo|pra agora|para agora)\b/;

const SAME_AS_LAST_RE =
  /\b(?:mesmo horario|mesmo dia e horario|mesmo dia e hora|mesma hora|mesmo dia da semana|horario de sempre|hora de sempre|dia de sempre|igual (?:a|da|na) (?:ultima|outra) vez|como (?:a|da|na) ultima vez|que nem (?:a|da|na) ultima vez|mesmo esquema da ultima vez)\b/;

const GREETINGS_RE = /\b(?:bom dia|boa tarde|boa noite)\b/g;

/** Fragmento de regex que reconhece um horário falado/escrito (texto já normalizado). */
const TIME_TOKEN =
  String.raw`(?:\d{1,2} (?:para|pras|pra) (?:as |a )?\d{1,2}h?(?: (?:da|de) (?:manha|tarde|noite))?` +
  String.raw`|meio dia(?: e meia| e \d{1,2})?|meia noite(?: e meia)?` +
  String.raw`|\d{1,2}(?::\d{2}|h\d{2}|hs\b|h\b| horas?\b)?(?: e (?:meia|\d{1,2})(?: minutos?| min)?)?(?: (?:da|de|pela) (?:manha|tarde|noite|madrugada))?)`;

/** Impede que quantidades ("2 dias", "3 pessoas", "50 reais") sejam lidas como horário. */
const NOT_A_QUANTITY = String.raw`(?!\d)(?! ?(?:dias?|semanas?|mes|meses|anos?|\/|reais|real|pessoas?|cortes?|clientes?|filhos?|vezes|minutos?\b|min\b))`;

interface ParsedTime {
  hour: number;
  minute: number;
  period: 'manha' | 'tarde' | 'noite' | 'madrugada' | null;
  /** Possui marcador inequívoco de horário (h, :, "horas", período, "meia"...). */
  hasMarker: boolean;
}

function parseTimeToken(raw: string): ParsedTime | null {
  const tok = raw.trim();
  let m: RegExpExecArray | null;

  if ((m = /^meio dia(?: e (meia|\d{1,2}))?$/.exec(tok))) {
    const minute = m[1] === 'meia' ? 30 : m[1] ? Number(m[1]) : 0;
    return minute < 60 ? { hour: 12, minute, period: null, hasMarker: true } : null;
  }
  if ((m = /^meia noite(?: e (meia))?$/.exec(tok))) {
    return { hour: 0, minute: m[1] ? 30 : 0, period: null, hasMarker: true };
  }
  if ((m = /^(\d{1,2}) (?:para|pras|pra) (?:as |a )?(\d{1,2})h?(?: (?:da|de) (manha|tarde|noite))?$/.exec(tok))) {
    const before = Number(m[1]);
    const target = Number(m[2]);
    if (before <= 0 || before >= 60 || target > 23 || target === 0) return null;
    const total = target * 60 - before;
    return {
      hour: Math.floor(total / 60),
      minute: total % 60,
      period: (m[3] as ParsedTime['period']) ?? null,
      hasMarker: true,
    };
  }
  m =
    /^(\d{1,2})(?::(\d{2})|h(\d{2})|(hs|h| horas?))?(?: e (meia|\d{1,2})(?: minutos?| min)?)?(?: (?:da|de|pela) (manha|tarde|noite|madrugada))?$/.exec(
      tok,
    );
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : m[5] === 'meia' ? 30 : m[5] ? Number(m[5]) : 0;
  if (hour > 24 || minute > 59) return null;
  const hasMarker = Boolean(m[2] || m[3] || m[4] || m[5] || m[6]);
  return { hour: hour === 24 ? 0 : hour, minute, period: (m[6] as ParsedTime['period']) ?? null, hasMarker };
}

/** Resolve manhã/tarde e devolve os candidatos em minutos do dia. */
function resolveClock(p: ParsedTime, plausible: { from: number; to: number }, hint: PeriodLabel | null): number[] {
  const { hour, minute, period } = p;
  if (period === 'tarde') return [(hour >= 1 && hour <= 11 ? hour + 12 : hour) * 60 + minute];
  if (period === 'noite') return [(hour === 12 ? 0 : hour >= 1 && hour <= 11 ? hour + 12 : hour) * 60 + minute];
  if (period === 'manha' || period === 'madrugada') return [hour * 60 + minute];
  if (hour >= 12 || hour === 0) return [hour * 60 + minute];

  const am = hour * 60 + minute;
  const pm = (hour + 12) * 60 + minute;
  if (hint) {
    const hf = timeToMinutes(hint.from);
    const ht = timeToMinutes(hint.to);
    const inHint = [am, pm].filter((v) => v >= hf && v <= ht);
    if (inHint.length === 1) return inHint;
  }
  const inA = am >= plausible.from && am <= plausible.to;
  const inP = pm >= plausible.from && pm <= plausible.to;
  if (inA && inP) return [am, pm];
  if (inA) return [am];
  if (inP) return [pm];
  return [hour <= 6 ? pm : am];
}

function nextOccurrence(today: string, wd: IsoWeekday, includeToday: boolean): string {
  let delta = (wd - weekdayOf(today) + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addDays(today, delta);
}

function mondayOfNextWeek(today: string): string {
  return addDays(today, 8 - weekdayOf(today));
}

function buildDate(year: number, month: number, day: number): string | null {
  const dt = DateTime.fromObject({ year, month, day }, { zone: 'UTC' });
  return dt.isValid ? dt.toISODate() : null;
}

function fmt(minutes: number): string {
  return minutesToTime(((minutes % 1440) + 1440) % 1440);
}

/**
 * Interpreta datas e horários relativos em PT-BR. Nunca inventa: quando não reconhece,
 * retorna `recognized: false` e a IA deve perguntar ao cliente.
 */
export function resolveTemporalExpression(input: string, ctx: TemporalContext): TemporalResolution {
  const zone = ctx.timezone;
  const today = todayInZone(zone, ctx.now);
  const nowLocal = DateTime.fromMillis(ctx.now, { zone });
  const plausible = {
    from: timeToMinutes(ctx.plausibleHours?.from ?? '07:00'),
    to: timeToMinutes(ctx.plausibleHours?.to ?? '20:30'),
  };

  const res: TemporalResolution = {
    input,
    recognized: false,
    dates: null,
    dateCandidates: [],
    time: null,
    timeCandidates: [],
    firstAvailable: false,
    sameAsLastTime: false,
    pastDate: false,
    ambiguities: [],
    matched: [],
  };

  let text = ` ${wordsToDigitsPt(normalizePt(input).replace(GREETINGS_RE, ' '))} `;

  /** Aplica a regex em todo o texto, chama `fn` por ocorrência e remove o trecho consumido. */
  const consume = (re: RegExp, fn: (groups: (string | undefined)[]) => boolean | void) => {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    text = text.replace(global, (...args: unknown[]) => {
      const match = args[0] as string;
      const groups = args.slice(0, -2) as (string | undefined)[];
      const keep = fn(groups) === false;
      if (keep) return match;
      res.matched.push(match.trim());
      return ' ';
    });
  };

  // ------------------------------------------------------------ intenções especiais
  let later = false;
  consume(SAME_AS_LAST_RE, () => {
    res.sameAsLastTime = true;
  });
  consume(/\b(?:mais tarde|logo mais|daqui a pouco|daqui 1 pouco)\b/, () => {
    later = true;
  });
  consume(FIRST_AVAILABLE_RE, () => {
    res.firstAvailable = true;
  });

  // ------------------------------------------------------------ datas com números
  const points: string[] = [];
  const ranges: { from: string; to: string }[] = [];

  consume(/\b(?:daqui a|daqui|em|dentro de) (\d{1,2}) (dias?|semanas?|meses|mes)\b/, (g) => {
    const n = Number(g[1]);
    const unit = g[2] ?? '';
    if (unit.startsWith('dia')) points.push(addDays(today, n));
    else if (unit.startsWith('semana')) points.push(addDays(today, 7 * n));
    else points.push(DateTime.fromISO(today, { zone: 'UTC' }).plus({ months: n }).toISODate()!);
  });

  consume(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (g) => {
    const day = Number(g[1]);
    const month = Number(g[2]);
    let year = g[3] ? Number(g[3]) : Number(today.slice(0, 4));
    if (year < 100) year += 2000;
    let d = buildDate(year, month, day);
    if (d && !g[3] && d < today) d = buildDate(year + 1, month, day);
    if (d) points.push(d);
    else res.ambiguities.push(`A data ${day}/${month} não existe.`);
  });

  const monthIndex = (name: string) => MONTHS_NORMALIZED.indexOf(name) + 1;

  consume(new RegExp(`\\b(?:dia )?(\\d{1,2}|primeiro) de (${MONTH_RE})(?: de (\\d{4}))?\\b`), (g) => {
    const day = g[1] === 'primeiro' ? 1 : Number(g[1]);
    const month = monthIndex(g[2] ?? '');
    const year = g[3] ? Number(g[3]) : Number(today.slice(0, 4));
    let d = buildDate(year, month, day);
    if (d && !g[3] && d < today) d = buildDate(year + 1, month, day);
    if (d) points.push(d);
    else res.ambiguities.push(`A data ${day} de ${g[2]} não existe.`);
  });

  consume(/\bdia (\d{1,2})(?: (do mes que vem|do proximo mes|do outro mes|deste mes|desse mes))?\b/, (g) => {
    const day = Number(g[1]);
    const base = DateTime.fromISO(today, { zone: 'UTC' });
    const forceNext = Boolean(g[2] && /que vem|proximo|outro/.test(g[2]));
    let cand = forceNext ? null : buildDate(base.year, base.month, day);
    if (!cand || cand < today) {
      const nx = base.plus({ months: 1 });
      cand = buildDate(nx.year, nx.month, day);
    }
    if (cand) points.push(cand);
    else res.ambiguities.push(`Não existe dia ${day} no mês considerado.`);
  });

  consume(new RegExp(`\\b(?:em|no mes de|para|pra|de) (${MONTH_RE})\\b`), (g) => {
    const month = monthIndex(g[1] ?? '');
    const base = DateTime.fromISO(today, { zone: 'UTC' });
    const year = month < base.month ? base.year + 1 : base.year;
    const start = DateTime.fromObject({ year, month, day: 1 }, { zone: 'UTC' });
    const from = start.toISODate()!;
    ranges.push({ from: from < today ? today : from, to: start.endOf('month').toISODate()! });
  });

  // ------------------------------------------------------------ horários
  const timeMentions: number[][] = [];
  let windowFrom: number | null = null;
  let windowTo: number | null = null;
  let approximate = false;
  let label: string | undefined;

  // detecta (sem consumir) o período do dia para desambiguar "de noite às 8"
  let periodHint: PeriodLabel | null = PERIOD_LABELS.find((p) => p.re.test(text)) ?? null;

  const candidatesOf = (tok: string | undefined): number[] | null => {
    const parsed = parseTimeToken(tok ?? '');
    return parsed ? resolveClock(parsed, plausible, periodHint) : null;
  };

  // "quinze para as cinco" (16:45) precisa vir antes de "para as 5"
  consume(
    new RegExp(
      String.raw`(?<![\w/])(?:as |a )?((?:5|10|15|20|25|30) (?:para|pras|pra) (?:as |a )?\d{1,2}h?(?: (?:da|de) (?:manha|tarde|noite))?)${NOT_A_QUANTITY}`,
    ),
    (g) => {
      const c = candidatesOf(g[1]);
      if (!c) return false;
      timeMentions.push(c);
    },
  );

  consume(
    new RegExp(
      `\\b(?:entre|das|de) (?:as |a )?(${TIME_TOKEN}) (?:e|as|ate as|ate|a) (?:as |a )?(${TIME_TOKEN})${NOT_A_QUANTITY}`,
    ),
    (g) => {
      const a = candidatesOf(g[1]);
      const b = candidatesOf(g[2]);
      if (!a || !b) return false;
      let from = a[0]!;
      let to = b[b.length - 1]!;
      if (to < from && to + 720 >= from) to += 720; // "das 11 às 2" → 11:00–14:00
      if (from > to) [from, to] = [to, from];
      windowFrom = from;
      windowTo = Math.min(to, 24 * 60 - 1);
    },
  );

  consume(
    new RegExp(
      `\\b(?:depois das|depois da|depois de|depois do|apos as|apos a|apos o|a partir das|a partir da|a partir de|a partir do|mais tarde que as) (${TIME_TOKEN})${NOT_A_QUANTITY}`,
    ),
    (g) => {
      const c = candidatesOf(g[1]);
      if (!c) return false;
      windowFrom = Math.max(windowFrom ?? 0, c[0]!);
    },
  );

  consume(
    new RegExp(
      `\\b(?:antes das|antes da|antes de|antes do|ate as|ate a|ate o|no maximo as|no maximo ate as) (${TIME_TOKEN})${NOT_A_QUANTITY}`,
    ),
    (g) => {
      const c = candidatesOf(g[1]);
      if (!c) return false;
      windowTo = Math.min(windowTo ?? 24 * 60 - 1, c[c.length - 1]!);
    },
  );

  consume(
    new RegExp(
      `\\b(?:umas|uns|por volta das|por volta da|por volta de|perto das|perto da|la pelas|la pela|pelas|cerca das) (${TIME_TOKEN})${NOT_A_QUANTITY}`,
    ),
    (g) => {
      const c = candidatesOf(g[1]);
      if (!c) return false;
      approximate = true;
      timeMentions.push(c);
    },
  );

  consume(
    new RegExp(`\\b(as|a|pras|pra|para as|para a|para|ao|no|o) (${TIME_TOKEN})${NOT_A_QUANTITY}`),
    (g) => {
      const parsed = parseTimeToken(g[2] ?? '');
      if (!parsed) return false;
      // "quero o 2", "no 15", "para 3" sem marcador podem ser opções/quantidades
      if (['o', 'no', 'ao', 'para'].includes(g[1] ?? '') && !parsed.hasMarker) return false;
      timeMentions.push(resolveClock(parsed, plausible, periodHint));
    },
  );

  // horários soltos com marcador explícito: "15h", "15:30", "3 da tarde", "meio dia"
  consume(new RegExp(`(?<![\\w/])(${TIME_TOKEN})(?![\\w/])`), (g) => {
    const parsed = parseTimeToken(g[1] ?? '');
    if (!parsed || !parsed.hasMarker) return false;
    timeMentions.push(resolveClock(parsed, plausible, periodHint));
  });

  const labelHits: PeriodLabel[] = [];
  for (const p of PERIOD_LABELS) {
    consume(p.re, () => {
      labelHits.push(p);
    });
  }
  const orInText = () => /\bou\b/.test(text);

  if (labelHits.length > 0) {
    const froms = labelHits.map((p) => timeToMinutes(p.from));
    const tos = labelHits.map((p) => timeToMinutes(p.to));
    // "de manhã ou à tarde" → união; "à tarde, no fim da tarde" → interseção
    const union = orInText();
    const lf = union ? Math.min(...froms) : Math.max(...froms);
    const lt = union ? Math.max(...tos) : Math.min(...tos);
    windowFrom = windowFrom === null ? lf : Math.max(windowFrom, lf);
    windowTo = windowTo === null ? lt : Math.min(windowTo, lt);
    // na interseção, o rótulo mais específico (primeiro da lista) descreve melhor o pedido
    label = union ? labelHits.map((p) => p.label).join(' ou ') : labelHits[0]!.label;
    periodHint = labelHits[0]!;
  }

  // ------------------------------------------------------------ datas relativas
  consume(/\b(?:anteontem|ontem)\b/, () => {
    res.pastDate = true;
  });
  consume(/\bdepois de amanha\b/, () => {
    points.push(addDays(today, 2));
  });
  consume(/\bamanha\b/, () => {
    points.push(addDays(today, 1));
  });
  consume(/\b(?:ainda hoje|hoje|hj)\b/, () => {
    points.push(today);
  });

  let nextWeekMentioned = false;
  consume(
    /\b(?:(proxima|proximo|na outra|outra|nessa|nesta|essa|esta|dessa|desta)\s+)?(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:\s+(que vem|agora|da semana que vem|da proxima semana|da outra semana|dessa semana|desta semana))?\b/,
    (g) => {
      const qual = g[1] ?? '';
      const wd = WEEKDAY_MAP[g[2] ?? ''] as IsoWeekday;
      const suffix = g[3] ?? '';
      const phrase = [qual, g[2], suffix].filter(Boolean).join(' ');
      if (/semana que vem|proxima semana|outra semana/.test(suffix)) {
        points.push(addDays(mondayOfNextWeek(today), wd - 1));
        return;
      }
      if (qual === 'outra' || qual === 'na outra') {
        points.push(addDays(nextOccurrence(today, wd, false), 7));
        return;
      }
      if (qual === 'proxima' || qual === 'proximo' || suffix === 'que vem') {
        const near = nextOccurrence(today, wd, false);
        points.push(near);
        if (near <= addDays(today, 2)) {
          const far = addDays(near, 7);
          res.dateCandidates.push(near, far);
          res.ambiguities.push(`"${phrase}" pode ser ${formatLongDatePt(near)} ou ${formatLongDatePt(far)}.`);
        }
        return;
      }
      const d = nextOccurrence(today, wd, true);
      points.push(d);
      if (d === today && !/essa|esta|nessa|nesta|dessa|desta/.test(qual)) {
        const far = addDays(today, 7);
        res.dateCandidates.push(today, far);
        res.ambiguities.push(`Hoje já é ${formatLongDatePt(today).split(',')[0]}: confirmar se é hoje ou ${formatLongDatePt(far)}.`);
      }
    },
  );

  consume(/\b(?:na |da )?(?:semana que vem|proxima semana|semana seguinte|outra semana)\b/, () => {
    nextWeekMentioned = true;
  });
  consume(/\b(?:ainda )?(?:nessa|nesta|essa|esta) semana\b/, () => {
    ranges.push({ from: today, to: addDays(today, 7 - weekdayOf(today)) });
  });
  consume(/\b(?:no |neste |nesse |este |esse )?(?:fim de semana|final de semana|fds)(?: (que vem))?\b/, (g) => {
    const wd = weekdayOf(today);
    let sat = wd === 6 ? today : wd === 7 ? addDays(today, -1) : nextOccurrence(today, 6, true);
    if (g[1] && wd >= 6) sat = addDays(sat, 7);
    ranges.push({ from: sat < today ? today : sat, to: addDays(sat, 1) });
  });
  consume(/\b(?:mes que vem|proximo mes)\b/, () => {
    const nx = DateTime.fromISO(today, { zone: 'UTC' }).plus({ months: 1 });
    ranges.push({ from: nx.startOf('month').toISODate()!, to: nx.endOf('month').toISODate()! });
  });
  consume(/\b(?:nesse|neste|esse|este) mes\b/, () => {
    ranges.push({ from: today, to: DateTime.fromISO(today, { zone: 'UTC' }).endOf('month').toISODate()! });
  });

  const joinedByOr = orInText();

  if (nextWeekMentioned) {
    const mon = mondayOfNextWeek(today);
    const nextWeek = { from: mon, to: addDays(mon, 6) };
    const inWeek = points.filter((p) => p >= nextWeek.from && p <= nextWeek.to);
    if (points.length > 0 && inWeek.length === 0) {
      // "semana que vem na quinta" → reposiciona o dia da semana para a próxima semana
      const moved = points.map((p) => addDays(mon, weekdayOf(p) - 1));
      points.splice(0, points.length, ...moved);
      res.dateCandidates = [];
      res.ambiguities = res.ambiguities.filter((a) => !a.startsWith('"') && !a.startsWith('Hoje já é'));
    } else if (points.length === 0) {
      ranges.push(nextWeek);
    }
  }

  // ------------------------------------------------------------ consolidação das datas
  const uniquePoints = [...new Set(points)].sort();
  if (uniquePoints.length > 0) {
    const scoped = ranges.length
      ? uniquePoints.filter((p) => ranges.some((r) => p >= r.from && p <= r.to))
      : uniquePoints;
    const finalPoints = scoped.length ? scoped : uniquePoints;
    if (finalPoints.length === 1) {
      const p = finalPoints[0]!;
      res.dates = { from: p, to: p };
    } else {
      res.dates = { from: finalPoints[0]!, to: finalPoints[finalPoints.length - 1]! };
      res.dateCandidates = [...res.dateCandidates, ...finalPoints];
      if (!joinedByOr) {
        res.ambiguities.push(`Foram citadas datas diferentes (${finalPoints.map(formatLongDatePt).join(' / ')}).`);
      }
    }
  } else if (ranges.length > 0) {
    const from = ranges.map((r) => r.from).sort().at(-1)!;
    const to = ranges.map((r) => r.to).sort()[0]!;
    res.dates = from <= to ? { from, to } : { from: ranges[0]!.from, to: ranges[0]!.to };
  }
  res.dateCandidates = [...new Set(res.dateCandidates)].sort();
  if (res.dates && res.dates.to < today) res.pastDate = true;

  // ------------------------------------------------------------ "mais tarde"
  if (later) {
    if (!res.dates) res.dates = { from: today, to: today };
    if (res.dates.from === today) {
      const nowMin = nowLocal.hour * 60 + nowLocal.minute;
      const from = Math.ceil((nowMin + 60) / 15) * 15;
      if (from < 24 * 60) {
        windowFrom = Math.max(windowFrom ?? 0, from);
        label = label ?? 'mais tarde';
      }
    }
  }

  // ------------------------------------------------------------ consolidação do horário
  const allTimes = [...new Set(timeMentions.flat())];
  if (allTimes.length > 0) {
    let candidates = allTimes;
    if (windowFrom !== null || windowTo !== null) {
      const f = windowFrom ?? 0;
      const t = windowTo ?? 24 * 60;
      const inside = candidates.filter((c) => c >= f && c <= t);
      if (inside.length) candidates = inside;
    }
    candidates.sort((a, b) => a - b);
    const time: TimeSpec = {};
    if (label) time.label = label;
    if (candidates.length === 1) {
      const exact = candidates[0]!;
      time.exact = fmt(exact);
      if (approximate) {
        time.approximate = true;
        time.from = fmt(Math.max(0, exact - 30));
        time.to = fmt(Math.min(24 * 60 - 1, exact + 30));
      }
    } else {
      res.timeCandidates = candidates.map(fmt);
      time.exact = res.timeCandidates[0]!;
      if (approximate) time.approximate = true;
      res.ambiguities.push(
        timeMentions.length > 1
          ? `Foram citados horários diferentes (${res.timeCandidates.join(' / ')}).`
          : `Horário ambíguo: ${res.timeCandidates.join(' ou ')}.`,
      );
    }
    res.time = time;
  } else if (windowFrom !== null || windowTo !== null || label) {
    const time: TimeSpec = {};
    if (label) time.label = label;
    if (windowFrom !== null) time.from = fmt(windowFrom);
    if (windowTo !== null) time.to = fmt(Math.min(windowTo, 24 * 60 - 1));
    res.time = time;
  }

  res.recognized =
    res.dates !== null ||
    res.time !== null ||
    res.firstAvailable ||
    res.sameAsLastTime ||
    res.pastDate ||
    res.dateCandidates.length > 0 ||
    res.ambiguities.length > 0;

  return res;
}

/** Resumo legível para a IA confirmar com o cliente. */
export function describeTemporalResolution(r: TemporalResolution): string {
  const parts: string[] = [];
  if (r.dates) {
    parts.push(
      r.dates.from === r.dates.to
        ? formatLongDatePt(r.dates.from)
        : `de ${formatLongDatePt(r.dates.from)} a ${formatLongDatePt(r.dates.to)}`,
    );
  }
  if (r.time?.exact && !r.time.approximate) parts.push(`às ${r.time.exact}`);
  else if (r.time?.exact && r.time.approximate) parts.push(`por volta das ${r.time.exact}`);
  else if (r.time?.from && r.time?.to) parts.push(`entre ${r.time.from} e ${r.time.to}`);
  else if (r.time?.from) parts.push(`a partir das ${r.time.from}`);
  else if (r.time?.to) parts.push(`até as ${r.time.to}`);
  if (r.firstAvailable) parts.push('primeiro horário disponível');
  if (r.sameAsLastTime) parts.push('mesmo horário do último atendimento');
  return parts.join(', ') || 'nenhuma data ou horário reconhecido';
}
