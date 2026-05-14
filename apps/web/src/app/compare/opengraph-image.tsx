import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from '../../lib/og-frame';

export const runtime = 'edge';
export const alt = 'briven vs convex, supabase, firebase — honest comparisons';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOg({
    eyebrow: 'compare',
    title: 'briven against the field.',
    subtitle:
      'feature-by-feature comparisons against convex, supabase, firebase. real differences. where the other side wins, we say so.',
  });
}
