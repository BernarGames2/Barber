import type {
  CustomPersonaInput,
  InstructionsPreviewDto,
  PersonaSummaryDto,
  ReceptionistConfigDto,
  ReceptionistConfigInput,
  VoiceStudioDto,
} from '@barber-voice/contracts';
import { CATEGORY_LABELS } from '@barber-voice/contracts';
import {
  type BusinessFacts,
  type Channel,
  type IsoWeekday,
  type LanguageSettings,
  PERSONA_LIBRARY,
  type PersonaDefinition,
  type Scale,
  WEEKDAY_NAMES_PT,
  compileReceptionistInstructions,
  describePrice,
  formatPhoneDisplay,
  normalizeTime,
  resolveEffectiveLanguage,
} from '@barber-voice/core';
import {
  PG_ERROR,
  type Tx,
  businessHours,
  personas,
  pgErrorCode,
  professionalServices,
  professionals,
  receptionistConfigs,
  services,
  tenants,
  withTenant,
} from '@barber-voice/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { ServiceContext } from '../../context';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { getTenantPlan, planFeatureRequired } from '../../lib/plan';
import { slugify } from '../../lib/serialize';

type PersonaRow = typeof personas.$inferSelect;
type ConfigRow = typeof receptionistConfigs.$inferSelect;

const LIBRARY_ORDER = new Map(PERSONA_LIBRARY.map((p, i) => [p.key, i]));

function toSummary(row: PersonaRow): PersonaSummaryDto {
  const d = row.definition;
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    name: row.name,
    segment: row.segment,
    isCustom: row.tenantId !== null,
    tagline: d.tagline,
    description: d.description,
    personality: d.personality,
    speakingStyle: d.speakingStyle,
    defaultReceptionistName: d.defaultReceptionistName,
    suggestedVoiceTags: d.suggestedVoiceTags,
    defaults: d.defaults,
    examples: d.examples,
  };
}

function toConfigDto(c: ConfigRow): ReceptionistConfigDto {
  return {
    personaId: c.personaId,
    personaVersion: c.personaVersion,
    receptionistName: c.receptionistName,
    voiceId: c.voiceId,
    formality: c.formality,
    slangLevel: c.slangLevel,
    emojisEnabled: c.emojisEnabled,
    enthusiasm: c.enthusiasm,
    relaxation: c.relaxation,
    useCustomerName: c.useCustomerName,
    greeting: c.greeting,
    farewell: c.farewell,
    signatureExpressions: c.signatureExpressions,
    vocabularyPrefer: c.vocabularyPrefer,
    vocabularyAvoid: c.vocabularyAvoid,
    businessInstructions: c.businessInstructions,
    version: c.version,
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toLanguageSettings(c: Omit<ReceptionistConfigInput, 'personaId'>): LanguageSettings {
  return {
    formality: c.formality,
    slangLevel: c.slangLevel,
    emojisEnabled: c.emojisEnabled,
    enthusiasm: c.enthusiasm as Scale,
    relaxation: c.relaxation as Scale,
    useCustomerName: c.useCustomerName,
    receptionistName: c.receptionistName ?? null,
    greeting: c.greeting ?? null,
    farewell: c.farewell ?? null,
    signatureExpressions: c.signatureExpressions ?? [],
    vocabularyPrefer: c.vocabularyPrefer ?? [],
    vocabularyAvoid: c.vocabularyAvoid ?? [],
  };
}

async function listPersonaRows(tx: Tx): Promise<PersonaRow[]> {
  const rows = await tx.select().from(personas).where(eq(personas.active, true));
  return rows.sort((a, b) => {
    if (!a.tenantId && !b.tenantId)
      return (LIBRARY_ORDER.get(a.key) ?? 99) - (LIBRARY_ORDER.get(b.key) ?? 99);
    if (!a.tenantId) return -1;
    if (!b.tenantId) return 1;
    return a.name.localeCompare(b.name);
  });
}

async function visiblePersona(tx: Tx, personaId: string): Promise<PersonaRow> {
  // RLS: só a biblioteca e as personagens do próprio estabelecimento são visíveis
  const [row] = await tx
    .select()
    .from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.active, true)))
    .limit(1);
  if (!row) throw Errors.unprocessable('INVALID_PERSONA', 'Personagem não encontrada.');
  return row;
}

const hasAdvanced = (i: ReceptionistConfigInput) =>
  Boolean(
    i.greeting ||
    i.farewell ||
    i.businessInstructions ||
    i.signatureExpressions.length ||
    i.vocabularyPrefer.length ||
    i.vocabularyAvoid.length,
  );

