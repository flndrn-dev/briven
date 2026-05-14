'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  projectId: string;
  apiOrigin: string;
  knownEventTypes: readonly string[];
}

interface CreatedSubscriber {
  id: string;
  name: string;
  targetUrl: string;
}

interface CreatedResult {
  subscriber: CreatedSubscriber;
  plaintextSecret: string;
}

const PRESET_FILTERS: { label: string; value: string }[] = [
  { label: 'all events', value: '*' },
  { label: 'deploys only', value: 'deploy.succeeded,deploy.failed' },
  { label: 'suspensions only', value: 'project.suspended,project.resumed' },
  { label: 'tier changes only', value: 'tier.changed' },
];

export function CreateSubscriberForm({ projectId, apiOrigin, knownEventTypes }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [eventTypes, setEventTypes] = useState('*');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedResult | null>(null);
  const [, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/projects/${projectId}/outbound-webhooks`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, targetUrl, eventTypes }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `create failed: ${res.status}`);
      }
      const json = (await res.json()) as CreatedResult;
      setCreated(json);
      setName('');
      setTargetUrl('');
      setEventTypes('*');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    }
  }

  if (created) {
    return (
      <div className="flex flex-col gap-4 rounded-md border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] p-5">
        <header>
          <p className="font-mono text-sm text-[var(--color-primary)]">
            subscriber &quot;{created.subscriber.name}&quot; created
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            briven will POST to your endpoint with X-Briven-Signature on every matching event.
            verify with the signing secret below — shown once.
          </p>
        </header>

        <SecretReveal label="target url" value={created.subscriber.targetUrl} />
        <SecretReveal label="signing secret" value={created.plaintextSecret} mono mask />

        <details className="font-mono text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer">how to verify briven&apos;s requests</summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--color-code-bg)] p-3 text-[var(--color-code-text)]">
{`# in your handler
ts  = headers["x-briven-timestamp"]
sig = headers["x-briven-signature"]   # "v1=<hex>"
event = headers["x-briven-event"]     # e.g. deploy.succeeded
event_id = headers["x-briven-event-id"]

expected = hmac_sha256(secret, ts + "." + rawBody).hex()
if not constant_time_eq(sig.removeprefix("v1="), expected):
  return 401`}
          </pre>
        </details>

        <button
          type="button"
          onClick={() => setCreated(null)}
          className="self-start font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          dismiss · create another
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 md:grid-cols-2"
    >
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          name
        </span>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="discord-deploy-notifier"
          pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          target url
        </span>
        <input
          required
          type="url"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://your-service.example.com/webhooks/briven"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          event types
        </span>
        <input
          required
          value={eventTypes}
          onChange={(e) => setEventTypes(e.target.value)}
          placeholder="*"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
        />
        <div className="mt-1 flex flex-wrap gap-1">
          {PRESET_FILTERS.map((p) => (
            <button
              type="button"
              key={p.value}
              onClick={() => setEventTypes(p.value)}
              className={`rounded-md border px-2 py-0.5 font-mono text-[10px] ${
                eventTypes === p.value
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-1 font-mono text-[10px] text-[var(--color-text-subtle)]">
          known events: {knownEventTypes.join(', ')}. use <code>*</code> for everything or a
          comma-separated list for specific events.
        </p>
      </label>

      <div className="md:col-span-2">
        <button
          type="submit"
          disabled={!name || !targetUrl}
          className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 font-sans text-sm text-[var(--color-text-inverse)] transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          create subscriber
        </button>
        {error ? (
          <p className="mt-2 font-mono text-xs text-[var(--color-error)]">{error}</p>
        ) : null}
      </div>
    </form>
  );
}

function SecretReveal({
  label,
  value,
  mono,
  mask,
}: {
  label: string;
  value: string;
  mono?: boolean;
  mask?: boolean;
}) {
  const [revealed, setRevealed] = useState(!mask);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <code
          className={`flex-1 truncate rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] px-3 py-2 text-xs text-[var(--color-code-text)] ${
            mono ? 'font-mono' : ''
          }`}
        >
          {revealed ? value : '•'.repeat(Math.min(48, value.length))}
        </code>
        {mask ? (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {revealed ? 'hide' : 'show'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
    </div>
  );
}
