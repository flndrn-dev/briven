import type { NextConfig } from 'next';

const apiOrigin = process.env.BRIVEN_API_ORIGIN ?? 'http://localhost:3001';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@briven/ui', '@briven/shared', '@briven/config'],
  experimental: {
    typedRoutes: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

export default config;
