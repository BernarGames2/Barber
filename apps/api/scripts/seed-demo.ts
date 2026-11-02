/**
 * Cria um estabelecimento de DEMONSTRAÇÃO com dados fictícios, marcado com is_demo = true
 * (o painel exibe um aviso permanente). Usa os serviços reais da API — as mesmas validações
 * de agenda, conflito e RLS — e não roda em produção.
 *
 *   pnpm --filter @barber-voice/api seed:demo
 */
import { addDays, instantToLocal, localToInstant, todayInZone } from '@barber-voice/core';
import { createDb, loadEnv, tenants, users } from '@barber-voice/db';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../src/config';
import type { AppDeps, ServiceContext } from '../src/context';
import { MemoryMailer } from '../src/lib/mailer';
import { hashPassword } from '../src/lib/password';
import { createAppointment, updateAppointmentStatus } from '../src/modules/appointments/booking';
import { createProfessional } from '../src/modules/catalog/professionals';
import { createService } from '../src/modules/catalog/services';
import { createTenant } from '../src/modules/tenants/service';
import { setBusinessHours } from '../src/modules/tenants/service';

loadEnv();
const config = loadConfig();
if (config.NODE_ENV === 'production') {
  console.error('seed:demo não roda em produção.');
  process.exit(1);
}
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error('Defina DATABASE_ADMIN_URL.');
  process.exit(1);
}

const DEMO_EMAIL = 'demo@barbervoice.dev';
const DEMO_PASSWORD = 'demonstracao2026';
const TZ = 'America/Sao_Paulo';

const app = createDb(config.DATABASE_URL, { max: 4 });
const admin = createDb(adminUrl, { max: 1 });
const deps: AppDeps = { config, db: app.db, mailer: new MemoryMailer(), clock: () => new Date() };

try {
  const existing = await admin.db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  if (existing[0]) {
    console.log(`Usuário de demonstração já existe (${DEMO_EMAIL}). Nada a fazer.`);
    process.exit(0);
  }
  const [user] = await admin.db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      name: 'Conta Demonstração',
      passwordHash: await hashPassword(DEMO_PASSWORD),
      emailVerifiedAt: new Date(),
    })
    .returning();

  const tenantDto = await createTenant(
    deps,
    { sessionId: 'seed', userId: user!.id, email: DEMO_EMAIL, name: user!.name, platformRole: null },
    {
      name: 'Barbearia Demonstração',
      category: 'BARBERSHOP',
      responsibleName: 'Conta Demonstração',
      phone: '+551130000000',
      whatsappNumber: null,
      email: null,
      timezone: TZ,
      addressCity: 'São Paulo',
      addressState: 'SP',
    },
    {},
  );
  await admin.db
    .update(tenants)
    .set({ isDemo: true, slotIntervalMin: 30 })
    .where(eq(tenants.id, tenantDto.id));

  const ctx: ServiceContext = {
    deps,
    tenant: {
      id: tenantDto.id,
      name: tenantDto.name,
      slug: tenantDto.slug,
      timezone: TZ,
      status: 'ONBOARDING',
      slotIntervalMin: 30,
      minBookingNoticeMin: 60,
      maxBookingDaysAhead: 60,
      cancellationMinNoticeMin: 0,
      isDemo: true,
    },
    actor: { userId: user!.id, role: 'OWNER', type: 'SYSTEM' },
    meta: {},
  };

  await setBusinessHours(ctx, [
    ...[2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '20:00' })),
    { weekday: 6, start: '08:00', end: '17:00' },
  ]);

  const svc = async (
    name: string,
    durationMin: number,
    priceCents: number,
    extra: Partial<{ bufferAfterMin: number; priceType: 'FIXED' | 'STARTING_AT' }> = {},
  ) =>
    (
      await createService(ctx, {
        name,
        durationMin,
        priceCents,
        bufferAfterMin: extra.bufferAfterMin ?? 0,
        priceType: extra.priceType ?? 'FIXED',
        active: true,
        bookableByAi: true,
        sortOrder: 0,
      })
    ).id;
  const corte = await svc('Corte', 40, 5000);
  const barba = await svc('Barba', 30, 4000, { bufferAfterMin: 10 });
  const combo = await svc('Corte + barba', 70, 8000, { bufferAfterMin: 10 });
  const pigment = await svc('Pigmentação', 40, 6000, { priceType: 'STARTING_AT' });

  const pro = async (name: string, color: string, serviceIds: string[]) =>
    (
      await createProfessional(ctx, {
        name,
        color,
        serviceIds,
        active: true,
        bookableByAi: true,
        sortOrder: 0,
        workingHours: null,
      })
    ).id;
  const rafa = await pro('Rafa', '#b8892f', [corte, barba, combo, pigment]);
  const duda = await pro('Duda', '#2f6f5e', [corte, barba, combo]);

  // agendamentos fictícios: passados (concluídos/faltas) e futuros
  const names = [
    'Bruno Costa',
    'Caio Mendes',
    'Diego Alves',
    'Felipe Rocha',
    'Gustavo Lima',
    'Henrique Dias',
    'Igor Santos',
    'João Pedro',
  ];
  const today = todayInZone(TZ);
  const plan: {
    day: number;
    time: string;
    who: number;
    pro: string;
    svc: string;
    status?: 'COMPLETED' | 'NO_SHOW';
  }[] = [];
  for (let d = -6; d <= 7; d++) {
    const date = addDays(today, d);
    const wd = instantToLocal(localToInstant(date, '12:00', TZ), TZ).weekday;
    if (wd === 1 || wd === 7) continue;
    const times = ['09:00', '10:30', '14:00', '16:00', '18:00'];
    times.forEach((time, i) => {
      if ((d + i) % 3 === 0) return;
      plan.push({
        day: d,
        time,
        who: (Math.abs(d) * 3 + i) % names.length,
        pro: i % 2 === 0 ? rafa : duda,
        svc: [corte, combo, barba, corte, pigment][i]!,
        ...(d < 0 ? { status: (d + i) % 7 === 0 ? ('NO_SHOW' as const) : ('COMPLETED' as const) } : {}),
      });
    });
  }

  let created = 0;
  for (const p of plan) {
    const startsAt = new Date(localToInstant(addDays(today, p.day), p.time, TZ)).toISOString();
    try {
      const { appointment } = await createAppointment(
        ctx,
        {
          newCustomer: {
            name: names[p.who]!,
            phone: `+55119${String(87000000 + p.who * 1371).padStart(8, '0')}`,
          },
          professionalId: p.pro,
          serviceIds: [p.svc],
          startsAt,
          source: 'DASHBOARD',
          allowPast: p.day < 0,
        },
        { customerFacing: false },
      );
      if (p.status && new Date(startsAt) < new Date())
        await updateAppointmentStatus(ctx, appointment.id, p.status);
      created++;
    } catch (err) {
      // horários que caem fora da jornada (ex.: sábado à noite) são simplesmente ignorados
      if (process.env.DEBUG) console.warn('ignorado', p, (err as Error).message);
    }
  }

  await admin.db
    .update(tenants)
    .set({ onboardingCompletedAt: new Date(), status: 'ACTIVE' })
    .where(eq(tenants.id, tenantDto.id));
  console.log(`\nDemonstração criada (${created} agendamentos fictícios).`);
  console.log(`  Login: ${DEMO_EMAIL}`);
  console.log(`  Senha: ${DEMO_PASSWORD}`);
  console.log('  O painel exibe o aviso "dados fictícios" para este estabelecimento.\n');
} finally {
  await app.close();
  await admin.close();
}
