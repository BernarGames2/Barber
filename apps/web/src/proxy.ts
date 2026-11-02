import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'bv_session';

/**
 * Redireciona visitantes sem cookie de sessão para o login nas áreas logadas.
 * É apenas conveniência de navegação: a autorização real acontece na API a cada requisição.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = '/entrar';
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/painel/:path*', '/onboarding/:path*'],
};
