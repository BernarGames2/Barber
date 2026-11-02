import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token opaco de alta entropia (256 bits), seguro para URL. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Criptografia simétrica AES-256-GCM para segredos de integrações (tokens de WhatsApp,
 * telefonia etc.). Formato: v1.<iv>.<tag>.<ciphertext> (base64url). O prefixo de versão
 * permite rotação de chave no futuro.
 */
export function encryptSecret(plain: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('Chave de criptografia inválida');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(payload: string, keyBase64: string): string {
  const [version, ivB, tagB, encB] = payload.split('.');
  if (version !== 'v1' || !ivB || !tagB || !encB) throw new Error('Formato de segredo inválido');
  const key = Buffer.from(keyBase64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64url')), decipher.final()]).toString('utf8');
}
