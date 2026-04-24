'use client';

import { useState } from 'react';

interface Plan {
  tier: 'pro' | 'team';
  productId: string;
}

interface Props {
  plans: Plan[];
  currentTier: 'free' | 'pro' | 'team';
}

const TIER_RANK: Record<'free' | 'pro' | 'team', number> = { free: 0, pro: 1, team: 2 };

function labelFor(target: Plan['tier'], current: 'free' | 'pro' | 'team'): string {
  const direction = TIER_RANK[target] > TIER_RANK[current] ? 'upgrade' : 'downgrade';
  return `${direction} to ${target}`;
}

/**
 * Plan-switch buttons for the /dashboard/billing page. Opens a Polar
 * checkout for the requested tier and redirects the user to the hosted
 * URL. Label reflects direction (upgrade vs downgrade) relative to the
 * user's current tier, and we surface the *adjacent* tiers only — jumping
 * Free → Team is still possible (both shown on free), but Team users
 * don't see a "downgrade to free" here; cancellation lives in the portal.
 */
export function UpgradeButtons({ plans, currentTier }: Props) {
  const [pending, setPending] = useState<Plan['tier'] | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function startCheckout(tier: Plan['tier']): Promise<void> {
    setPending(tier);
    setErrMsg(null);
    try {
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tier,
          successURL: `${window.location.origin}/dashboard/billing?checkout=success`,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        throw new Error(body.message ?? body.code ?? `checkout failed: ${res.status}`);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'checkout failed');
      setPending(null);
    }
  }

  // For free users we show both upgrade paths (pro + team).
  // For pro we show the upward path only (team).
  // For team we show the single step down (pro); cancellation is in the portal.
  const pickable = plans.filter((p) => {
    if (p.tier === currentTier) return false;
    if (currentTier === 'team') return p.tier === 'pro';
    if (currentTier === 'pro') return p.tier === 'team';
    return true;
  });
  if (pickable.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {pickable.map((p) => {
          const label = labelFor(p.tier, currentTier);
          return (
            <button
              key={p.tier}
              type="button"
              onClick={() => void startCheckout(p.tier)}
              disabled={pending !== null}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
            >
              {pending === p.tier ? `opening ${p.tier} checkout…` : label}
            </button>
          );
        })}
      </div>
      {errMsg ? (
        <p className="font-mono text-xs text-[var(--color-error)]">{errMsg}</p>
      ) : null}
    </div>
  );
}
