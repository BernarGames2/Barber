import type { AppointmentSource, AppointmentStatus } from './appointments';
import type { MemberRole } from './auth';
import type { BusinessCategory } from './tenant';

export const CATEGORY_LABELS: Record<BusinessCategory, string> = {
  BARBERSHOP: 'Barbearia',
  BEAUTY_SALON: 'Salão de beleza',
  UNISEX_SALON: 'Salão unissex',
  HAIR_STUDIO: 'Estúdio de cabelo',
  CURLY_HAIR_STUDIO: 'Estúdio de cachos',
  BRAIDS_STUDIO: 'Estúdio de tranças',
  COLOR_STUDIO: 'Especialista em coloração',
  AESTHETICS: 'Espaço de estética',
  OTHER: 'Outro',
};

export const ROLE_LABELS: Record<MemberRole, string> = {
  OWNER: 'Proprietário',
  MANAGER: 'Gerente',
  STAFF: 'Equipe',
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  HELD: 'Reservado (aguardando)',
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
  NO_SHOW: 'Não compareceu',
  EXPIRED: 'Expirado',
};

export const APPOINTMENT_SOURCE_LABELS: Record<AppointmentSource, string> = {
  DASHBOARD: 'Painel',
  AI_PHONE: 'IA · Telefone',
  AI_WHATSAPP: 'IA · WhatsApp',
  ONLINE: 'Online',
  WALK_IN: 'Balcão',
  IMPORT: 'Importação',
};

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta',
  6: 'Sábado',
  7: 'Domingo',
};

export const TIME_OFF_KIND_LABELS: Record<string, string> = {
  DAY_OFF: 'Folga',
  VACATION: 'Férias',
  BLOCK: 'Bloqueio',
  SICK_LEAVE: 'Atestado',
  OTHER: 'Outro',
};

export const CLOSURE_KIND_LABELS: Record<string, string> = {
  HOLIDAY: 'Feriado',
  CLOSURE: 'Fechado',
  EVENT: 'Evento',
  OTHER: 'Outro',
};

export const SLOT_REJECTION_LABELS: Record<string, string> = {
  INVALID_DURATION: 'Duração inválida.',
  IN_PAST: 'Este horário já passou.',
  TOO_SOON: 'Horário não respeita a antecedência mínima.',
  TOO_FAR: 'Horário além do limite de dias para agendamento.',
  CROSSES_MIDNIGHT: 'O atendimento não pode atravessar a meia-noite.',
  CLOSED: 'O estabelecimento está fechado neste horário.',
  OUTSIDE_WORKING_HOURS: 'O profissional não atende neste horário.',
  TIME_OFF: 'O profissional está de folga ou com horário bloqueado.',
  CONFLICT: 'Horário já ocupado.',
};
