'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

interface Props {
  projectId: string;
  authEventTypes: readonly string[];
}

interface CreateResponse {
  subscriber: {
    id: string;
    name: string;
    targetUrl: string;
    eventTypes: string;
    enabled: boolean;
    createdAt: string;
  };
  plaintextSecret: string;
}

interface ErrorBody {
  code?: string;
  message?: string;
  issues?: unknown;
}

/**
 * Auth-scoped webhook creator. Mirrors the general outbound-webhooks
 * `POST` endpoint but constrains the event-types UI to the auth.* subset.
 * Defaults every auth event ON — most customers want all of them on a
 * single endpoint. Signing secret is returned exactly once.
 */
export function CreateAuthWebhookForm({ projectId, authEventTypes }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(authEventTypes));
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateResponse | null>(null);

  const eventTypesCsv = useMemo(
    () => Array.from(selected).sort().join(','),
    [selected],
  );

  function toggle(event: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (selected.size === 0) {
      setErrMsg('select at least one auth event');
      return;
    }
    setPending(true);
    setErrMsg(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/outbound-webhooks`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          targetUrl: targetUrl.trim(),
          eventTypes: eventTypesCsv,
          enabled: true,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorBody;
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      const body = (await res.json()) as CreateResponse;
      setCreated(body);
      setName('');
      setTargetUrl('');
      setSelected(new Set(authEventTypes));
      router.refresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'create failed');
    } finally {
      setPending(false);
    }
  }

  function copySecret(): void {
    if (!created) return;
    void navigator.clipboard.writeText(created.plaintextSecret).catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <h3 className="font-mono text-sm text-[var(--color-text)]">create auth webhook</h3>

      <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
        <div className="flex flex-col gap-3 md:flex-row">
          <label className="flex flex-1 flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
            <span>name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={1}
              maxLength={64}
              placeholder="e.g. production crm sync"
              className="rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
            <span>target url</span>
            <input
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              required
              placeholder="https://your-app.com/webhooks/briven-auth"
              className="rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-mono text-xs text-[var(--color-text-muted)]">events</legend>
          <div className="flex flex-wrap gap-2">
            {authEventTypes.map((event) => {
              const on = selected.has(event);
              return (
                <button
                  type="button"
                  key={event}
                  onClick={() => toggle(event)}
                  className={`rounded-sm border px-2 py-1 font-mono text-[11px] ${
                    on
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
                  }`}
                >
                  {event.replace('auth.', '')}
                </button>
              );
            })}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'creating…' : 'create webhook'}
        </button>
      </form>

      {errMsg ? (
        <p className="font-mono text-xs text-[var(--color-error)]">{errMsg}</p>
      ) : null}

      {created ? (
        <div className="flex flex-col gap-2 rounded-sm border border-[var(--color-primary)] bg-[var(--color-surface)] p-3">
          <p className="font-mono text-xs text-[var(--color-text)]">
            webhook <code>{created.subscriber.name}</code> created
          </p>
          <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
            signing secret — copy it now, it will not be shown again. verify
            inbound requests by computing{' '}
            <code>HMAC-SHA256(secret, &quot;ts.rawBody&quot;)</code> and comparing
            against the <code>X-Briven-Signature: v1=&lt;hex&gt;</code> header.
          </p>
          <pre className="overflow-x-auto rounded-sm bg-[var(--color-surface-raised)] p-2 font-mono text-[11px] text-[var(--color-text)]">
            {created.plaintextSecret}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={copySecret}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            >
              copy
            </button>
            <button
              type="button"
              onClick={() => setCreated(null)}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            >
              i&apos;ve copied it
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
