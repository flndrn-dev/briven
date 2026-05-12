import type { MetadataRoute } from 'next';

const SITE = 'https://briven.tech';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Dashboard is auth-gated and surfaces user data — disallow indexing.
        // The /api proxy is internal-only.
        disallow: ['/dashboard/', '/api/', '/signin'],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
