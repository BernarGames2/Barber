/**
 * Voice Studio — tipos do sistema de personagens.
 *
 * REGRA FUNDAMENTAL: a personagem (QUEM a recepcionista é) e a linguagem (COMO ela fala)
 * são eixos independentes. Uma barbearia de rock pode usar a Rocker em linguagem formal.
 */
export type Formality = 'FORMAL' | 'SEMIFORMAL' | 'INFORMAL';
export type SlangLevel = 'NONE' | 'LOW' | 'MODERATE' | 'HIGH';
export type CustomerNameUsage = 'NEVER' | 'GREETING' | 'NATURAL';
export type Channel = 'PHONE' | 'WHATSAPP';
export type PersonaSegment = 'BARBERSHOP' | 'SALON' | 'ANY';
export type Scale = 1 | 2 | 3 | 4 | 5;

export const FORMALITIES: readonly Formality[] = ['FORMAL', 'SEMIFORMAL', 'INFORMAL'];
export const SLANG_LEVELS: readonly SlangLevel[] = ['NONE', 'LOW', 'MODERATE', 'HIGH'];

/** Frases de exemplo escritas para a personagem, por formalidade (texto, sem emojis). */
export interface PersonaExamples {
  greeting: string;
  offer: string;
  confirm: string;
  farewell: string;
}

export interface SignaturePhrase {
  text: string;
  /** 'neutral' cabe em qualquer formalidade; 'casual' só em linguagem descontraída. */
  register: 'neutral' | 'casual';
}

export interface PersonaDefinition {
  key: string;
  name: string;
  segment: PersonaSegment;
  /** Nome com que se apresenta; null = "assistente virtual do <estabelecimento>". */
  defaultReceptionistName: string | null;
  tagline: string;
  description: string;
  personality: string;
  speakingStyle: string;
  culturalReferences: string | null;
  signaturePhrases: SignaturePhrase[];
  avoid: string[];
  examples: Record<Formality, PersonaExamples>;
  suggestedVoiceTags: string[];
  defaults: Pick<LanguageSettings, 'formality' | 'slangLevel' | 'enthusiasm' | 'relaxation'>;
}

export interface LanguageSettings {
  formality: Formality;
  slangLevel: SlangLevel;
  /** Só tem efeito no WhatsApp; no telefone emojis nunca são usados. */
  emojisEnabled: boolean;
  enthusiasm: Scale;
  /** Grau de descontração. */
  relaxation: Scale;
  useCustomerName: CustomerNameUsage;
  receptionistName: string | null;
  greeting: string | null;
  farewell: string | null;
  signatureExpressions: string[];
  vocabularyPrefer: string[];
  vocabularyAvoid: string[];
}

export const DEFAULT_LANGUAGE: LanguageSettings = {
  formality: 'SEMIFORMAL',
  slangLevel: 'LOW',
  emojisEnabled: false,
  enthusiasm: 3,
  relaxation: 3,
  useCustomerName: 'GREETING',
  receptionistName: null,
  greeting: null,
  farewell: null,
  signatureExpressions: [],
  vocabularyPrefer: [],
  vocabularyAvoid: [],
};

export interface LanguageAdjustment {
  field: 'slangLevel' | 'emojisEnabled' | 'relaxation' | 'enthusiasm';
  from: string;
  to: string;
  reason: string;
}

export interface EffectiveLanguage extends LanguageSettings {
  channel: Channel;
  adjustments: LanguageAdjustment[];
}
