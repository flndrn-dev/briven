'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '../../../../../components/step-up-prompt';

interface Props {
  apiOrigin: string;
}

export function RetrySkippedForm({ apiOrigin }: Props) {
  const router = useRouter();
  const [sinceDays, setSinceDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  async function run(days: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/usage-events/retry-skipped`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sinceDays: days }),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPending(days);
          return;
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `retry failed: ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'retry failed');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void run(Number(sinceDays));
  }

  return (
    <>
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <label className="font-mono text-[10px] text-[var(--color-text-muted)]">
          retry skipped within
        </label>
        <select
          value={sinceDays}
          onChange={(e) => setSinceDays(e.target.value)}
          disabled={busy}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] disabled:opacity-50"
        >
          <option value="1">1d</option>
          <option value="7">7d</option>
          <option value="30">30d</option>
          <option value="90">90d</option>
        </select>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] px-3 py-1 font-mono text-xs text-[var(--color-primary)] hover:bg-[var(--color-primary)]/15 disabled:opacity-50"
        >
          {busy ? 'retrying…' : 'retry → pending'}
        </button>
      </form>
      {error ? (
        <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p>
      ) : null}
      {pending != null ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="re-queueing skipped usage events for polar push requires fresh step-up auth."
          onSuccess={async () => {
            const d = pending;
            setPending(null);
            await run(d);
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </>
  );
}
