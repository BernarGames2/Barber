/**
 * Gera um UUID versão 7 (RFC 9562): 48 bits de timestamp Unix em milissegundos +
 * bits aleatórios. IDs ordenados por tempo melhoram a localidade dos índices B-tree
 * no PostgreSQL em comparação ao UUID v4.
 *
 * Usa `crypto.getRandomValues`, disponível no Node.js 22+ e nos navegadores.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  // 48 bits de timestamp (big-endian). Divisões evitam perda de precisão de bitwise em 32 bits.
  let ts = Math.floor(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // versão 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variante RFC 4122

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Extrai o timestamp (ms) de um UUID v7. Retorna null se não for v7. */
export function uuidv7Timestamp(id: string): number | null {
  if (!isUuid(id) || id[14] !== '7') return null;
  const hex = id.replace(/-/g, '').slice(0, 12);
  return Number.parseInt(hex, 16);
}
