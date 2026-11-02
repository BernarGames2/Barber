import { memberships } from '@barber-voice/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ShopFixture,
  type TestClient,
  type TestContext,
  createTestContext,
  json,
  setupShop,
  signup,
} from './helpers';

let ctx: TestContext;
let owner: TestClient;
let shop: ShopFixture;
let personas: { id: string; key: string; isCustom: boolean }[];

const baseConfig = (personaId: string) => ({
  personaId,
  receptionistName: null,
  formality: 'FORMAL',
  slangLevel: 'HIGH',
  emojisEnabled: true,
  enthusiasm: 5,
  relaxation: 5,
  useCustomerName: 'GREETING',
  signatureExpressions: [],
  vocabularyPrefer: [],
  vocabularyAvoid: [],
});

async function setPlan(tenantId: string, code: string) {
  await ctx.admin.pool.query(
    `UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = $2)
       WHERE organization_id = (SELECT organization_id FROM tenants WHERE id = $1)`,
    [tenantId, code],
  );
}

beforeAll(async () => {
  ctx = await createTestContext();
  owner = (await signup(ctx)).client;
  shop = await setupShop(owner);
  personas = json(await owner.get(`${shop.base}/voice-studio`)).personas;
});
afterAll(async () => {
  await ctx.close();
});

const rockerId = () => personas.find((p) => p.key === 'rocker')!.id;

