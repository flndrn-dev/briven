import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from '../../lib/og-frame';

export const runtime = 'edge';
export const alt = 'briven status — live health of every service';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOg({
    eyebrow: 'status',
    title: 'briven, live.',
    subtitle:
      'probes run when this page is rendered — no cached numbers, no marketing dashboards.',
  });
}
