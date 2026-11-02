import { z } from 'zod';
import { optionalPhoneSchema, optionalText } from './common';

export const CONVERSATION_CHANNELS = ['WHATSAPP', 'PHONE'] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];
export type ConversationStatus = 'OPEN' | 'HANDOFF' | 'CLOSED';
export type ConversationMessageRole = 'CUSTOMER' | 'ASSISTANT' | 'STAFF' | 'SYSTEM' | 'TOOL';

/** Simulador do Voice Studio: a agenda real é consultada, nada é gravado. */
export const startSimulationSchema = z.object({
  channel: z.enum(CONVERSATION_CHANNELS),
  /** Telefone de um cliente já cadastrado, para testar "meus agendamentos" (opcional). */
  contactPhone: optionalPhoneSchema,
  contactName: optionalText(80),
});
export type StartSimulationInput = z.infer<typeof startSimulationSchema>;

export const customerMessageSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Escreva uma mensagem')
    .max(1000, 'Mensagem muito longa (máximo de 1000 caracteres)'),
});

export const conversationListQuerySchema = z.object({
  status: z.enum(['OPEN', 'HANDOFF', 'CLOSED']).optional(),
  simulations: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export interface ConversationSummaryDto {
  id: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  isSimulation: boolean;
  contactName: string | null;
  contactPhone: string | null;
  customer: { id: string; name: string } | null;
  handoffReason: string | null;
  messageCount: number;
  lastMessage: { role: ConversationMessageRole; content: string; at: string } | null;
  lastMessageAt: string;
  createdAt: string;
}

export interface ConversationMessageDto {
  id: string;
  role: ConversationMessageRole;
  content: string;
  toolName: string | null;
  /** Só para mensagens de ferramenta: houve erro? */
  toolError: boolean | null;
  /** Só para respostas da recepcionista: quantas versões o verificador descartou e se houve resposta segura. */
  verification: { rejected: number; fallback: string | null } | null;
  createdAt: string;
}

export interface ConversationDetailDto extends ConversationSummaryDto {
  personaVersion: number | null;
  instructionsHash: string | null;
  model: string | null;
  messages: ConversationMessageDto[];
}

export interface CustomerTurnDto {
  reply: string | null;
  /** Ligações: texto normalizado para fala. */
  speech: string | null;
  status: ConversationStatus;
  handoffReason: string | null;
  conversation: ConversationDetailDto;
}

export interface ReceptionistStatusDto {
  llm: { configured: boolean; provider: string | null; model: string | null };
  receptionistConfigured: boolean;
}
