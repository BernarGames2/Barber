'use client';

import type { MeResponse, MembershipSummary, TenantDto } from '@barber-voice/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BrandLoader } from '@/components/brand/brand-loader';
import { ApiError, api } from './api';

const TENANT_KEY = 'bv.activeTenant';

export function useMe() {
  return useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => api<MeResponse>('/v1/auth/me'),
    retry: false,
    staleTime: 60_000,
  });
}

interface SessionValue {
  me: MeResponse;
  tenantId: string;
  membership: MembershipSummary;
  tenant: TenantDto | undefined;
  setTenantId: (id: string) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession fora do SessionGate');
  return v;
}

/** Atalhos para o estabelecimento ativo. */
export function useTenant() {
  const s = useSession();
  return {
    tenantId: s.tenantId,
    role: s.membership.role,
    tz: s.tenant?.timezone ?? 'America/Sao_Paulo',
    tenant: s.tenant,
    base: `/v1/tenants/${s.tenantId}`,
    canManage: s.membership.role === 'OWNER' || s.membership.role === 'MANAGER',
  };
}

function readStoredTenant(): string | null {
  try {
    return window.localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    router.replace('/entrar');
  }, [qc, router]);
}

/**
 * Protege as áreas logadas: exige sessão válida e um estabelecimento.
 * A verificação real é sempre feita pela API; aqui apenas direcionamos o usuário.
 */
export function SessionGate({
  children,
  tenantId: forcedTenantId,
}: {
  children: ReactNode;
  tenantId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const logout = useLogout();
  const [selected, setSelected] = useState<string | null>(forcedTenantId ?? null);

  useEffect(() => {
    if (forcedTenantId) {
      setSelected(forcedTenantId);
      try {
        window.localStorage.setItem(TENANT_KEY, forcedTenantId);
      } catch {
        // armazenamento indisponível
      }
    } else {
      setSelected(readStoredTenant());
    }
  }, [forcedTenantId]);

  const memberships = me.data?.memberships ?? [];
  const membership = memberships.find((m) => m.tenantId === selected) ?? memberships[0];

  const tenant = useQuery<TenantDto, ApiError>({
    queryKey: ['tenant', membership?.tenantId],
    queryFn: () => api<TenantDto>(`/v1/tenants/${membership!.tenantId}`),
    enabled: Boolean(membership),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (me.error?.status === 401) router.replace(`/entrar?next=${encodeURIComponent(pathname)}`);
    else if (me.data && memberships.length === 0) router.replace('/onboarding');
  }, [me.error, me.data, memberships.length, router, pathname]);

  const setTenantId = useCallback((id: string) => {
    try {
      window.localStorage.setItem(TENANT_KEY, id);
    } catch {
      // armazenamento indisponível (modo privado): seleção vale só nesta aba
    }
    setSelected(id);
  }, []);

  const value = useMemo<SessionValue | null>(
    () =>
      me.data && membership
        ? { me: me.data, tenantId: membership.tenantId, membership, tenant: tenant.data, setTenantId, logout }
        : null,
    [me.data, membership, tenant.data, setTenantId, logout],
  );

  if (me.error && me.error.status !== 401) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-ink-600">{me.error.message}</p>
        <button className="text-sm font-medium text-ink-900 underline" onClick={() => me.refetch()}>
          Tentar novamente
        </button>
      </div>
    );
  }
  if (!value) return <BrandLoader />;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