export async function getVoiceStudio(ctx: ServiceContext): Promise<VoiceStudioDto> {
  const plan = await getTenantPlan(ctx.deps.db, ctx.tenant.id);
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const rows = await listPersonaRows(tx);
    const [config] = await tx.select().from(receptionistConfigs).limit(1);
    const dto = config ? toConfigDto(config) : null;
    return {
      personas: rows.map(toSummary),
      config: dto,
      effective: dto
        ? {
            PHONE: resolveEffectiveLanguage(toLanguageSettings(dto), 'PHONE'),
            WHATSAPP: resolveEffectiveLanguage(toLanguageSettings(dto), 'WHATSAPP'),
          }
        : null,
      features: {
        advancedLanguage: Boolean(plan?.features.voiceStudio),
        customPersonas: Boolean(plan?.features.customPersonas),
      },
      // Voz (TTS) ainda sem provedor; o modelo de linguagem depende de ANTHROPIC_API_KEY.
      integrations: { tts: false, llm: Boolean(ctx.deps.llm) },
    };
  });
}

export async function saveReceptionistConfig(
  ctx: ServiceContext,
  input: ReceptionistConfigInput,
): Promise<VoiceStudioDto> {
  const plan = await getTenantPlan(ctx.deps.db, ctx.tenant.id);
  if (hasAdvanced(input) && !plan?.features.voiceStudio) throw planFeatureRequired('Voice Studio completo');

  await withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const persona = await visiblePersona(tx, input.personaId);
    const values = {
      personaId: persona.id,
      personaVersion: persona.version,
      receptionistName: input.receptionistName ?? null,
      formality: input.formality,
      slangLevel: input.slangLevel,
      emojisEnabled: input.emojisEnabled,
      enthusiasm: input.enthusiasm,
      relaxation: input.relaxation,
      useCustomerName: input.useCustomerName,
      greeting: input.greeting ?? null,
      farewell: input.farewell ?? null,
      signatureExpressions: input.signatureExpressions,
      vocabularyPrefer: input.vocabularyPrefer,
      vocabularyAvoid: input.vocabularyAvoid,
      businessInstructions: input.businessInstructions ?? null,
      updatedByUserId: ctx.actor.userId,
    };
    await tx
      .insert(receptionistConfigs)
      .values({ tenantId: ctx.tenant.id, ...values })
      .onConflictDoUpdate({
        target: receptionistConfigs.tenantId,
        set: { ...values, version: sql`${receptionistConfigs.version} + 1`, updatedAt: ctx.deps.clock() },
      });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.actor.userId,
      action: 'receptionist.config_updated',
      entityType: 'receptionist_config',
      entityId: ctx.tenant.id,
      metadata: {
        persona: persona.key,
        formality: input.formality,
        slangLevel: input.slangLevel,
        emojis: input.emojisEnabled,
      },
      ...ctx.meta,
    });
  });
  return getVoiceStudio(ctx);
}

/** Fatos do estabelecimento a partir do banco — a única fonte de verdade da recepcionista. */
export async function buildBusinessFacts(tx: Tx, tenantId: string): Promise<BusinessFacts> {
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!t) throw Errors.notFound('Estabelecimento');
  const hours = await tx
    .select()
    .from(businessHours)
    .orderBy(asc(businessHours.weekday), asc(businessHours.startTime));
  const hoursText =
    ([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[])
      .map((d) => {
        const list = hours.filter((h) => h.weekday === d);
        const name = WEEKDAY_NAMES_PT[d];
        return list.length
          ? `${name}: ${list.map((h) => `${normalizeTime(h.startTime)}–${normalizeTime(h.endTime)}`).join(' e ')}`
          : `${name}: fechado`;
      })
      .join('; ') + '.';
  const svc = await tx
    .select()
    .from(services)
    .where(and(eq(services.active, true), isNull(services.archivedAt)))
    .orderBy(asc(services.sortOrder), asc(services.name));
  const links = await tx
    .select({ professional: professionals.name, service: services.name })
    .from(professionalServices)
    .innerJoin(professionals, eq(professionals.id, professionalServices.professionalId))
    .innerJoin(services, eq(services.id, professionalServices.serviceId))
    .where(
      and(
        eq(professionals.active, true),
        isNull(professionals.archivedAt),
        eq(services.active, true),
        isNull(services.archivedAt),
      ),
    )
    .orderBy(asc(professionals.sortOrder), asc(professionals.name));
  const byPro = new Map<string, string[]>();
  for (const l of links) byPro.set(l.professional, [...(byPro.get(l.professional) ?? []), l.service]);

  const address = [
    [t.addressStreet, t.addressNumber].filter(Boolean).join(', '),
    t.addressComplement,
    t.addressDistrict,
    [t.addressCity, t.addressState].filter(Boolean).join('/'),
  ]
    .filter(Boolean)
    .join(' — ');

  return {
    name: t.name,
    categoryLabel: CATEGORY_LABELS[t.category],
    address: address || null,
    phone: t.phone ? formatPhoneDisplay(t.phone) : null,
    timezone: t.timezone,
    hoursText,
    services: svc.map((s) => ({
      name: s.name,
      durationMin: s.durationMin,
      priceText: describePrice(s.priceCents, s.priceType),
      bookableByAi: s.bookableByAi,
    })),
    professionals: [...byPro.entries()].map(([name, list]) => ({ name, services: list })),
    faq: [],
    policies: {
      minNoticeMin: t.minBookingNoticeMin,
      cancellationMinNoticeMin: t.cancellationMinNoticeMin,
      maxDaysAhead: t.maxBookingDaysAhead,
    },
  };
}

