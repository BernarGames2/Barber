'use client';

import { PASSWORD_MIN, passwordSchema } from '@barber-voice/contracts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Senha inválida');
    if (password !== confirm) return setError('As senhas não coincidem.');
    setError(null);
    setLoading(true);
    try {
      await api('/v1/auth/password/reset', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!token) return <Notice tone="danger">Link incompleto. Solicite uma nova redefinição de senha.</Notice>;
  if (done) {
    return (
      <div>
        <h1 className="font-display text-4xl">Senha alterada</h1>
        <p className="mt-3 text-[15px] text-ink-500">
          Por segurança, encerramos as sessões abertas. Entre com a nova senha.
        </p>
        <Button asChild size="lg" className="mt-8 w-full">
          <Link href="/entrar">Entrar</Link>
        </Button>
      </div>
    );
  }
  return (
    <>
      <h1 className="font-display text-4xl tracking-tight">Nova senha</h1>
      <p className="mt-2 text-[15px] text-ink-500">
        Mínimo de {PASSWORD_MIN} caracteres, com letras e números.
      </p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Field label="Nova senha">
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Field label="Confirme a nova senha">
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="lg" loading={loading}>
          Salvar nova senha
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
