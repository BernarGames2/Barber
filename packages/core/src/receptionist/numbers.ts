/**
 * Conversão de números por extenso (PT-BR) para dígitos, 0–999.999, respeitando a gramática:
 * "e" só une centenas→dezenas/unidades, dezenas→unidades e milhar→resto. Assim
 * "quinze e trinta" continua sendo "15 e 30" (horário), e não 45.
 * Espera texto em minúsculas e sem acentos.
 */

const UNITS: Record<string, number> = {
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
};

const TEENS: Record<string, number> = {
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
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
};

const HUNDREDS: Record<string, number> = {
  cento: 100,
  duzentos: 200,
  duzentas: 200,
  trezentos: 300,
  trezentas: 300,
  quatrocentos: 400,
  quatrocentas: 400,
  quinhentos: 500,
  quinhentas: 500,
  seiscentos: 600,
  seiscentas: 600,
  setecentos: 700,
  setecentas: 700,
  oitocentos: 800,
  oitocentas: 800,
  novecentos: 900,
  novecentas: 900,
};

type Kind = 'unit' | 'teen' | 'ten' | 'hundred' | 'cem' | 'mil';

function kindOf(word: string): { kind: Kind; value: number } | null {
  if (word in UNITS) return { kind: 'unit', value: UNITS[word]! };
  if (word in TEENS) return { kind: 'teen', value: TEENS[word]! };
  if (word in TENS) return { kind: 'ten', value: TENS[word]! };
  if (word in HUNDREDS) return { kind: 'hundred', value: HUNDREDS[word]! };
  if (word === 'cem') return { kind: 'cem', value: 100 };
  if (word === 'mil') return { kind: 'mil', value: 1000 };
  return null;
}

/** O que pode vir depois de cada tipo de palavra, ligado por "e" (ou direto, no caso de "mil"). */
const AFTER_E: Record<Kind, Kind[]> = {
  hundred: ['ten', 'teen', 'unit'],
  ten: ['unit'],
  mil: ['hundred', 'cem', 'ten', 'teen', 'unit'],
  teen: [],
  unit: [],
  cem: [],
};

export function numberWordsToDigitsPt(text: string): string {
  const tokens = text.split(/(\s+)/); // mantém os espaços para reconstruir o texto
  const words: { word: string; index: number }[] = [];
  tokens.forEach((t, index) => {
    if (!/^\s+$/.test(t) && t !== '') words.push({ word: t, index });
  });

  const out = [...tokens];
  let i = 0;
  while (i < words.length) {
    const first = kindOf(words[i]!.word);
    if (!first) {
      i++;
      continue;
    }
    let total = 0;
    let current = first.value;
    let last: Kind = first.kind;
    let j = i + 1;
    if (first.kind === 'mil') {
      total = 1000;
      current = 0;
    }
    while (j < words.length) {
      const w = words[j]!.word;
      const k = kindOf(w);
      // "mil" multiplica o que veio antes: "dois mil", "trinta e cinco mil"
      if (k?.kind === 'mil' && last !== 'mil' && total === 0) {
        total = current * 1000;
        current = 0;
        last = 'mil';
        j++;
        continue;
      }
      // "mil duzentos" (sem "e") também é válido
      if (k && last === 'mil' && (k.kind === 'hundred' || k.kind === 'cem')) {
        current = k.value;
        last = k.kind;
        j++;
        continue;
      }
      if (w === 'e' && j + 1 < words.length) {
        const next = kindOf(words[j + 1]!.word);
        if (next && AFTER_E[last].includes(next.kind)) {
          current += next.value;
          last = next.kind;
          j += 2;
          continue;
        }
      }
      break;
    }
    const value = total + current;
    // substitui a primeira palavra pelo número e apaga as demais (e os espaços entre elas)
    const startIdx = words[i]!.index;
    const endIdx = words[j - 1]!.index;
    out[startIdx] = String(value);
    for (let t = startIdx + 1; t <= endIdx; t++) out[t] = '';
    i = j;
  }
  return out.join('');
}
