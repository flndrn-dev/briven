import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@briven/ui', '@briven/shared', '@briven/config'],
  experimental: {
    typedRoutes: true,
  },
  async headers() {
    // Production security headers applied to every route. HSTS asks
    // browsers to only ever reach us over HTTPS; the others lock down
    // framing, MIME-sniffing, referrer leakage, and device APIs.
    // CSP is intentionally permissive for the beta (Next.js inline
    // runtime + styled output still need 'unsafe-inline'/'unsafe-eval').
    // TODO tighten CSP (drop unsafe-inline/eval) post-beta
    const csp = [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      "frame-ancestors 'none'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
  async rewrites() {
    // Read at request time, not module load, so env changes take effect
    // without a rebuild. Default falls through to a local dev api.
    const apiOrigin = process.env.BRIVEN_API_ORIGIN ?? 'http://localhost:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
  async redirects() {
    // Stable curl-install URL: `curl -fsSL https://briven.tech/install | sh`
    // forwards to whichever install.sh is attached to the latest Codeberg
    // release. Forgejo's /releases/latest/download/<asset> follows the
    // newest non-draft release tag.
    return [
      {
        source: '/install',
        destination:
          'https://codeberg.org/flndrn/briven/releases/latest/download/install.sh',
        permanent: false,
      },
    ];
  },
};

export default config;
