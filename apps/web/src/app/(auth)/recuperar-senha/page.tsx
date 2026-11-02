'use client';

import { forgotPasswordSchema } from '@barber-voice/contracts';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'E-mail inválido');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api('/v1/auth/password/forgot', { method: 'POST', body: parsed.data });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <MailCheck className="size-6" />
        </div>
        <h1 className="mt-6 font-display text-3xl">Verifique seu e-mail</h1>
        <p className="mt-3 text-[15px] text-ink-500">
          Se houver uma conta com <strong className="text-ink-800">{email}</strong>, você receberá um link
          para criar uma nova senha. O link vale por 1 hora.
        </p>
        <Link
          href="/entrar"
          className="mt-8 inline-block text-sm font-medium text-ink-900 underline underline-offset-4"
        >
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="font-display text-4xl tracking-tight">Recuperar senha</h1>
      <p className="mt-2 text-[15px] text-ink-500">
        Informe o e-mail da sua conta para receber o link de redefinição.
      </p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Field label="E-mail">
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="lg" loading={loading}>
          Enviar link
        </Button>
      </form>
      <p className="mt-8 text-center text-sm">
        <Link href="/entrar" className="font-medium text-ink-700 hover:text-ink-900">
          Voltar para o login
        </Link>
      </p>
    </>
  );
}
