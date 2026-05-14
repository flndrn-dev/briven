import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from '../../lib/og-frame';

export const runtime = 'edge';
export const alt = 'briven customers — dogfood projects running in production';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOg({
    eyebrow: 'customers',
    title: 'the projects briven runs.\nnot demos.',
    subtitle:
      'briven is built dogfood-first through 2026. these are the production workloads on the platform right now.',
  });
}
