'use client';

import { useState } from 'react';

interface Props {
  label?: string;
  variant?: 'primary' | 'secondary';
}

/**
 * Opens a Polar customer portal session for the signed-in user. Only
 * rendered when the user already has a polar_customer_id (i.e. they've
 * completed a checkout at least once).
 */
export function ManageBillingButton({ label = 'manage billing on polar', variant = 'secondary' }: Props) {
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function openPortal(): Promise<void> {
    setPending(true);
    setErrMsg(null);
    try {
      const res = await fetch('/api/v1/billing/portal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          returnURL: `${window.location.origin}/dashboard/billing`,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
        };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'portal failed to open');
      setPending(false);
    }
  }

  const classes =
    variant === 'primary'
      ? 'rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50'
      : 'rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50';

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void openPortal()}
        disabled={pending}
        className={`self-start ${classes}`}
      >
        {pending ? 'opening portal…' : label}
      </button>
      {errMsg ? (
        <p className="font-mono text-xs text-[var(--color-error)]">{errMsg}</p>
      ) : null}
    </div>
  );
}
