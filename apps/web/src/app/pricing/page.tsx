import type { Metadata } from 'next';

import { BackgroundGrid } from '../../components/marketing/background-grid';
import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteHeader } from '../../components/marketing/site-header';
import { getSessionUser } from '../../lib/session';
import { PricingSection } from '../pricing-section';

export const metadata: Metadata = {
  title: 'pricing — briven',
  description:
    'briven pricing: free, pro €29, team €99 — flat fees, monthly buckets, no surprise upgrade walls. self-host free under agpl-3.0 or take a commercial licence.',
};

export default async function PricingPage() {
  const user = await getSessionUser().catch(() => null);
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <BackgroundGrid />
      <SiteHeader user={user} />
      <div className="relative z-10">
        <PricingSection />
      </div>
      <SiteFooter />
    </main>
  );
}
