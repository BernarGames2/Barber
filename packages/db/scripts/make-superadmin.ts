import { eq } from 'drizzle-orm';
import { createDb } from '../src/client';
import { loadEnv } from '../src/env';
import { auditLogs, users } from '../src/schema';

/**
 * Concede o papel de SUPERADMIN da plataforma a um usuário existente.
 * Deliberadamente NÃO existe endpoint de API para isso: exige acesso ao servidor/banco.
 *
 *   pnpm --filter @barber-voice/db make-superadmin dono@barbervoice.com.br
 */
loadEnv();

const email = process.argv[2]?.trim().toLowerCase();
const revoke = process.argv.includes('--revoke');
const url = process.env.DATABASE_ADMIN_URL;
if (!email || !url) {
  console.error('Uso: make-superadmin <email> [--revoke]  (requer DATABASE_ADMIN_URL)');
  process.exit(1);
}

const handle = createDb(url, { max: 1 });
try {
  const [user] = await handle.db
    .update(users)
    .set({ platformRole: revoke ? null : 'SUPERADMIN' })
    .where(eq(users.email, email))
    .returning({ id: users.id });
  if (!user) {
    console.error(`Usuário ${email} não encontrado.`);
    process.exitCode = 1;
  } else {
    await handle.db.insert(auditLogs).values({
      actorType: 'SYSTEM',
      action: revoke ? 'platform.superadmin_revoked' : 'platform.superadmin_granted',
      entityType: 'user',
      entityId: user.id,
      metadata: { via: 'cli' },
    });
    console.log(revoke ? `SUPERADMIN removido de ${email}.` : `${email} agora é SUPERADMIN.`);
  }
} finally {
  await handle.close();
}
