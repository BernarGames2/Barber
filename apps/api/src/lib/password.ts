import { hash, verify } from '@node-rs/argon2';

/**
 * Hash de senha com Argon2id (padrão da biblioteca): memória 19 MiB, 2 iterações,
 * paralelismo 1 — configuração mínima recomendada pela OWASP.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Hash fixo usado quando o usuário não existe, para que o tempo de resposta não revele contas. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('barber-voice-dummy-password-0000');
  return dummyHash;
}
