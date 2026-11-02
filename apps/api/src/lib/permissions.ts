import type { MemberRole } from '@barber-voice/contracts';
import type { FastifyRequest } from 'fastify';
import type { ServiceContext, TenantContext } from '../context';
import { Errors } from './errors';

export type Permission =
  | 'tenant:read'
  | 'tenant:write'
  | 'schedule:write'
  | 'catalog:write'
  | 'appointments:write'
  | 'appointments:override-hours'
  | 'customers:read'
  | 'customers:write'
  | 'customers:anonymize'
  | 'dashboard:read'
  | 'members:manage'
  | 'billing:manage'
  | 'ai:configure'
  | 'audit:read';

const ALL: Permission[] = [
  'tenant:read',
  'tenant:write',
  'schedule:write',
  'catalog:write',
  'appointments:write',
  'appointments:override-hours',
  'customers:read',
  'customers:write',
  'customers:anonymize',
  'dashboard:read',
  'members:manage',
  'billing:manage',
  'ai:configure',
  'audit:read',
];

/** Matriz de permissões por papel. Mudanças aqui exigem atualizar docs/SECURITY.md. */
const MATRIX: Record<MemberRole, ReadonlySet<Permission>> = {
  OWNER: new Set(ALL),
  MANAGER: new Set(ALL.filter((p) => p !== 'billing:manage' && p !== 'members:manage')),
  STAFF: new Set<Permission>([
    'tenant:read',
    'appointments:write',
    'customers:read',
    'customers:write',
    'dashboard:read',
  ]),
};

export function can(role: MemberRole | null | undefined, permission: Permission): boolean {
  return Boolean(role && MATRIX[role].has(permission));
}

export function requireTenant(request: FastifyRequest): TenantContext {
  if (!request.tenantCtx) throw Errors.forbidden();
  return request.tenantCtx;
}

export function requirePermission(request: FastifyRequest, permission: Permission): TenantContext {
  const ctx = requireTenant(request);
  if (!can(ctx.role, permission)) throw Errors.forbidden();
  return ctx;
}

export function serviceContext(request: FastifyRequest, permission?: Permission): ServiceContext {
  const ctx = permission ? requirePermission(request, permission) : requireTenant(request);
  return {
    deps: request.server.deps,
    tenant: ctx.tenant,
    actor: { userId: request.auth?.userId ?? null, role: ctx.role, type: 'USER' },
    meta: requestMeta(request),
  };
}

export function requestMeta(request: FastifyRequest): { ip: string; userAgent?: string } {
  const ua = request.headers['user-agent'];
  return { ip: request.ip, ...(ua ? { userAgent: ua.slice(0, 300) } : {}) };
}
