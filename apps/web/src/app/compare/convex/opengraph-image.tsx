import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from '../../../lib/og-frame';

export const runtime = 'edge';
export const alt = 'briven vs convex — reactive queries on plain postgres';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOg({
    eyebrow: 'briven vs convex',
    title: 'reactive queries\non plain postgres.',
    subtitle:
      'convex pioneered the pattern; briven stores your data in real postgres. pg_dump moves the whole product anywhere.',
  });
}