describe('Voice Studio (API)', () => {
  it('lista a biblioteca completa e informa recursos do plano e integrações pendentes', async () => {
    const vs = json(await owner.get(`${shop.base}/voice-studio`));
    expect(vs.personas.map((p: { key: string }) => p.key)).toEqual([
      'rocker',
      'classico',
      'urban',
      'premium',
      'esportivo',
      'retro',
      'sofia',
      'bia',
      'helena',
      'fashion',
      'natural',
    ]);
    expect(vs.config).toBeNull();
    expect(vs.features).toEqual({ advancedLanguage: true, customPersonas: false }); // plano de teste
    expect(vs.integrations).toEqual({ tts: false, llm: false });
  });

  it('salva personagem e linguagem de forma independente, com ajustes transparentes', async () => {
    const res = await owner.put(`${shop.base}/voice-studio/config`, baseConfig(rockerId()));
    expect(res.statusCode).toBe(200);
    const vs = json(res);
    expect(vs.config).toMatchObject({
      personaId: rockerId(),
      formality: 'FORMAL',
      slangLevel: 'HIGH',
      version: 1,
    });
    // o que o proprietário escolheu fica salvo; o efetivo é mostrado com o motivo
    expect(vs.effective.WHATSAPP.slangLevel).toBe('NONE');
    expect(vs.effective.WHATSAPP.relaxation).toBe(2);
    expect(vs.effective.PHONE.emojisEnabled).toBe(false);
    expect(vs.effective.WHATSAPP.emojisEnabled).toBe(true);
    expect(vs.effective.PHONE.adjustments.map((a: { field: string }) => a.field)).toEqual(
      expect.arrayContaining(['slangLevel', 'relaxation', 'emojisEnabled']),
    );
    const again = json(
      await owner.put(`${shop.base}/voice-studio/config`, {
        ...baseConfig(rockerId()),
        formality: 'INFORMAL',
      }),
    );
    expect(again.config.version).toBe(2);
    expect(again.effective.WHATSAPP.slangLevel).toBe('HIGH');
  });

  it('prévia compila as instruções com os DADOS REAIS do estabelecimento', async () => {
    const res = await owner.post(`${shop.base}/voice-studio/preview`, {
      ...baseConfig(rockerId()),
      channel: 'PHONE',
    });
    expect(res.statusCode).toBe(200);
    const p = json(res);
    expect(p.sections.map((s: { key: string }) => s.key)).toEqual([
      'safety',
      'facts',
      'persona',
      'language',
      'channel',
    ]);
    const facts = p.sections[1].content as string;
    expect(facts).toContain('Corte — 30 min — R$ 45,00');
    expect(facts).toContain('Coloração — 90 min — a partir de R$ 120,00');
    expect(facts).toMatch(/Pedro: Corte, Barba|Pedro: Barba, Corte/);
    expect(facts).toContain('domingo: fechado');
    expect(p.sections[2].content).toContain('Personagem: Rocker');
    expect(p.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('valida personagem inexistente e personagem de outro estabelecimento', async () => {
    const bad = await owner.put(
      `${shop.base}/voice-studio/config`,
      baseConfig('00000000-0000-4000-8000-000000000000'),
    );
    expect(json(bad).error.code).toBe('INVALID_PERSONA');

    const other = (await signup(ctx)).client;
    const otherShop = await setupShop(other);
    await setPlan(otherShop.tenantId, 'PRO');
    const custom = await other.post(`${otherShop.base}/voice-studio/personas`, {
      basePersonaId: rockerId(),
      name: 'Exclusiva do Vizinho',
      tagline: 'Personagem própria de outro estabelecimento.',
      personality: 'Uma personalidade única e exclusiva do estabelecimento vizinho.',
      speakingStyle: 'Fala de um jeito só dela.',
      signaturePhrases: [],
      presentation: 'Olá, aqui é do vizinho!',
    });
    expect(custom.statusCode).toBe(201);
    const stolen = await owner.put(`${shop.base}/voice-studio/config`, baseConfig(json(custom).id));
    expect(json(stolen).error.code).toBe('INVALID_PERSONA');
    const list = json(await owner.get(`${shop.base}/voice-studio`)).personas.map(
      (p: { name: string }) => p.name,
    );
    expect(list).not.toContain('Exclusiva do Vizinho');
  });

  it('personagens próprias exigem plano compatível', async () => {
    const body = {
      basePersonaId: rockerId(),
      name: 'Rock da Casa',
      tagline: 'A voz oficial da casa.',
      personality: 'Animada, divertida e apaixonada por rock clássico, com muito respeito ao cliente.',
      speakingStyle: 'Frases curtas e animadas.',
      signaturePhrases: ['Aumenta o som!'],
      presentation: 'Fala! Aqui é a voz oficial da casa.',
    };
    const denied = await owner.post(`${shop.base}/voice-studio/personas`, body);
    expect(denied.statusCode).toBe(403);
    expect(json(denied).error.code).toBe('PLAN_FEATURE_REQUIRED');
    await setPlan(shop.tenantId, 'PRO');
    const created = await owner.post(`${shop.base}/voice-studio/personas`, body);
    expect(created.statusCode).toBe(201);
    expect(json(created)).toMatchObject({ isCustom: true, name: 'Rock da Casa' });
    expect(json(created).examples.FORMAL.greeting).toBe(body.presentation);
    const saved = await owner.put(`${shop.base}/voice-studio/config`, baseConfig(json(created).id));
    expect(saved.statusCode).toBe(200);
  });

  it('linguagem avançada (saudação, vocabulário, orientações) depende do plano', async () => {
    const o = (await signup(ctx)).client;
    const s = await setupShop(o);
    await setPlan(s.tenantId, 'START');
    const basic = await o.put(`${s.base}/voice-studio/config`, baseConfig(rockerId()));
    expect(basic.statusCode).toBe(200);
    expect(json(basic).features.advancedLanguage).toBe(false);
    const advanced = await o.put(`${s.base}/voice-studio/config`, {
      ...baseConfig(rockerId()),
      greeting: 'Bem-vindo ao rock!',
    });
    expect(json(advanced).error.code).toBe('PLAN_FEATURE_REQUIRED');
  });

  it('equipe visualiza, mas não altera a recepcionista', async () => {
    const staff = await signup(ctx, 'Equipe VS');
    await ctx.admin.db
      .insert(memberships)
      .values({ tenantId: shop.tenantId, userId: staff.userId, role: 'STAFF' });
    expect((await staff.client.get(`${shop.base}/voice-studio`)).statusCode).toBe(200);
    expect(
      (await staff.client.put(`${shop.base}/voice-studio/config`, baseConfig(rockerId()))).statusCode,
    ).toBe(403);
    expect(
      (
        await staff.client.post(`${shop.base}/voice-studio/preview`, {
          ...baseConfig(rockerId()),
          channel: 'PHONE',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('a alteração fica na auditoria', async () => {
    const r = await ctx.admin.pool.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'receptionist.config_updated'`,
      [shop.tenantId],
    );
    expect(r.rows[0].n).toBeGreaterThanOrEqual(2);
  });
});
