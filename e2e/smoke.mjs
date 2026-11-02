/**
 * Teste E2E de fumaça do Barber Voice (navegador real).
 * Requer API (:4000) e painel (:3000) em execução — ver docs/TESTING.md.
 *
 *   node e2e/smoke.mjs [--shots=<pasta>] [--base=http://localhost:3000]
 *
 * Fluxo: cadastro → onboarding completo → agendamento pela agenda → conferência no dashboard
 * → tentativa de agendar o MESMO horário (deve ser recusada) → versão mobile.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const BASE = args.base ?? 'http://localhost:3000';
const SHOTS = args.shots ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const email = `e2e.${Date.now()}@teste.com.br`;
const password = 'senhaSegura2026';
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err?.message ?? err) });
    console.log(`  ✗ ${name}: ${err?.message ?? err}`);
    throw err;
  }
};
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
});
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  console.log(`E2E em ${BASE}`);
  await step('landing carrega', async () => {
    await page.goto(BASE);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await shot(page, '01-landing');
  });

  await step('área logada exige login (proxy)', async () => {
    await page.goto(`${BASE}/painel`);
    await page.waitForURL(/\/entrar/);
  });

  await step('cadastro', async () => {
    await page.goto(`${BASE}/criar-conta`);
    await shot(page, '02-signup');
    await page.getByLabel('Seu nome').fill('Léo Rocha');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(password);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await page.waitForURL(/\/onboarding/);
  });

  await step('onboarding 1 — estabelecimento', async () => {
    await page.getByLabel('Nome do estabelecimento').fill('Rock & Navalha Barbearia');
    await page.getByLabel('Telefone de atendimento').fill('(11) 3456-7890');
    await page.getByLabel('WhatsApp').fill('(11) 98765-4321');
    await page.getByLabel('Cidade').fill('São Paulo');
    await shot(page, '03-onboarding-business');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('heading', { name: 'Horário de funcionamento' }).waitFor();
  });

  await step('onboarding 2 — horários (sugestão editável)', async () => {
    await shot(page, '04-onboarding-hours');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    await page.getByRole('heading', { name: 'Serviços e preços' }).waitFor();
  });

  await step('onboarding 3 — serviços', async () => {
    const addService = async (name, price) => {
      await page.getByLabel('Nome do serviço').fill(name);
      await page.getByLabel('Preço (R$)').fill(price);
      await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
      await page.getByText(name, { exact: true }).first().waitFor();
    };
    await page.getByRole('button', { name: '+ Corte masculino' }).click();
    await page.getByLabel('Preço (R$)').fill('45,00');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await page.getByText('Corte masculino', { exact: true }).first().waitFor();
    await addService('Barba', '35');
    await shot(page, '05-onboarding-services');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('heading', { name: 'Profissionais' }).waitFor();
  });

  await step('onboarding 4 — profissionais', async () => {
    for (const name of ['João', 'Pedro']) {
      await page.getByLabel('Nome do profissional').fill(name);
      await page.getByRole('button', { name: 'Adicionar profissional' }).click();
      await page.getByText(name, { exact: true }).first().waitFor();
    }
    await shot(page, '06-onboarding-professionals');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('heading', { name: 'Tudo pronto para começar' }).waitFor();
  });

  await step('onboarding 5 — revisão e conclusão', async () => {
    await shot(page, '07-onboarding-review');
    await page.getByRole('button', { name: 'Concluir e abrir o painel' }).click();
    await page.waitForURL(/\/painel$/);
    await page.getByText('Agendamentos hoje').waitFor();
  });

  // agenda: amanhã (evita depender do horário atual)
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(Date.now() + 86_400_000),
  );
  let bookedTime = '';
  await step('agendamento pela agenda (horário real da API)', async () => {
    await page.goto(`${BASE}/painel/agenda?data=${tomorrow}`);
    await page.getByRole('button', { name: 'Novo agendamento' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Buscar por nome ou telefone').fill('Carlos Lima');
    await dialog.getByRole('button', { name: /Novo cliente/ }).click();
    await dialog.getByLabel('Telefone').fill('(11) 99999-1111');
    await dialog.getByRole('button', { name: /Corte masculino/ }).click();
    const firstSlot = dialog
      .locator('button[aria-pressed]')
      .filter({ hasText: /^\d{2}:\d{2}$/ })
      .first();
    await firstSlot.waitFor();
    bookedTime = (await firstSlot.textContent())?.trim() ?? '';
    await firstSlot.click();
    await shot(page, '08-agenda-new-appointment');
    await dialog.getByRole('button', { name: 'Confirmar agendamento' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByText('Carlos Lima').first().waitFor();
    await shot(page, '09-agenda-day');
  });

  await step('mesmo horário com o mesmo profissional é recusado/indisponível', async () => {
    // via API, como faria uma segunda pessoa no mesmo instante
    const res = await page.evaluate(
      async ({ time, date }) => {
        const me = await (await fetch('/api/v1/auth/me')).json();
        const t = me.memberships[0].tenantId;
        const appts = await (await fetch(`/api/v1/tenants/${t}/appointments?from=${date}&to=${date}`)).json();
        const a = appts.appointments[0];
        const r = await fetch(`/api/v1/tenants/${t}/appointments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            newCustomer: { name: 'Concorrente' },
            professionalId: a.professional.id,
            serviceIds: a.items.map((i) => i.serviceId),
            startsAt: a.startsAt,
          }),
        });
        return { status: r.status, body: await r.json(), time };
      },
      { time: bookedTime, date: tomorrow },
    );
    if (res.status !== 409 || res.body?.error?.code !== 'SLOT_UNAVAILABLE') {
      throw new Error(`esperado 409 SLOT_UNAVAILABLE, veio ${res.status} ${JSON.stringify(res.body)}`);
    }
  });

  await step('detalhes do agendamento e cliente no CRM', async () => {
    await page.getByText('Carlos Lima').first().click();
    await page.getByRole('dialog').getByText('Corte masculino').waitFor();
    await shot(page, '10-appointment-details');
    await page.keyboard.press('Escape');
    await page.goto(`${BASE}/painel/clientes`);
    await page.getByText('Carlos Lima').waitFor();
    await shot(page, '11-customers');
  });

  await step('dashboard com dados reais', async () => {
    await page.goto(`${BASE}/painel`);
    await page.getByText('Faturamento registrado no mês').waitFor();
    await page.getByText('Telefone e WhatsApp ainda não integrados').waitFor();
    await shot(page, '12-dashboard');
  });

  await step('serviços, profissionais e configurações', async () => {
    await page.goto(`${BASE}/painel/servicos`);
    await page.getByText('R$ 45,00').waitFor();
    await shot(page, '13-services');
    await page.goto(`${BASE}/painel/profissionais`);
    await page.getByText('Pedro').waitFor();
    await shot(page, '14-professionals');
    await page.goto(`${BASE}/painel/configuracoes`);
    await page.getByLabel('Nome do estabelecimento').waitFor();
    await shot(page, '15-settings');
  });

  await step('mobile: agenda em lista e navegação inferior', async () => {
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      storageState: await context.storageState(),
    });
    const m = await mobile.newPage();
    await m.goto(`${BASE}/painel`);
    await m.getByText('Agendamentos hoje').waitFor();
    await shot(m, '16-mobile-dashboard');
    await m.goto(`${BASE}/painel/agenda?data=${tomorrow}`);
    // a grade desktop fica no DOM (oculta por CSS); valida a lista visível no celular
    await m.getByText('Carlos Lima').filter({ visible: true }).first().waitFor();
    await shot(m, '17-mobile-agenda');
    await m.goto(BASE);
    await shot(m, '18-mobile-landing');
    await mobile.close();
  });

  await step('logout encerra a sessão', async () => {
    await page.goto(`${BASE}/painel`);
    await page.getByRole('button', { name: 'Sair' }).click();
    await page.waitForURL(/\/entrar/);
    const status = await page.evaluate(async () => (await fetch('/api/v1/auth/me')).status);
    if (status !== 401) throw new Error(`após logout, /me retornou ${status}`);
  });
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  if (consoleErrors.length) console.log(`\nErros de página capturados:\n${consoleErrors.join('\n')}`);
  console.log(`\n${results.length - failed.length}/${results.length} etapas aprovadas`);
  if (failed.length || consoleErrors.length) process.exitCode = 1;
}
