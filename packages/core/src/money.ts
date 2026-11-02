/** Valores monetários são sempre inteiros em centavos (evita erros de ponto flutuante). */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 4550 → "R$ 45,50" (com espaço normal, não o NBSP do Intl). */
export function formatBRL(cents: number): string {
  return BRL.format(cents / 100).replace(/ /g, ' ');
}

/** Converte "45", "45,5", "45,50", "1.234,56" ou "R$ 45,00" para centavos. */
export function parseBRL(input: string): number | null {
  const clean = input.replace(/R\$\s?/i, '').replace(/\s/g, '');
  if (!clean) return null;
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(clean);
  if (!m) {
    const dot = /^(\d+)\.(\d{1,2})$/.exec(clean);
    if (!dot) return null;
    return Number(dot[1]) * 100 + Number(dot[2]!.padEnd(2, '0'));
  }
  return Number(m[1]!.replace(/\./g, '')) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0);
}

export type PriceType = 'FIXED' | 'STARTING_AT' | 'ON_REQUEST';

/** Texto de preço respeitando o tipo cadastrado. Nunca inventa valor. */
export function describePrice(priceCents: number | null, priceType: PriceType): string {
  if (priceType === 'ON_REQUEST' || priceCents === null) return 'sob consulta';
  if (priceType === 'STARTING_AT') return `a partir de ${formatBRL(priceCents)}`;
  return formatBRL(priceCents);
}
