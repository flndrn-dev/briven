import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@briven/ui', '@briven/config', 'fumadocs-ui'],
  experimental: {
    typedRoutes: true,
  },
};

export default config;
