'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';

function Confirm() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!token) {
      setState('error');
      setMessage('Link incompleto.');
      return;
    }
    api('/v1/auth/email/verify', { method: 'POST', body: { token } })
      .then(() => setState('ok'))
      .catch((err) => {
        setState('error');
        setMessage(errorMessage(err));
      });
  }, [token]);

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-3 text-ink-500">
        <Spinner className="size-5" /> Confirmando seu e-mail…
      </div>
    );
  }
  return (
    <div>
      <h1 className="font-display text-4xl">
        {state === 'ok' ? 'E-mail confirmado' : 'Não foi possível confirmar'}
      </h1>
      {state === 'error' ? (
        <Notice tone="danger" className="mt-4">
          {message}
        </Notice>
      ) : null}
      <Link href="/painel" className="mt-8 inline-block text-sm font-medium underline underline-offset-4">
        Ir para o painel
      </Link>
    </div>
  );
}

export default function ConfirmEmailPage() {
  return (
    <Suspense>
      <Confirm />
    </Suspense>
  );
}
