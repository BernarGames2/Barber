/**
 * Normalização de texto em português do Brasil para análise determinística:
 * minúsculas, sem acentos, pontuação simplificada e números por extenso convertidos.
 */

export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizePt(text: string): string {
  return stripAccents(text.toLowerCase())
    .replace(/[ºª]/g, '') // 1º, 1ª
    .replace(/[“”"'!?;,()[\]{}*_~]/g, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/-feira\b/g, '')
    .replace(/(\p{L})-(\p{L})/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezasseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
};

const TENS: Record<string, number> = {
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
};

const UNIT_WORDS = 'um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove';
const TENS_WORDS = 'vinte|trinta|quarenta|cinquenta';
const SMALL_WORDS = Object.keys(SMALL_NUMBERS).join('|');

/**
 * Converte números por extenso (0–59) em dígitos, preservando o restante do texto.
 * Ex.: "tres e meia" → "3 e meia"; "vinte e duas" → "22"; "quinze pras cinco" → "15 pras 5".
 * Espera texto já normalizado por `normalizePt`.
 */
export function wordsToDigitsPt(text: string): string {
  return text
    .replace(new RegExp(`\\b(${TENS_WORDS}) e (${UNIT_WORDS})\\b`, 'g'), (_, t: string, u: string) =>
      String((TENS[t] ?? 0) + (SMALL_NUMBERS[u] ?? 0)),
    )
    .replace(new RegExp(`\\b(${TENS_WORDS})\\b`, 'g'), (_, t: string) => String(TENS[t] ?? 0))
    .replace(new RegExp(`\\b(${SMALL_WORDS})\\b`, 'g'), (_, w: string) => String(SMALL_NUMBERS[w] ?? 0));
}
