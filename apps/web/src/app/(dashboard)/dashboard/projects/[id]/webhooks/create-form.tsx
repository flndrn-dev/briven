'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  projectId: string;
  apiOrigin: string;
  webhookOrigin: string;
  functionNames: string[];
}

interface CreatedEndpoint {
  id: string;
  name: string;
}

interface CreatedSecret {
  endpoint: CreatedEndpoint;
  plaintextSecret: string;
  url: string;
}

export function CreateWebhookForm({
  projectId,
  apiOrigin,
  webhookOrigin,
  functionNames,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [functionName, setFunctionName] = useState(functionNames[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedSecret | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/projects/${projectId}/webhooks`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, functionName }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `create failed: ${res.status}`);
      }
      const json = (await res.json()) as {
        endpoint: CreatedEndpoint;
        plaintextSecret: string;
      };
      setCreated({
        endpoint: json.endpoint,
        plaintextSecret: json.plaintextSecret,
        url: `${webhookOrigin}/webhooks/${projectId}/${json.endpoint.id}`,
      });
      setName('');
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
            webhook &quot;{created.endpoint.name}&quot; created
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            copy the signing secret below — it&apos;s shown once. you&apos;ll need it to sign every
            request your source sends.
          </p>
        </header>

        <SecretReveal label="endpoint url" value={created.url} />
        <SecretReveal label="signing secret" value={created.plaintextSecret} mono mask />

        <details className="font-mono text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer">how to sign requests</summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--color-code-bg)] p-3 text-[var(--color-code-text)]">
{`# pseudo-code (per request)
ts = current_unix_ms()
body = json.encode(payload)
sig = hmac_sha256(secret, ts + "." + body).hex()

POST ${created.url}
  X-Briven-Signature: v1=$sig
  X-Briven-Timestamp: $ts
  content-type: application/json
  $body`}
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
          placeholder="stripe-payments"
          pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          target function
        </span>
        {functionNames.length > 0 ? (
          <select
            required
            value={functionName}
            onChange={(e) => setFunctionName(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
          >
            {functionNames.map((fn) => (
              <option key={fn} value={fn}>
                {fn}
              </option>
            ))}
          </select>
        ) : (
          <input
            required
            value={functionName}
            onChange={(e) => setFunctionName(e.target.value)}
            placeholder="handleStripeEvent"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
          />
        )}
      </label>

      <div className="md:col-span-2">
        <button
          type="submit"
          disabled={isPending || !name || !functionName}
          className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 font-sans text-sm text-[var(--color-text-inverse)] transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          create webhook
        </button>
        {error ? (
          <p className="mt-2 font-mono text-xs text-[var(--color-error)]">{error}</p>
        ) : null}
        {functionNames.length === 0 ? (
          <p className="mt-2 font-mono text-xs text-[var(--color-warning)]">
            no deployed functions yet. deploy the project once so the dropdown can list real
            targets.
          </p>
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
      // ignore — some browsers block clipboard from non-https contexts
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
            className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
          >
            {revealed ? 'hide' : 'show'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
    </div>
  );
}
