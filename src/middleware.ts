import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isProd = process.env.NODE_ENV === 'production';

  const connectSrc = [
    "'self'",
    'https://api.openai.com',
    'wss://api.openai.com',
    'https://api.tavily.com',
    'https://api.cohere.com',
    'https://*.neon.tech',
    'wss://*.neon.tech',
    'https://*.public.blob.vercel-storage.com',
    ...(isProd ? [] : ['http://192.168.40.67:*', 'ws://192.168.40.67:*']),
  ].join(' ');

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
