import type { MemberRole } from '@barber-voice/contracts';
import type { Database } from '@barber-voice/db';
import type { Config } from './config';
import type { Mailer } from './lib/mailer';
import type { LlmClient } from './modules/receptionist/llm';

export interface AppDeps {
  config: Config;
  /** Conexão com o papel da aplicação (sujeito a RLS). */
  db: Database;
  mailer: Mailer;
  /** Relógio injetável (testes controlam "agora"). */
  clock: () => Date;
  /** Modelo de linguagem da recepcionista; `null` = integração não configurada. */
  llm: LlmClient | null;
}

export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  platformRole: 'SUPERADMIN' | 'SUPPORT' | null;
}

export interface TenantSettings {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  slotIntervalMin: number;
  minBookingNoticeMin: number;
  maxBookingDaysAhead: number;
  cancellationMinNoticeMin: number;
  isDemo: boolean;
}

export interface TenantContext {
  tenantId: string;
  role: MemberRole;
  tenant: TenantSettings;
}

/** Contexto passado aos serviços de estabelecimento. */
export interface ServiceContext {
  deps: AppDeps;
  tenant: TenantSettings;
  actor: { userId: string | null; role: MemberRole | null; type: 'USER' | 'SYSTEM' | 'AI' };
  meta: { ip?: string; userAgent?: string };
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
    tenantCtx: TenantContext | null;
  }
}
