import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from '../../../lib/og-frame';

export const runtime = 'edge';
export const alt = 'briven vs supabase — typed functions + reactive queries on postgres';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOg({
    eyebrow: 'briven vs supabase',
    title: 'typed functions\n+ reactive queries.',
    subtitle:
      'both run on real postgres. briven puts a typed function layer in front and adds query-level reactive subscriptions supabase doesn’t have.',
  });
}
