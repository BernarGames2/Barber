import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

/**
 * Normalização de telefones. Armazenamos sempre em E.164 (ex.: +5511987654321).
 */
export function normalizePhone(input: string | null | undefined, defaultCountry: CountryCode = 'BR'): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function isValidPhone(input: string | null | undefined, defaultCountry: CountryCode = 'BR'): boolean {
  return normalizePhone(input, defaultCountry) !== null;
}

/** +5511987654321 → "(11) 98765-4321". Outros países: formato internacional. */
export function formatPhoneDisplay(e164: string | null | undefined): string {
  if (!e164) return '';
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  if (parsed.country === 'BR') return parsed.formatNational();
  return parsed.formatInternational();
}

/**
 * No WhatsApp, números de celular brasileiros às vezes chegam sem o nono dígito
 * (formato legado: 55 + DDD + 8 dígitos). Retorna as duas variantes para casar
 * o remetente com o cadastro do cliente.
 */
export function brazilMobileVariants(e164: string): string[] {
  const m = /^\+55(\d{2})(\d{8,9})$/.exec(e164);
  if (!m) return [e164];
  const ddd = m[1]!;
  const local = m[2]!;
  if (local.length === 9 && local.startsWith('9')) return [e164, `+55${ddd}${local.slice(1)}`];
  if (local.length === 8 && /^[6-9]/.test(local)) return [`+55${ddd}9${local}`, e164];
  return [e164];
}

/** Mascara telefone para logs: +5511987654321 → +55119****4321 */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  if (e164.length <= 8) return '****';
  return `${e164.slice(0, 5)}${'*'.repeat(Math.max(0, e164.length - 9))}${e164.slice(-4)}`;
}
