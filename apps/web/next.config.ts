import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Content-Security-Policy compatível com o app:
 *  - connect-src libera `wss:` (board na MESMA origem/443) e, em dev, `ws:` (HMR);
 *  - script-src ganha `'unsafe-eval'` só em dev (Turbopack/HMR); prod é mais estrito;
 *  - style/script com `'unsafe-inline'` (Next injeta bootstrap inline sem nonce).
 * A proteção principal vem de frame-ancestors/object-src/base-uri + os headers abaixo.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  `connect-src 'self' wss:${isDev ? ' ws:' : ''}`,
  'upgrade-insecure-requests',
].join('; ');

// Consulta ao vivo usa microfone (getUserMedia) — precisa de microphone=(self).
const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
  // HSTS só em produção (em http/localhost o browser ignora, mas evita fixar dev em https).
  ...(isDev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  // Pacotes de workspace consumidos a partir do código-fonte TS.
  transpilePackages: [
    '@nutrimed/shared-types',
    '@nutrimed/domain',
    '@nutrimed/crypto',
    '@nutrimed/db',
    '@nutrimed/auth',
  ],
  // Drivers de banco rodam no servidor — não empacotar (require nativo em runtime).
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
