import { stripAccents } from '../nlp/normalize-pt';
import { resolveTemporalExpression } from '../nlp/temporal-pt';
import { addDays, diffDays } from '../time/zone';
import { numberWordsToDigitsPt } from './numbers';

/**
 * Verificador de afirmações da recepcionista (pós-geração, determinístico).
 *
 * Antes de qualquer resposta chegar ao cliente, conferimos que:
 *  - todo PREÇO citado existe no catálogo ou foi devolvido por uma ferramenta nesta conversa;
 *  - todo HORÁRIO citado foi devolvido pela agenda (ou pelo horário de funcionamento, ou foi o
 *    próprio cliente quem o mencionou) — e, quando a frase cita uma data, o par data+horário confere;
 *  - "agendado/confirmado", "reservado", "cancelado" e "remarcado" só aparecem depois que a
 *    ferramenta correspondente retornou sucesso.
 *
 * É propositalmente conservador: na dúvida, a resposta é regenerada com a correção.
 * Perguntas, negações e condicionais ("se você confirmar, fica agendado") não contam como afirmação.
 */

export interface PriceClaim {
  cents: number;
  raw: string;
}

export interface TimeClaim {
  /** Leituras possíveis ('HH:mm'): "às 3" pode ser 03:00 ou 15:00. */
  candidates: string[];
  raw: string;
  /** Datas locais citadas na frase (ou herdadas da frase anterior da mesma resposta). */
  dates: string[];
  /** Frase fala de horário de funcionamento ("abrimos às 9h"). */
  hoursContext: boolean;
}

export type ActionClaimKind = 'BOOKED' | 'HELD' | 'CANCELLED' | 'RESCHEDULED';

export interface ActionClaim {
  kind: ActionClaimKind;
  raw: string;
}

export interface ResponseClaims {
  prices: PriceClaim[];
  times: TimeClaim[];
  actions: ActionClaim[];
}

export interface ClaimEvidence {
  /** Preços oficiais do catálogo (inclui preços próprios de profissionais), em centavos. */
  catalogPricesCents: readonly number[];
  /** Totais e preços devolvidos por ferramentas nesta conversa (ex.: total da reserva). */
  quotedPricesCents: readonly number[];
  /** Horários devolvidos pela agenda, reservas desta conversa e agendamentos do cliente. */
  slots: readonly { date: string; time: string }[];
  /** Horários que o próprio cliente mencionou ("às 15h não tem?"). */
  customerTimes: readonly string[];
  /** Horário de funcionamento (limites das faixas). */
  businessHours: readonly { weekday: number; start: string; end: string }[];
  /** Ações concluídas com sucesso nesta conversa (ou já existentes, no caso de BOOKED). */
  actions: { booked: boolean; held: boolean; cancelled: boolean; rescheduled: boolean };
}

export type ClaimViolationCode = 'UNVERIFIED_PRICE' | 'UNVERIFIED_TIME' | 'UNCONFIRMED_ACTION';

export interface ClaimViolation {
  code: ClaimViolationCode;
  raw: string;
  /** Explicação em PT-BR, usada na instrução de correção enviada ao modelo. */
  message: string;
}

