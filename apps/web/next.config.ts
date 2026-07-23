import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@briven/ui',
    '@briven/shared',
    '@briven/config',
    '@briven/auth',
  ],
  experimental: {
    typedRoutes: true,
  },
  async rewrites() {
    // Read at request time, not module load, so env changes take effect
    // without a rebuild. Default falls through to a local dev api.
    //
    // CRITICAL: use `fallback` (not a top-level array / afterFiles).
    // Otherwise `/api/dashboard/auth-core/*` is rewritten to
    // api.briven.tech/dashboard/... (404) and the App Router proxy never
    // runs — Providers stuck on "loading methods…" / "load failed (404)".
    // fallback = only when no local page/route matched, so local routes win:
    //   /api/dashboard/auth-core/* → apps/web proxy (cookies + Origin)
    //   /api/v1/*                 → api.briven.tech/v1/*
    const apiOrigin = process.env.BRIVEN_API_ORIGIN ?? 'http://localhost:3001';
    return {
      fallback: [
        {
          source: '/api/:path*',
          destination: `${apiOrigin}/:path*`,
        },
      ],
    };
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
