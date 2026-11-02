import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Fora da Vercel (desenvolvimento local, contêiner), o próprio Next encaminha /api/* para a API.
 * Na Vercel, o roteamento /api/* → serviço "api" é feito pelo vercel.json, antes do Next.
 */
const ON_VERCEL = process.env.VERCEL === '1';
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? (ON_VERCEL ? null : 'http://localhost:4000');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // imagem Docker (VPS): servidor Node mínimo; na Vercel a saída padrão é usada
  ...(process.env.NEXT_OUTPUT_STANDALONE === '1'
    ? { output: 'standalone' as const, outputFileTracingRoot: path.join(process.cwd(), '..', '..') }
    : {}),
  turbopack: {
    // monorepo: pacotes do workspace ficam dois níveis acima
    root: path.join(process.cwd(), '..', '..'),
  },
  /**
   * O painel conversa com a API pelo MESMO domínio (/api/*). Assim o cookie de sessão é
   * first-party (SameSite=Lax) e nenhuma credencial ou URL interna vai para o navegador.
   */
  async rewrites() {
    // o prefixo /api é mantido: a API publica as rotas em /api/* em todos os ambientes
    return API_INTERNAL_URL
      ? [{ source: '/api/:path*', destination: `${API_INTERNAL_URL.replace(/\/$/, '')}/api/:path*` }]
      : [];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
