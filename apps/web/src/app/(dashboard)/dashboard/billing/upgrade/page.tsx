import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { apiFetch, apiJson } from '../../../../../lib/api';
import { requireUser } from '../../../../../lib/session';

export const metadata = { title: 'upgrade' };
export const dynamic = 'force-dynamic';

interface CheckoutBody {
  tier: 'pro' | 'team';
  successURL: string;
}

type Tier = 'free' | 'pro' | 'team';
const RANK: Record<Tier, number> = { free: 0, pro: 1, team: 2 };
const TIER_PRICE: Record<'pro' | 'team', string> = { pro: '$29.99 / mo', team: '$99.99 / mo' };

/**
 * Upgrade intent page. Landing-page + dashboard "get pro/team" links point
 * here with ?tier=pro|team, and the sign-in flow can redirect here via `next=`
 * after a magic-link login.
 *
 * IMPORTANT — this page must NEVER auto-charge or trap the visitor:
 *   1. Existing subscribers at or above the requested tier are bounced to
 *      /dashboard/billing (you can't "upgrade" to a plan you already have, and
 *      a signed-in Team/Pro user who arrived via a stale link should land on
 *      their dashboard, not a checkout). This was the bug: an already-Team
 *      account got force-marched into a Pro checkout after sign-in.
 *   2. A genuine step-up shows a confirmation screen with a "back to dashboard"
 *      escape. The Polar checkout only starts when the visitor explicitly
 *      clicks "continue to payment" (the form's server action) — no silent
 *      redirect to the payment provider.
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
        <p className="mt-6">
          <a href="/dashboard" className="text-[var(--color-text-link)]">
            ← back to dashboard
          </a>
        </p>
      </main>
    );
  }

  // Guard: never offer a checkout for a tier the account already has (or a
  // downgrade). Bounce to the billing overview instead of charging.
  const current = await apiJson<{ tier: Tier }>('/v1/billing/subscription').catch(() => ({
    tier: 'free' as Tier,
  }));
  if (RANK[current.tier] >= RANK[tier]) {
    redirect('/dashboard/billing');
  }

  // Server action — only reached when the visitor clicks "continue to payment".
  async function startCheckout(): Promise<void> {
    'use server';
    await requireUser();
    const h = await headers();
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'briven.tech';
    const origin = `${proto}://${host}`;

    const body: CheckoutBody = {
      tier: tier as 'pro' | 'team',
      successURL: `${origin}/dashboard/billing?checkout=success`,
    };
    const res = await apiFetch('/v1/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Don't strand the user on a dead page — send them to billing where they
      // can see their plan and retry via the upgrade buttons.
      redirect('/dashboard/billing?checkout=error');
    }
    const { url } = (await res.json()) as { url: string };
    redirect(url);
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-16 font-mono text-sm">
      <h1 className="text-xl text-[var(--color-text)]">upgrade to {tier}</h1>
      <p className="mt-3 text-[var(--color-text-muted)]">
        {tier} plan — <span className="text-[var(--color-text)]">{TIER_PRICE[tier]}</span>. clicking
        continue takes you to our payment provider (Polar) to finish securely. VAT / sales tax is
        calculated at checkout based on your country.
      </p>
      <div className="mt-8 flex items-center gap-3">
        <form action={startCheckout}>
          <button
            type="submit"
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
          >
            continue to payment
          </button>
        </form>
        <a
          href="/dashboard"
          className="rounded-md border border-[var(--color-border)] px-4 py-2 font-mono text-sm text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)]"
        >
          back to dashboard
        </a>
      </div>
    </main>
  );
}
