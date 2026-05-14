import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from '../lib/og-frame';

export const runtime = 'edge';
export const alt = 'briven — the postgres backend you actually own';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * Dynamic OG image for briven.tech. Edge-runtime; Next caches at the CDN
 * once rendered. Keep title/subtitle in sync with the landing hero.
 */
export default function Image() {
  return renderOg({
    title: 'the postgres backend\nyou actually own.',
    subtitle:
      'reactive queries, typed schema, one-command deploys — on vanilla postgres. self-hostable. pg_dump is your escape hatch.',
  });
}
