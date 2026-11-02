import { normalizePt } from '../nlp/normalize-pt';
import { countEmojis } from '../speech/pt-br';
import type { Channel, EffectiveLanguage } from './types';

/**
 * Validador determinístico de estilo de uma resposta da recepcionista. Usado antes de
 * enviar/falar (Fase 4) e nos cenários conversacionais automatizados.
 */
export type StyleViolationCode =
  | 'EMOJI_NOT_ALLOWED'
  | 'TOO_MANY_EMOJIS'
  | 'TOO_LONG'
  | 'MARKUP_ON_PHONE'
  | 'DIGITS_ON_PHONE'
  | 'FORBIDDEN_TERM'
  | 'INTIMATE_TERM'
  | 'CASUAL_IN_FORMAL';

export interface StyleViolation {
  code: StyleViolationCode;
  detail: string;
}

/** Termos de intimidade excessiva — proibidos em qualquer configuração. */
const INTIMATE = [
  'amor',
  'amore',
  'querida',
  'querido',
  'meu bem',
  'benzinho',
  'gato',
  'gata',
  'gatinha',
  'gatinho',
  'lindona',
  'lindao',
  'princesa',
  'gostosa',
  'gostoso',
  'fofa',
  'fofo',
  'bebe',
  'mozao',
  'xuxu',
  'chuchu',
];

/** Marcas coloquiais que não cabem em linguagem formal (termos ambíguos como "cara" ficam de fora). */
const CASUAL_MARKERS = [
  'tá',
  'tô',
  'pra',
  'pro',
  'né',
  'beleza',
  'valeu',
  'mano',
  'top',
  'bora',
  'firmeza',
  'salve',
  'fechou',
  'tamo',
  'partiu',
  'oiê',
  'opa',
  'e aí',
  'marcadinho',
  'prontinho',
];

const WORD_LIMIT: Record<Channel, number> = { PHONE: 45, WHATSAPP: 80 };

function containsWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(haystack);
}

export function checkResponseStyle(text: string, eff: EffectiveLanguage): StyleViolation[] {
  const out: StyleViolation[] = [];
  const lower = text.toLowerCase();
  const normalized = normalizePt(text);
  const emojis = countEmojis(text);

  if (eff.channel === 'PHONE' || !eff.emojisEnabled) {
    if (emojis > 0)
      out.push({ code: 'EMOJI_NOT_ALLOWED', detail: `${emojis} emoji(s) em canal/configuração sem emojis` });
  } else if (emojis > 2) {
    out.push({ code: 'TOO_MANY_EMOJIS', detail: `${emojis} emojis (máximo 2)` });
  }

  const words = normalized.split(/\s+/).filter(Boolean).length;
  if (words > WORD_LIMIT[eff.channel]) {
    out.push({ code: 'TOO_LONG', detail: `${words} palavras (máximo ${WORD_LIMIT[eff.channel]} no canal)` });
  }

  if (eff.channel === 'PHONE') {
    if (/[*_#`>|]|^\s*[-•]\s/m.test(text))
      out.push({ code: 'MARKUP_ON_PHONE', detail: 'marcação de texto em resposta falada' });
    if (/\d/.test(text))
      out.push({ code: 'DIGITS_ON_PHONE', detail: 'números devem ser falados por extenso' });
  }

  for (const term of INTIMATE) {
    if (containsWord(normalized, term)) out.push({ code: 'INTIMATE_TERM', detail: `"${term}"` });
  }
  for (const term of eff.vocabularyAvoid) {
    if (term.trim() && containsWord(lower, term.trim().toLowerCase()))
      out.push({ code: 'FORBIDDEN_TERM', detail: `"${term}"` });
  }
  if (eff.formality === 'FORMAL') {
    for (const m of CASUAL_MARKERS) {
      if (containsWord(lower, m)) out.push({ code: 'CASUAL_IN_FORMAL', detail: `"${m}"` });
    }
  }
  return out;
}