export interface ClaimContext {
  now: number;
  timezone: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

/** Minúsculas, sem acentos e sem marcação do WhatsApp; números por extenso viram dígitos. */
export function normalizeForClaims(text: string): string {
  const base = stripAccents(text.toLowerCase())
    .replace(/[*_~`]/g, ' ')
    .replace(/[“”"']/g, ' ')
    .replace(/\bmeio[\s-]dia\b/g, '12:00')
    .replace(/\bmeia[\s-]noite\b/g, '00:00')
    .replace(/-feira\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return numberWordsToDigitsPt(base);
}

/** Divide em frases/linhas, guardando se cada uma é pergunta. */
function segments(text: string): { text: string; question: boolean }[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ text: s, question: /\?\s*\W*$/.test(s) }));
}

type Period = 'manha' | 'tarde' | 'noite' | 'madrugada' | undefined;

function readings(h: number, m: number, period: Period): string[] {
  if (h > 24 || m > 59 || h < 0) return [];
  if (h === 24) h = 0;
  if (period === 'tarde' || period === 'noite') {
    if (period === 'noite' && h === 12) return [hm(0, m)];
    return [hm(h < 12 ? h + 12 : h, m)];
  }
  if (period === 'manha' || period === 'madrugada') return [hm(h === 12 ? 0 : h, m)];
  if (h >= 1 && h <= 11) return [hm(h, m), hm(h + 12, m)];
  return [hm(h, m)];
}

const minutesOf = (raw: string | undefined): number => (raw === 'meia' ? 30 : raw ? Number(raw) : 0);

const DURATION_BEFORE =
  /(?:dura|duram|duracao|leva|levam|demora|demoram|cerca de|aproximadamente|em|por|mais de|menos de|uns|umas|ha|faz)\s*$/;
const DURATION_AFTER =
  /^\s*(?:de (?:duracao|atendimento|servico|procedimento)|seguidas|por dia|antes|depois)/;

/** Palavras que podem seguir um horário "às 15"; qualquer outra indica que não é horário ("as 3 opcoes"). */
const TIME_FOLLOWERS = new Set([
  'da',
  'de',
  'e',
  'ou',
  'com',
  'no',
  'na',
  'nos',
  'nas',
  'para',
  'pra',
  'ate',
  'em',
  'h',
  'hs',
  'hora',
  'horas',
  'esta',
  'ta',
  'fica',
  'ficou',
  'tambem',
  'mesmo',
  'certo',
  'pode',
  'seria',
  'serve',
]);

function nextWord(rest: string): string | null {
  const m = /^\s*([a-z0-9]+)/.exec(rest);
  if (!m) return null;
  // pontuação antes da próxima palavra encerra a expressão
  if (/^\s*[,.;:!?)\-–—]/.test(rest)) return null;
  return m[1]!;
}

/** Extrai menções de horário de um trecho já normalizado. */
export function extractTimesFromNormalized(norm: string): { candidates: string[]; raw: string }[] {
  const found: { pos: number; candidates: string[]; raw: string }[] = [];
  let work = norm;
  const consume = (re: RegExp, build: (m: RegExpExecArray) => string[] | null) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(work))) {
      const c = build(m);
      if (c && c.length) {
        found.push({ pos: m.index, candidates: c, raw: m[0].trim() });
        work = work.slice(0, m.index) + ' '.repeat(m[0].length) + work.slice(m.index + m[0].length);
      }
    }
  };

  // "quinze para as cinco" → 4:45 / 16:45
  consume(
    /\b(5|10|15|20|25)\s(?:para as|para a|pras|pra)\s(\d{1,2})\b(?:\s(?:da|de)\s(manha|tarde|noite|madrugada))?/g,
    (m) => {
      const h = Number(m[2]) - 1;
      return h >= 0 ? readings(h, 60 - Number(m[1]), m[3] as Period) : null;
    },
  );

  // 14:30, 14h30, 9h05
  consume(
    /\b(\d{1,2})(?::|h)(\d{2})\b(?:\s?(?:h|hs|horas?)\b)?(?:\s(?:da|de)\s(manha|tarde|noite|madrugada))?/g,
    (m) => readings(Number(m[1]), Number(m[2]), m[3] as Period),
  );

  // 14h, 14 horas, 14 horas e 30 (minutos), 2h da tarde — excluindo durações
  consume(
    /\b(\d{1,2})\s?(?:h|hs|hrs?|horas?)\b(?:\s?e\s?(\d{1,2}|meia)\b(?:\s?min(?:utos?)?\b)?)?(?:\s(?:da|de)\s(manha|tarde|noite|madrugada))?/g,
    (m) => {
      const before = work.slice(Math.max(0, m.index - 24), m.index);
      const after = work.slice(m.index + m[0].length);
      if (DURATION_BEFORE.test(before) || DURATION_AFTER.test(after)) return null;
      return readings(Number(m[1]), minutesOf(m[2]), m[3] as Period);
    },
  );

  // às 15, às 3 e meia, das 2 da tarde, por volta das 4
  consume(
    /\b(?:as|das|pras|para as|ate as|a partir das|entre as|depois das|antes das|pelas|por volta das|la pelas)\s(\d{1,2})\b(?:\s?e\s?(\d{1,2}|meia)\b)?(?:\s(?:da|de)\s(manha|tarde|noite|madrugada)\b)?/g,
    (m) => {
      const after = work.slice(m.index + m[0].length);
      if (/^\s*(?:reais|real|min|minutos?|dias?|semanas?|meses|anos?|%|pessoas?|vezes)\b/.test(after))
        return null;
      if (!m[2] && !m[3]) {
        const w = nextWord(after);
        if (w !== null && !TIME_FOLLOWERS.has(w)) return null;
      }
      return readings(Number(m[1]), minutesOf(m[2]), m[3] as Period);
    },
  );

  // "2 da tarde" sem preposição
  consume(/\b(\d{1,2})\s(?:da|de)\s(manha|tarde|noite|madrugada)\b/g, (m) =>
    readings(Number(m[1]), 0, m[2] as Period),
  );

  // 12:00 / 00:00 vindos de "meio-dia"/"meia-noite" já foram capturados pelo padrão HH:MM
  return found.sort((a, b) => a.pos - b.pos).map(({ candidates, raw }) => ({ candidates, raw }));
}

/** Horários mencionados num texto livre (ex.: mensagem do cliente). */
export function extractTimes(text: string): string[] {
  return [...new Set(extractTimesFromNormalized(normalizeForClaims(text)).flatMap((t) => t.candidates))];
}

function extractPrices(norm: string): PriceClaim[] {
  const out: PriceClaim[] = [];
  let work = norm;
  const toCents = (intPart: string, decPart?: string) =>
    Number(intPart.replace(/\./g, '')) * 100 + (decPart ? Number(decPart.padEnd(2, '0').slice(0, 2)) : 0);

  // R$ 1.234,50 | R$45 | R$ 45,00
  const reCurrency = /r\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g;
  let m: RegExpExecArray | null;
  while ((m = reCurrency.exec(work))) {
    out.push({ cents: toCents(m[1]!, m[2]), raw: m[0] });
    work = work.slice(0, m.index) + ' '.repeat(m[0].length) + work.slice(m.index + m[0].length);
  }
  // 45 reais (e 50 centavos) | 45,90 reais
  const reWords =
    /\b(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s?(?:reais|real)\b(?:\s?e\s?(\d{1,2})\s?centavos\b)?/g;
  while ((m = reWords.exec(work))) {
    const cents = toCents(m[1]!, m[2]) + (m[3] ? Number(m[3]) : 0);
    out.push({ cents, raw: m[0] });
  }
  return out;
}

const NEGATION_OR_CONDITION =
  /\b(?:nao|nunca|ainda nao|sem|se|caso|quando|assim que|depois que|apos|antes de|para deixar|pra deixar|para ficar|pra ficar|para que|posso|quer que|gostaria|deseja|prefere|vou|vamos|irei|podemos|consigo)\b/;

const ACTION_PATTERNS: { kind: ActionClaimKind; re: RegExp }[] = [
  { kind: 'CANCELLED', re: /\b(?:cancelei|desmarquei|cancelad[oa]s?|desmarcad[oa]s?)\b/ },
  {
    kind: 'RESCHEDULED',
    re: /\b(?:remarquei|reagendei|remarcad[oa]s?|reagendad[oa]s?|(?:alterei|mudei|transferi) (?:o )?seu (?:horario|agendamento))\b/,
  },
  {
    kind: 'BOOKED',
    re: /\b(?:agendei|marquei|confirmei|garanti|(?:agendad|marcad|confirmad|garantid)[oa]s?)\b/,
  },
  { kind: 'HELD', re: /\b(?:reservei|segurei|bloqueei|pre ?reserv\w*|reservad[oa]s?)\b/ },
];

function extractActions(norm: string): ActionClaim[] {
  const out: ActionClaim[] = [];
  for (const { kind, re } of ACTION_PATTERNS) {
    const m = re.exec(norm);
    if (!m) continue;
    const prefix = norm.slice(0, m.index);
    if (NEGATION_OR_CONDITION.test(prefix)) continue;
    out.push({ kind, raw: m[0] });
  }
  return out;
}

function datesOf(text: string, ctx: ClaimContext): string[] {
  const r = resolveTemporalExpression(text, { now: ctx.now, timezone: ctx.timezone });
  const dates = new Set<string>(r.dateCandidates);
  if (r.dates && !r.pastDate) {
    const span = diffDays(r.dates.from, r.dates.to);
    if (span <= 6) for (let i = 0; i <= span; i++) dates.add(addDays(r.dates.from, i));
  }
  return [...dates];
}

const HOURS_CONTEXT =
  /\b(?:abr[eio]\w*|fech\w*|funciona\w*|atendemos|atende|expediente|aberto|aberta|horario de atendimento)\b/;

export function extractClaims(text: string, ctx: ClaimContext): ResponseClaims {
  const claims: ResponseClaims = { prices: [], times: [], actions: [] };
  let carriedDates: string[] = [];
  for (const seg of segments(text)) {
    const norm = normalizeForClaims(seg.text);
    claims.prices.push(...extractPrices(norm));
    const segDates = datesOf(seg.text, ctx);
    if (segDates.length) carriedDates = segDates;
    const hoursContext = HOURS_CONTEXT.test(norm);
    for (const t of extractTimesFromNormalized(norm)) {
      claims.times.push({ ...t, dates: segDates.length ? segDates : carriedDates, hoursContext });
    }
    if (!seg.question) claims.actions.push(...extractActions(norm));
  }
  return claims;
}

const brl = (cents: number) =>
  `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Preços aceitáveis: catálogo, valores devolvidos por ferramentas e somas de até 3 serviços. */
function allowedPrices(ev: ClaimEvidence): Set<number> {
  const set = new Set<number>([...ev.catalogPricesCents, ...ev.quotedPricesCents]);
  const cat = [...new Set(ev.catalogPricesCents)].slice(0, 40);
  for (let i = 0; i < cat.length; i++) {
    for (let j = i; j < cat.length; j++) {
      set.add(cat[i]! + cat[j]!);
      for (let k = j; k < cat.length; k++) set.add(cat[i]! + cat[j]! + cat[k]!);
    }
  }
  return set;
}

export function verifyClaims(claims: ResponseClaims, ev: ClaimEvidence): ClaimViolation[] {
  const violations: ClaimViolation[] = [];
  const prices = allowedPrices(ev);
  for (const p of claims.prices) {
    if (!prices.has(p.cents)) {
      violations.push({
        code: 'UNVERIFIED_PRICE',
        raw: p.raw,
        message: `O valor ${brl(p.cents)} não consta no catálogo nem nos resultados das ferramentas.`,
      });
    }
  }

  const boundaries = new Set(ev.businessHours.flatMap((b) => [b.start, b.end]));
  const customer = new Set(ev.customerTimes);
  for (const t of claims.times) {
    const ok =
      t.candidates.some((c) => customer.has(c)) ||
      (t.hoursContext && t.candidates.some((c) => boundaries.has(c))) ||
      ev.slots.some(
        (s) => t.candidates.includes(s.time) && (t.dates.length === 0 || t.dates.includes(s.date)),
      );
    if (!ok) {
      violations.push({
        code: 'UNVERIFIED_TIME',
        raw: t.raw,
        message: t.dates.length
          ? `O horário "${t.raw}" não foi devolvido pela consulta de horários para a data citada.`
          : `O horário "${t.raw}" não foi devolvido pela consulta de horários.`,
      });
    }
  }

  for (const a of claims.actions) {
    const ok =
      a.kind === 'BOOKED'
        ? ev.actions.booked
        : a.kind === 'HELD'
          ? ev.actions.held || ev.actions.booked
          : a.kind === 'CANCELLED'
            ? ev.actions.cancelled
            : ev.actions.rescheduled;
    if (!ok) {
      const what = {
        BOOKED: 'agendado/confirmado (a ferramenta de confirmação não retornou sucesso)',
        HELD: 'reservado (nenhuma reserva foi criada)',
        CANCELLED: 'cancelado (a ferramenta de cancelamento não retornou sucesso)',
        RESCHEDULED: 'remarcado (a ferramenta de remarcação não retornou sucesso)',
      }[a.kind];
      violations.push({
        code: 'UNCONFIRMED_ACTION',
        raw: a.raw,
        message: `A resposta afirma "${a.raw}": ${what}.`,
      });
    }
  }
  return violations;
}

export const EMPTY_EVIDENCE: ClaimEvidence = {
  catalogPricesCents: [],
  quotedPricesCents: [],
  slots: [],
  customerTimes: [],
  businessHours: [],
  actions: { booked: false, held: false, cancelled: false, rescheduled: false },
};
