/**
 * Indicadores do painel. Todos calculados a partir de dados reais do banco.
 * "Faturamento registrado" soma apenas atendimentos CONCLUÍDOS, pelo preço cadastrado
 * no momento da reserva — não é faturamento contábil nem estimativa.
 */
export interface DashboardSummaryDto {
  timezone: string;
  date: string;
  appointments: {
    today: number;
    week: number;
    month: number;
    upcomingToday: number;
  };
  customers: {
    total: number;
    newThisMonth: number;
    returningThisMonth: number;
  };
  revenue: {
    /** Soma de atendimentos concluídos no mês (centavos). */
    registeredThisMonthCents: number;
    /** Quantos atendimentos concluídos têm preço "a partir de"/"sob consulta" (valor parcial). */
    estimatedItemsThisMonth: number;
  };
  quality: {
    cancellationsThisMonth: number;
    noShowsThisMonth: number;
  };
  occupancy: {
    /** Minutos ocupados / minutos disponíveis na semana corrente (0–1), ou null sem jornada. */
    weekRate: number | null;
  };
  topServices: { serviceId: string; name: string; count: number }[];
  topProfessionals: { professionalId: string; name: string; count: number }[];
  busiestHours: { hour: number; count: number }[];
  /** Canais ainda não integrados aparecem como null — nunca com números fictícios. */
  channels: {
    phone: { received: number; answered: number; missed: number } | null;
    whatsapp: { conversations: number } | null;
  };
  todayAgenda: {
    id: string;
    startsAt: string;
    endsAt: string;
    status: string;
    customerName: string;
    professionalName: string;
    services: string[];
  }[];
}
