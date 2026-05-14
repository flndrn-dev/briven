import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from '../../../lib/og-frame';

export const runtime = 'edge';
export const alt = 'briven vs firebase — when you outgrow nosql';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOg({
    eyebrow: 'briven vs firebase',
    title: 'when you outgrow nosql.',
    subtitle:
      'firebase shines on mobile prototypes. once your data picks up relations + transactions, briven is the postgres-shaped version of the same idea.',
  });
}
