'use client';

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (count, err) =>
              !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
        mutationCache: new MutationCache({
          onError: (err, _vars, _ctx, mutation) => {
            // mutações podem tratar o próprio erro (ex.: horário ocupado) marcando meta.silent
            if (mutation.meta?.silent) return;
            toast.error(err instanceof Error ? err.message : 'Não foi possível concluir a ação.');
          },
        }),
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        position="top-center"
        toastOptions={{
          classNames: {
            toast: 'rounded-xl! border-0! shadow-pop! font-sans!',
            title: 'text-sm! font-medium!',
          },
        }}
      />
    </QueryClientProvider>
  );
}
