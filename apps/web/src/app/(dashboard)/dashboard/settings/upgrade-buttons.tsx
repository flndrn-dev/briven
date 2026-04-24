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

const TIER_LABEL: Record<Plan['tier'], string> = {
  pro: 'upgrade to pro',
  team: 'upgrade to team',
};

/**
 * Plan-picker buttons rendered beneath the billing card when Polar is wired.
 * `plans` is whatever GET /v1/billing/plans returned — empty means the
 * `BRIVEN_POLAR_*_PRODUCT_ID` env vars aren't set and the parent shows a
 * "not configured" note instead.
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
          successURL: `${window.location.origin}/dashboard/settings?checkout=success`,
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

  const pickable = plans.filter((p) => p.tier !== currentTier);
  if (pickable.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {pickable.map((p) => (
          <button
            key={p.tier}
            type="button"
            onClick={() => void startCheckout(p.tier)}
            disabled={pending !== null}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
          >
            {pending === p.tier ? `opening ${p.tier} checkout…` : TIER_LABEL[p.tier]}
          </button>
        ))}
      </div>
      {errMsg ? (
        <p className="font-mono text-xs text-[var(--color-error)]">{errMsg}</p>
      ) : null}
    </div>
  );
}