/** Prévia transparente das instruções que a recepcionista receberia (sem salvar nada). */
export async function previewInstructions(
  ctx: ServiceContext,
  input: ReceptionistConfigInput & { channel: Channel },
): Promise<InstructionsPreviewDto> {
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const persona = await visiblePersona(tx, input.personaId);
    const business = await buildBusinessFacts(tx, ctx.tenant.id);
    const compiled = compileReceptionistInstructions({
      persona: persona.definition,
      language: toLanguageSettings(input),
      channel: input.channel,
      business,
      businessInstructions: input.businessInstructions ?? null,
    });
    return {
      channel: input.channel,
      hash: compiled.hash,
      sections: compiled.sections,
      adjustments: compiled.effective.adjustments,
    };
  });
}

export async function createCustomPersona(
  ctx: ServiceContext,
  input: CustomPersonaInput,
): Promise<PersonaSummaryDto> {
  const plan = await getTenantPlan(ctx.deps.db, ctx.tenant.id);
  if (!plan?.features.customPersonas) throw planFeatureRequired('personagens próprias');
  return withTenant(ctx.deps.db, ctx.tenant.id, async (tx) => {
    const base = await visiblePersona(tx, input.basePersonaId);
    const baseDef = base.definition;
    const examples = Object.fromEntries(
      (['FORMAL', 'SEMIFORMAL', 'INFORMAL'] as const).map((f) => [
        f,
        { ...baseDef.examples[f], greeting: input.presentation },
      ]),
    ) as PersonaDefinition['examples'];
    const keyBase = `custom-${slugify(input.name) || 'personagem'}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const key = attempt === 0 ? keyBase : `${keyBase}-${attempt + 1}`;
      const definition: PersonaDefinition = {
        ...baseDef,
        key,
        name: input.name,
        segment: baseDef.segment,
        defaultReceptionistName: null,
        tagline: input.tagline,
        description: input.tagline,
        personality: input.personality,
        speakingStyle: input.speakingStyle,
        signaturePhrases: input.signaturePhrases.map((text) => ({ text, register: 'neutral' as const })),
        examples,
      };
      try {
        const [row] = await tx
          .insert(personas)
          .values({
            tenantId: ctx.tenant.id,
            key,
            name: input.name,
            segment: baseDef.segment,
            definition,
            createdByUserId: ctx.actor.userId,
          })
          .returning();
        await audit(tx, {
          tenantId: ctx.tenant.id,
          actorUserId: ctx.actor.userId,
          action: 'persona.created',
          entityType: 'persona',
          entityId: row!.id,
          metadata: { base: base.key },
          ...ctx.meta,
        });
        return toSummary(row!);
      } catch (err) {
        if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION)
          throw Errors.conflict('PERSONA_NAME_EXISTS', 'Já existe uma personagem com este nome.');
        throw err;
      }
    }
    throw Errors.conflict('PERSONA_NAME_EXISTS', 'Já existe uma personagem com este nome.');
  });
}

/**
 * Instruções compiladas a partir da configuração SALVA — usadas ao iniciar uma conversa
 * (ficam congeladas nela). Sem configuração, não há atendimento por IA.
 */
export async function compileSavedReceptionist(tx: Tx, tenantId: string, channel: Channel) {
  const [config] = await tx.select().from(receptionistConfigs).limit(1);
  if (!config) {
    throw Errors.conflict(
      'RECEPTIONIST_NOT_CONFIGURED',
      'Configure a recepcionista no Voice Studio antes de iniciar atendimentos.',
    );
  }
  const persona = await visiblePersona(tx, config.personaId);
  const business = await buildBusinessFacts(tx, tenantId);
  const compiled = compileReceptionistInstructions({
    persona: persona.definition,
    language: toLanguageSettings(toConfigDto(config)),
    channel,
    business,
    businessInstructions: config.businessInstructions,
  });
  return { compiled, personaId: persona.id, personaVersion: config.personaVersion };
}
