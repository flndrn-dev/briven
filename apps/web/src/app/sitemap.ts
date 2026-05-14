import type { MetadataRoute } from 'next';

const SITE = 'https://briven.tech';

/**
 * Marketing-site sitemap. Dashboard routes are gated behind auth and
 * intentionally excluded — they shouldn't be indexed.
 */
const MIGRATE_SOURCES = [
  'convex',
  'supabase',
  'firebase',
  'mongodb',
  'drizzle',
  'prisma',
  'postgres',
  'hasura',
  'nextauth',
] as const;

const PATHS: readonly string[] = [
  '/',
  '/pricing',
  '/compare',
  '/migrate',
  ...MIGRATE_SOURCES.map((s) => `/migrate/${s}`),
  '/signin',
  '/privacy',
  '/terms',
  '/subprocessors',
  '/trust',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PATHS.map((p) => ({
    url: `${SITE}${p}`,
    lastModified,
    changeFrequency: p === '/' ? ('weekly' as const) : ('monthly' as const),
    priority: p === '/' ? 1 : 0.5,
  }));
}
