'use client';

import type {
  AppointmentDto,
  AvailabilityResponse,
  ClosureDto,
  ConsentStateDto,
  ConversationDetailDto,
  ConversationSummaryDto,
  ReceptionistStatusDto,
  CustomerDto,
  DashboardSummaryDto,
  OnboardingStatusDto,
  ProfessionalDto,
  ServiceDto,
  TimeOffDto,
  WeeklyIntervalDto,
} from '@barber-voice/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ApiError } from './api';
import { api } from './api';
import { useTenant } from './session';

export function useServices() {
  const { base, tenantId } = useTenant();
  return useQuery<ServiceDto[], ApiError>({
    queryKey: ['services', tenantId],
    queryFn: async () => (await api<{ services: ServiceDto[] }>(`${base}/services`)).services,
  });
}

export function useProfessionals() {
  const { base, tenantId } = useTenant();
  return useQuery<ProfessionalDto[], ApiError>({
    queryKey: ['professionals', tenantId],
    queryFn: async () =>
      (await api<{ professionals: ProfessionalDto[] }>(`${base}/professionals`)).professionals,
  });
}

export function useBusinessHours() {
  const { base, tenantId } = useTenant();
  return useQuery<WeeklyIntervalDto[], ApiError>({
    queryKey: ['business-hours', tenantId],
    queryFn: async () => (await api<{ intervals: WeeklyIntervalDto[] }>(`${base}/business-hours`)).intervals,
  });
}

export function useClosures() {
  const { base, tenantId } = useTenant();
  return useQuery<ClosureDto[], ApiError>({
    queryKey: ['closures', tenantId],
    queryFn: async () => (await api<{ closures: ClosureDto[] }>(`${base}/closures`)).closures,
  });
}

export function useOnboarding() {
  const { base, tenantId } = useTenant();
  return useQuery<OnboardingStatusDto, ApiError>({
    queryKey: ['onboarding', tenantId],
    queryFn: () => api<OnboardingStatusDto>(`${base}/onboarding`),
    // o checklist muda a cada etapa: nunca exibir status antigo do cache
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useAppointments(from: string, to: string, professionalId?: string) {
  const { base, tenantId } = useTenant();
  const qs = new URLSearchParams({ from, to, ...(professionalId ? { professionalId } : {}) });
  return useQuery<AppointmentDto[], ApiError>({
    queryKey: ['appointments', tenantId, from, to, professionalId ?? 'all'],
    queryFn: async () =>
      (await api<{ appointments: AppointmentDto[] }>(`${base}/appointments?${qs}`)).appointments,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useTimeOff(fromIso: string, toIso: string) {
  const { base, tenantId } = useTenant();
  const qs = new URLSearchParams({ from: fromIso, to: toIso });
  return useQuery<TimeOffDto[], ApiError>({
    queryKey: ['time-off', tenantId, fromIso, toIso],
    queryFn: async () => (await api<{ timeOff: TimeOffDto[] }>(`${base}/time-off?${qs}`)).timeOff,
    placeholderData: keepPreviousData,
  });
}

export function useAvailability(params: {
  serviceIds: string[];
  professionalId?: string | undefined;
  date: string;
  enabled?: boolean;
  excludeAppointmentId?: string | undefined;
}) {
  const { base, tenantId } = useTenant();
  const qs = new URLSearchParams({
    serviceIds: params.serviceIds.join(','),
    from: params.date,
    to: params.date,
    ...(params.professionalId ? { professionalId: params.professionalId } : {}),
    ...(params.excludeAppointmentId ? { excludeAppointmentId: params.excludeAppointmentId } : {}),
  });
  return useQuery<AvailabilityResponse, ApiError>({
    queryKey: [
      'availability',
      tenantId,
      params.serviceIds.join(','),
      params.professionalId ?? 'any',
      params.date,
      params.excludeAppointmentId ?? '',
    ],
    queryFn: () => api<AvailabilityResponse>(`${base}/availability?${qs}`),
    enabled: (params.enabled ?? true) && params.serviceIds.length > 0,
    staleTime: 10_000,
  });
}

export function useCustomers(q: string, offset = 0) {
  const { base, tenantId } = useTenant();
  const qs = new URLSearchParams({ ...(q ? { q } : {}), limit: '30', offset: String(offset) });
  return useQuery<{ customers: CustomerDto[]; total: number }, ApiError>({
    queryKey: ['customers', tenantId, q, offset],
    queryFn: () => api(`${base}/customers?${qs}`),
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: string) {
  const { base, tenantId } = useTenant();
  return useQuery<
    { customer: CustomerDto; appointments: AppointmentDto[]; consents: ConsentStateDto[] },
    ApiError
  >({
    queryKey: ['customer', tenantId, id],
    queryFn: () => api(`${base}/customers/${id}`),
  });
}

export function useDashboard() {
  const { base, tenantId } = useTenant();
  return useQuery<DashboardSummaryDto, ApiError>({
    queryKey: ['dashboard', tenantId],
    queryFn: () => api<DashboardSummaryDto>(`${base}/dashboard/summary`),
    refetchInterval: 60_000,
  });
}

export function useReceptionistStatus() {
  const { base, tenantId } = useTenant();
  return useQuery<ReceptionistStatusDto, ApiError>({
    queryKey: ['receptionist-status', tenantId],
    queryFn: () => api(`${base}/receptionist/status`),
  });
}

export type ConversationFilter = 'active' | 'handoff' | 'closed' | 'simulations';

export function useConversations(filter: ConversationFilter) {
  const { base, tenantId } = useTenant();
  const qs =
    filter === 'simulations'
      ? 'simulations=true'
      : filter === 'handoff'
        ? 'status=HANDOFF'
        : filter === 'closed'
          ? 'status=CLOSED'
          : 'status=OPEN';
  return useQuery<ConversationSummaryDto[], ApiError>({
    queryKey: ['conversations', tenantId, filter],
    queryFn: () => api(`${base}/conversations?${qs}`),
    refetchInterval: 15_000,
  });
}

export function useConversation(id: string | null) {
  const { base, tenantId } = useTenant();
  return useQuery<ConversationDetailDto, ApiError>({
    queryKey: ['conversation', tenantId, id],
    queryFn: () => api(`${base}/conversations/${id}`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });
}
