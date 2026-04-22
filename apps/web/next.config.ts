import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@briven/ui', '@briven/shared', '@briven/config'],
  experimental: {
    typedRoutes: true,
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
};

export default config;
