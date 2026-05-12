import type { MetadataRoute } from 'next';

const SITE = 'https://docs.briven.tech';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
