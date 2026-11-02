'use client';

import { PASSWORD_MIN, signupSchema } from '@barber-voice/contracts';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { ApiError, api } from '@/lib/api';

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const founding = params.get('programa') === 'founding';
  const [form, setForm] = useState({ name: '', email: '', password: '', acceptTerms: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = signupSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await api('/v1/auth/signup', { method: 'POST', body: parsed.data });
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace(founding ? '/onboarding?programa=founding' : '/onboarding');
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setError(err.message);
      } else setError('Não foi possível criar a conta agora.');
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="font-display text-4xl tracking-tight">Crie sua conta</h1>
      <p className="mt-2 text-[15px] text-ink-500">
        Em poucos minutos sua agenda fica pronta para a recepcionista.
      </p>
      {founding ? (
        <Notice tone="brass" className="mt-6" title="Programa Founding Partners">
          Após o cadastro, nossa equipe avalia a participação e entra em contato. Nada é cobrado
          automaticamente.
        </Notice>
      ) : null}
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Field label="Seu nome" error={errors.name}>
          {(p) => (
            <Input
              {...p}
              autoComplete="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="E-mail" error={errors.email}>
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Senha"
          error={errors.password}
          hint={`Mínimo de ${PASSWORD_MIN} caracteres, com letras e números.`}
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          )}
        </Field>
        <div>
          <Checkbox
            checked={form.acceptTerms}
            onChange={(e) => setForm({ ...form, acceptTerms: e.target.checked })}
            label={
              <>
                Li e aceito os{' '}
                <Link href="/termos" target="_blank" className="font-medium underline underline-offset-2">
                  termos de uso
                </Link>{' '}
                e a{' '}
                <Link
                  href="/privacidade"
                  target="_blank"
                  className="font-medium underline underline-offset-2"
                >
                  política de privacidade
                </Link>
                .
              </>
            }
          />
          {errors.acceptTerms ? (
            <p className="mt-1.5 text-[13px] text-rose-700">{errors.acceptTerms}</p>
          ) : null}
        </div>
        <Button type="submit" size="lg" loading={loading}>
          Criar conta
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-ink-500">
        Já tem conta?{' '}
        <Link href="/entrar" className="font-medium text-ink-900 underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
