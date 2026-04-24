import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { apiFetch } from '../../../../../lib/api';
import { requireUser } from '../../../../../lib/session';

export const metadata = { title: 'upgrade' };
export const dynamic = 'force-dynamic';

interface CheckoutBody {
  tier: 'pro' | 'team';
  successURL: string;
}

/**
 * Server-action bounce: landing-page "get pro" links point here with
 * ?tier=pro|team. We require auth (signin handles the next= redirect back),
 * POST /v1/billing/checkout, and forward the user to the Polar-hosted URL.
 */
export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string }>;
}) {
  await requireUser();
  const { tier } = await searchParams;

  if (tier !== 'pro' && tier !== 'team') {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 font-mono text-sm">
        <h1 className="text-xl">unknown plan</h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          pick a plan from the{' '}
          <a href="/#pricing" className="text-[var(--color-text-link)]">
            pricing section
          </a>
          .
        </p>
      </main>
    );
  }

  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'briven.cloud';
  const origin = `${proto}://${host}`;

  const body: CheckoutBody = {
    tier,
    successURL: `${origin}/dashboard/billing?checkout=success`,
  };

  const res = await apiFetch('/v1/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    return (
      <main className="mx-auto max-w-lg px-6 py-16 font-mono text-sm">
        <h1 className="text-xl">couldn&apos;t start checkout</h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          {errBody.message ?? errBody.code ?? `http ${res.status}`}
        </p>
        <p className="mt-6">
          <a href="/dashboard/settings" className="text-[var(--color-text-link)]">
            back to settings
          </a>
        </p>
      </main>
    );
  }

  const { url } = (await res.json()) as { url: string };
  redirect(url);
}
