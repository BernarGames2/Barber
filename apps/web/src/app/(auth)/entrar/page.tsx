'use client';

import { loginSchema } from '@barber-voice/contracts';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { ApiError, api } from '@/lib/api';

function safeNext(next: string | null): string {
  // só caminhos internos (evita open redirect)
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/painel';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setFieldErrors({});
    setLoading(true);
    try {
      await api('/v1/auth/login', { method: 'POST', body: parsed.data });
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar agora.');
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="font-display text-4xl tracking-tight">Bem-vindo de volta</h1>
      <p className="mt-2 text-[15px] text-ink-500">Entre para acompanhar sua agenda e sua recepcionista.</p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Field label="E-mail" error={fieldErrors.email}>
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Senha" error={fieldErrors.password}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <div className="-mt-1 flex justify-end">
          <Link href="/recuperar-senha" className="text-[13px] font-medium text-ink-600 hover:text-ink-900">
            Esqueci minha senha
          </Link>
        </div>
        <Button type="submit" size="lg" loading={loading}>
          Entrar
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-ink-500">
        Ainda não tem conta?{' '}
        <Link href="/criar-conta" className="font-medium text-ink-900 underline-offset-4 hover:underline">
          Criar conta
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
