import type {
  Channel,
  EffectiveLanguage,
  LanguageAdjustment,
  LanguageSettings,
  Scale,
  SlangLevel,
} from './types';

const SLANG_ORDER: SlangLevel[] = ['NONE', 'LOW', 'MODERATE', 'HIGH'];

const clampScale = (n: number): Scale => Math.min(5, Math.max(1, Math.round(n))) as Scale;

/**
 * Resolve combinações contraditórias de forma TRANSPARENTE: o valor efetivo e o motivo
 * de cada ajuste são devolvidos para a interface mostrar ao proprietário.
 *
 * - Formal: sem gírias e descontração no máximo 2 (o sabor da personagem vem da escolha de palavras).
 * - Semiformal: gírias no máximo "moderada" e descontração no máximo 4.
 * - Telefone: emojis sempre desligados (não existem na fala).
 */
export function resolveEffectiveLanguage(settings: LanguageSettings, channel: Channel): EffectiveLanguage {
  const adjustments: LanguageAdjustment[] = [];
  let slang = settings.slangLevel;
  let relaxation = clampScale(settings.relaxation);
  const enthusiasm = clampScale(settings.enthusiasm);
  let emojis = settings.emojisEnabled;

  const capSlang = (max: SlangLevel, reason: string) => {
    if (SLANG_ORDER.indexOf(slang) > SLANG_ORDER.indexOf(max)) {
      adjustments.push({ field: 'slangLevel', from: slang, to: max, reason });
      slang = max;
    }
  };
  const capRelaxation = (max: Scale, reason: string) => {
    if (relaxation > max) {
      adjustments.push({ field: 'relaxation', from: String(relaxation), to: String(max), reason });
      relaxation = max;
    }
  };

  if (settings.formality === 'FORMAL') {
    capSlang('NONE', 'Linguagem formal não usa gírias.');
    capRelaxation(2, 'Linguagem formal mantém um tom mais contido.');
  } else if (settings.formality === 'SEMIFORMAL') {
    capSlang('MODERATE', 'Linguagem semiformal usa gírias no máximo de forma moderada.');
    capRelaxation(4, 'Linguagem semiformal limita a descontração.');
  }

  if (channel === 'PHONE' && emojis) {
    adjustments.push({
      field: 'emojisEnabled',
      from: 'true',
      to: 'false',
      reason: 'Emojis não existem em ligações telefônicas.',
    });
    emojis = false;
  }

  return {
    ...settings,
    slangLevel: slang,
    relaxation,
    enthusiasm,
    emojisEnabled: emojis,
    channel,
    adjustments,
  };
}
