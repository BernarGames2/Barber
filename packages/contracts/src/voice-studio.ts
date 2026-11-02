import type {
  CompiledSection,
  EffectiveLanguage,
  Formality,
  LanguageAdjustment,
  PersonaExamples,
  PersonaSegment,
  SlangLevel,
} from '@barber-voice/core';
import { z } from 'zod';
import { optionalText, uuidSchema } from './common';

const shortList = (maxItems: number, maxLen: number) =>
  z.array(z.string().trim().min(1).max(maxLen)).max(maxItems).default([]);

const scale = z.number().int().min(1).max(5);

/** Configuração da recepcionista. Personagem e linguagem são campos independentes. */
export const receptionistConfigSchema = z.object({
  personaId: uuidSchema,
  receptionistName: optionalText(40),
  formality: z.enum(['FORMAL', 'SEMIFORMAL', 'INFORMAL']),
  slangLevel: z.enum(['NONE', 'LOW', 'MODERATE', 'HIGH']),
  emojisEnabled: z.boolean(),
  enthusiasm: scale,
  relaxation: scale,
  useCustomerName: z.enum(['NEVER', 'GREETING', 'NATURAL']),
  // recursos do Voice Studio completo (dependem do plano)
  greeting: optionalText(200),
  farewell: optionalText(200),
  signatureExpressions: shortList(8, 60),
  vocabularyPrefer: shortList(20, 40),
  vocabularyAvoid: shortList(20, 40),
  businessInstructions: optionalText(1500),
});
export type ReceptionistConfigInput = z.infer<typeof receptionistConfigSchema>;

export const instructionsPreviewSchema = receptionistConfigSchema.extend({
  channel: z.enum(['PHONE', 'WHATSAPP']),
});

export const customPersonaSchema = z.object({
  basePersonaId: uuidSchema,
  name: z.string().trim().min(2, 'Nome muito curto').max(40),
  tagline: z.string().trim().min(5).max(120),
  personality: z.string().trim().min(20, 'Descreva a personalidade com pelo menos 20 caracteres').max(600),
  speakingStyle: z.string().trim().min(10).max(400),
  signaturePhrases: shortList(6, 60),
  presentation: z.string().trim().min(10, 'Escreva a mensagem de apresentação').max(200),
});
export type CustomPersonaInput = z.infer<typeof customPersonaSchema>;

export interface PersonaSummaryDto {
  id: string;
  key: string;
  version: number;
  name: string;
  segment: PersonaSegment;
  isCustom: boolean;
  tagline: string;
  description: string;
  personality: string;
  speakingStyle: string;
  defaultReceptionistName: string | null;
  suggestedVoiceTags: string[];
  defaults: { formality: Formality; slangLevel: SlangLevel; enthusiasm: number; relaxation: number };
  examples: Record<Formality, PersonaExamples>;
}

export interface ReceptionistConfigDto extends ReceptionistConfigInput {
  personaVersion: number;
  voiceId: string | null;
  version: number;
  updatedAt: string;
}

export interface VoiceStudioDto {
  personas: PersonaSummaryDto[];
  config: ReceptionistConfigDto | null;
  effective: { PHONE: EffectiveLanguage; WHATSAPP: EffectiveLanguage } | null;
  features: { advancedLanguage: boolean; customPersonas: boolean };
  /** Integrações necessárias para prévia de voz e simulador ainda não configuradas. */
  integrations: { tts: boolean; llm: boolean };
}

export interface InstructionsPreviewDto {
  channel: 'PHONE' | 'WHATSAPP';
  hash: string;
  sections: CompiledSection[];
  adjustments: LanguageAdjustment[];
}
