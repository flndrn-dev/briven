import type { MetadataRoute } from 'next';

const SITE = 'https://docs.briven.tech';

/**
 * Static sitemap of every docs route. Update when adding new pages; the
 * marketing site has its own sitemap at briven.tech/sitemap.xml.
 */
const PATHS: readonly string[] = [
  '/',
  '/quickstart',
  '/cli',
  '/templates',
  '/schema',
  '/examples',
  '/functions',
  '/api',
  '/migration',
  '/migration/convex',
  '/migration/supabase',
  '/migration/firebase',
  '/migration/hasura',
  '/migration/postgres',
  '/migration/nextauth',
  '/ai',
  '/self-host',
  '/operator',
  '/roadmap',
  '/changelog',
  '/status',
  '/support',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PATHS.map((p) => ({
    url: `${SITE}${p}`,
    lastModified,
    changeFrequency: p === '/changelog' || p === '/status' ? ('daily' as const) : ('weekly' as const),
    priority: p === '/' ? 1 : p === '/quickstart' || p === '/migration' ? 0.9 : 0.7,
  }));
}
