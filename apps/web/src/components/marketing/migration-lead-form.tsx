'use client';

import { useState } from 'react';

interface Source {
  slug: string;
  name: string;
}

interface Props {
  apiOrigin: string;
  /** Pre-selected source slug for this page. Defaults to "" so the
   *  user has to pick. */
  defaultSource?: string;
  sources: readonly Source[];
}

type Urgency = 'exploring' | 'this_quarter' | 'this_month' | 'this_week';

interface SubmittedState {
  requestId: string;
  source: string;
}

/**
 * Public, unauthenticated migration intake form. Embedded on /migrate
 * + each /migrate/<source> page so prospects can request a migration
 * before signing up. Posts to /v1/migration-leads on the api origin
 * (rate-limited to 5/hr per IP) and renders an inline success state
 * with the briven request id the customer can quote in follow-ups.
 */
export function MigrationLeadForm({ apiOrigin, defaultSource = '', sources }: Props) {
  const [email, setEmail] = useState('');
  const [source, setSource] = useState(defaultSource);
  const [urgency, setUrgency] = useState<Urgency>('exploring');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceNotes, setSourceNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedState | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/migration-leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contactEmail: email.trim(),
          source: source || 'other',
          sourceUrl: sourceUrl.trim() || null,
          sourceNotes: sourceNotes.trim(),
          urgency,
        }),
      });
      if (res.status === 429) {
        setError(
          "too many requests from this address recently. wait an hour, or email migrations@briven.tech directly.",
        );
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? `submit failed: ${res.status}`);
        return;
      }
      const data = (await res.json()) as { requestId: string };
      setSubmitted({ requestId: data.requestId, source: source || 'other' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit failed');
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] p-6">
        <p className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h4)]">
          got it · we&apos;ll reach out within one business day
        </p>
        <p className="mt-3 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
          your request is queued. an operator will email you from{' '}
          <code>migrations@briven.tech</code> with the next steps — typically a short call
          to confirm scope, then the actual move while you keep running on{' '}
          {submitted.source}.
        </p>
        <p className="mt-4 font-mono text-xs text-[var(--color-text-subtle)]">
          request id:{' '}
          <code className="text-[var(--color-text-muted)]">{submitted.requestId}</code>
        </p>
        <p className="mt-3 font-mono text-[10px] text-[var(--color-text-subtle)]">
          if you don&apos;t hear from us within one business day, email{' '}
          <a
            href="mailto:migrations@briven.tech"
            className="underline underline-offset-2 hover:text-[var(--color-text-muted)]"
          >
            migrations@briven.tech
          </a>{' '}
          and quote the id above.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6"
    >
      <p className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h4)]">
        request a migration · no signup needed
      </p>
      <p className="leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
        leave us your email and we&apos;ll reach out within one business day. free during
        beta. your current platform stays untouched until you say cutover.
      </p>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          email <span className="text-[var(--color-text-subtle)]">(required)</span>
        </span>
        <input
          type="email"
          required
          maxLength={320}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">coming from</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          >
            <option value="">— pick one —</option>
            {sources.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
            <option value="other">other / not listed</option>
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">timeline</span>
          <select
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as Urgency)}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          >
            <option value="exploring">just exploring</option>
            <option value="this_quarter">this quarter</option>
            <option value="this_month">this month</option>
            <option value="this_week">this week · time-sensitive</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          source URL{' '}
          <span className="text-[var(--color-text-subtle)]">(optional — helps us scope)</span>
        </span>
        <input
          type="text"
          maxLength={2000}
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://my-deployment.convex.cloud or similar"
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          anything else?{' '}
          <span className="text-[var(--color-text-subtle)]">
            (rough table count, auth provider, specific concerns)
          </span>
        </span>
        <textarea
          rows={4}
          maxLength={8000}
          value={sourceNotes}
          onChange={(e) => setSourceNotes(e.target.value)}
          placeholder="~12 tables, clerk for auth, ~500 DAU. would like to cut over before our launch on the 21st."
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
        />
      </label>

      {error ? (
        <p className="font-mono text-xs text-[var(--color-error)]">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 font-sans font-medium text-[var(--color-text-inverse)] transition-colors hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'sending…' : 'request migration'}
        </button>
        <span className="font-mono text-[11px] text-[var(--color-text-subtle)]">
          we read what you send to triage. no marketing emails, ever.
        </span>
      </div>
    </form>
  );
}
