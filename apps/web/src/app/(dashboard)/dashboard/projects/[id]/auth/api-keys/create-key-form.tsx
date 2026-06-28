'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CopyButton } from '@/components/ui/copy-button';

type Scope = 'read' | 'read-write' | 'admin';

interface Props {
  projectId: string;
}

interface CreateResponse {
  key: {
    id: string;
    name: string;
    prefix: string;
    suffix: string;
    scope: Scope;
    createdAt: string;
  };
  plaintext: string;
}

interface ErrorBody {
  code?: string;
  message?: string;
}

/**
 * Inline form to mint a new SDK key. On success the response carries the
 * plaintext exactly once; we render it in a "save it now" panel with a
 * copy button. Closing the panel clears it from React state — there is
 * no other place it persists client-side.
 */
export function CreateKeyForm({ projectId }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<Scope>('read');
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateResponse | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setPending(true);
    setErrMsg(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/api-keys`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scope }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorBody;
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      const body = (await res.json()) as CreateResponse;
      setCreated(body);
      setName('');
      setScope('read');
      router.refresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'create failed');
    } finally {
      setPending(false);
    }
  }

  function dismiss(): void {
    setCreated(null);
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <h3 className="font-mono text-sm text-[var(--color-text)]">create key</h3>

      <form className="flex flex-col gap-3 md:flex-row md:items-end" onSubmit={(e) => void submit(e)}>
        <label className="flex flex-1 flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
          <span>name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={1}
            maxLength={64}
            placeholder="e.g. production web"
            className="rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
          <span>scope</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            className="rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          >
            <option value="read">read</option>
            <option value="read-write">read-write</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'creating…' : 'create'}
        </button>
      </form>

      {errMsg ? (
        <p className="font-mono text-xs text-[var(--color-error)]">{errMsg}</p>
      ) : null}

      {created ? (
        <div className="flex flex-col gap-2 rounded-sm border border-[var(--color-primary)] bg-[var(--color-surface)] p-3">
          <p className="font-mono text-xs text-[var(--color-text)]">
            new key <code>{created.key.name}</code> · scope {created.key.scope}
          </p>
          <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
            copy this value now. it will not be shown again — only its sha-256
            digest is stored.
          </p>
          <pre className="overflow-x-auto rounded-sm bg-[var(--color-surface-raised)] p-2 font-mono text-[11px] text-[var(--color-text)]">
            {created.plaintext}
          </pre>
          <div className="flex items-center gap-2">
            <CopyButton
              value={created.plaintext}
              label="copy"
              showLabel
              className="border border-[var(--color-border)] px-3 py-1.5 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            />
            <button
              type="button"
              onClick={dismiss}
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
