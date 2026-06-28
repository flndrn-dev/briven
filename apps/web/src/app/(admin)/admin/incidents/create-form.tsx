'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';

const SEVERITIES = ['critical', 'major', 'minor', 'maintenance'] as const;
const SERVICES = ['api', 'realtime', 'runtime', 'web', 'docs', 'all'] as const;

type Severity = (typeof SEVERITIES)[number];

export function IncidentCreateForm({ apiOrigin }: { apiOrigin: string }) {
  const router = useRouter();
  const [severity, setSeverity] = useState<Severity>('minor');
  const [services, setServices] = useState<Set<string>>(new Set(['api']));
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState(false);
  const [, startTransition] = useTransition();

  function toggleService(s: string) {
    setServices((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/incidents`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          severity,
          services: Array.from(services),
          summary,
        }),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPendingRetry(true);
          return;
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `create failed: ${res.status}`);
      }
      setSummary('');
      setServices(new Set(['api']));
      setSeverity('minor');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5"
    >
      <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
        new incident
      </h3>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          severity
        </span>
        <div className="flex flex-wrap gap-1">
          {SEVERITIES.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setSeverity(s)}
              className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                severity === s
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          affected services
        </span>
        <div className="flex flex-wrap gap-1">
          {SERVICES.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => toggleService(s)}
              className={`rounded-md border px-2 py-0.5 font-mono text-[10px] ${
                services.has(s)
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          summary
        </span>
        <textarea
          required
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="briefly: what's happening, who's affected, what's the workaround if any."
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
        />
      </label>

      <div>
        <button
          type="submit"
          disabled={busy || summary.length === 0 || services.size === 0}
          className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 font-sans text-sm text-[var(--color-text-inverse)] transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {busy ? 'publishing…' : 'publish incident'}
        </button>
      </div>

      {error ? (
        <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p>
      ) : null}

      {pendingRetry ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="publishing an incident updates the public status page. confirm with your password."
          onSuccess={async () => {
            setPendingRetry(false);
            await submit();
          }}
          onCancel={() => setPendingRetry(false)}
        />
      ) : null}
    </form>
  );
}
