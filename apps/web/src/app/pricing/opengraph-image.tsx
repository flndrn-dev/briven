import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from '../../lib/og-frame';

export const runtime = 'edge';
export const alt = 'briven pricing — free, pro €29, team €99, self-host commercial';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOg({
    eyebrow: 'pricing',
    title: 'flat fees,\nmonthly buckets.',
    subtitle:
      'free, pro €29/mo, team €99/mo. self-host free under agpl-3.0 or a commercial licence. no surprise upgrade walls. pg_dump is your escape hatch.',
  });
}
