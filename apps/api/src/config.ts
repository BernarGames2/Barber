import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),
  DATABASE_ADMIN_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().optional(),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),
  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default('bv_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  COOKIE_SECURE: bool(false),
  TRUST_PROXY: z.string().default('loopback'),
  ENCRYPTION_KEY: z.string().optional(),
  MAIL_PROVIDER: z.enum(['console', 'memory']).default('console'),
  MAIL_FROM: z.string().default('Barber Voice <nao-responda@barbervoice.com.br>'),
  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().min(10).default(300),
  /** Recepcionista de IA (Anthropic). Sem chave, o atendimento por IA fica "não integrado". */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-5-5'),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high']).default('medium'),
});

export type Config = z.infer<typeof schema> & { allowedOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${msg}`);
  }
  const cfg = parsed.data;
  const allowedOrigins = cfg.WEB_ORIGIN.split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (cfg.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (!cfg.COOKIE_SECURE) problems.push('COOKIE_SECURE deve ser true em produção (HTTPS).');
    if (allowedOrigins.some((o) => o.startsWith('http://')))
      problems.push('WEB_ORIGIN deve usar https em produção.');
    if (!cfg.ENCRYPTION_KEY) problems.push('ENCRYPTION_KEY é obrigatório em produção.');
    if (/barber_(app|owner)_dev/.test(cfg.DATABASE_URL))
      problems.push('Use senhas fortes de banco em produção.');
    if (problems.length)
      throw new Error(`Configuração insegura para produção:\n  - ${problems.join('\n  - ')}`);
  }
  if (cfg.ENCRYPTION_KEY && Buffer.from(cfg.ENCRYPTION_KEY, 'base64').length !== 32) {
    throw new Error('ENCRYPTION_KEY deve ter 32 bytes em base64 (openssl rand -base64 32).');
  }
  return { ...cfg, allowedOrigins };
}
