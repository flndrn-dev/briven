import Link from 'next/link';

import { apiJson } from '../../../../../../../lib/api';

interface MauResponse {
  count: number;
  ceiling: number;
  tier: 'free' | 'pro' | 'team';
  windowStart: string;
  windowEnd: string;
  usageFraction: number;
}

interface AuthStateResponse {
  enabled: boolean;
}

export const metadata = { title: 'auth · usage' };
export const dynamic = 'force-dynamic';

export default async function AuthUsagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const state = await apiJson<AuthStateResponse>(`/v1/projects/${id}/auth/config`).catch(
    () => null,
  );

  if (!state || !state.enabled) {
    return (
      <section className="flex flex-col gap-6">
        <header>
          <h2 className="font-mono text-lg tracking-tight">auth · usage</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            enable auth on this project first.
          </p>
        </header>
        <Link
          href={`/dashboard/projects/${id}/auth`}
          className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          ← back to auth overview
        </Link>
      </section>
    );
  }

  const mau = await apiJson<MauResponse>(`/v1/projects/${id}/auth/mau`);
  const pct = Math.min(100, Math.round(mau.usageFraction * 100));
  const over = mau.count > mau.ceiling;

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-lg tracking-tight">auth · usage</h2>
        <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          monthly active users — distinct end-user accounts with at least one
          session this utc calendar month (resets on the 1st, aligned to your
          invoice). going over the plan ceiling never blocks logins — overage
          is billed once the polar meter is live. deliverability + bounce panel
          lands alongside the mittera sender-domain wizard.
        </p>
      </header>

      <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
              mau · this calendar month
            </p>
            <p className="mt-1 font-mono text-2xl text-[var(--color-text)]">
              {mau.count.toLocaleString()}
              <span className="ml-2 font-mono text-xs text-[var(--color-text-muted)]">
                / {mau.ceiling.toLocaleString()}
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-muted)]">
              tier
            </p>
            <p className="mt-1 font-mono text-sm text-[var(--color-text)]">{mau.tier}</p>
          </div>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-sm bg-[var(--color-surface)]">
          <div
            className={`h-full ${over ? 'bg-[var(--color-error)]' : 'bg-[var(--color-primary)]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
          window {mau.windowStart.slice(0, 10)} → {mau.windowEnd.slice(0, 10)} (utc)
          {over ? (
            <span className="ml-2 text-[var(--color-error)]">
              over plan ceiling — overage charges apply (logins are never
              blocked) once the meter is live
            </span>
          ) : null}
        </p>
      </div>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <h3 className="font-mono text-sm text-[var(--color-text)]">deliverability</h3>
        <p className="mt-2">
          sent / delivered / bounced / complaint stats come from mittera once the
          sender-domain wizard is wired into the branding panel. lands alongside
          BUILD_PLAN.md §8 deliverability work.
        </p>
        <p className="mt-2 text-[11px] text-[var(--color-text-subtle)]">
          today: no data — the per-tenant mittera sender domain isn&apos;t verified
          yet.
        </p>
      </div>
    </section>
  );
}
