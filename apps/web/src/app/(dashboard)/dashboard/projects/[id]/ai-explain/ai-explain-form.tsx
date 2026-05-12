'use client';

import { useState, type FormEvent } from 'react';

interface Props {
  projectId: string;
}

interface ExplainResponse {
  explanation: string;
  model: string;
  elapsedMs: number;
}

interface NotConfiguredResponse {
  code: 'not_configured';
  message: string;
}

export function AiExplainForm({ projectId }: Props) {
  const [code, setCode] = useState('');
  const [perspective, setPerspective] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ExplainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!code.trim()) return;
    setPending(true);
    setError(null);
    setResult(null);
    setNotConfigured(false);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/ai/explain-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          code: code.trim(),
          ...(perspective.trim() ? { perspective: perspective.trim() } : {}),
        }),
      });
      if (res.status === 503) {
        const body = (await res.json().catch(() => null)) as NotConfiguredResponse | null;
        setNotConfigured(true);
        setError(body?.message ?? 'AI features are disabled on this deployment');
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `request failed (${res.status})`);
      }
      const data = (await res.json()) as ExplainResponse;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            paste briven schema or function code
          </span>
          <textarea
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
            rows={12}
            maxLength={8192}
            required
            disabled={pending}
            placeholder={`import { brivenError, query, type Ctx } from '@briven/cli/server';

export default query(async (ctx: Ctx, args: { userId: string }) => {
  return ctx.db('posts').where({ authorId: args.userId }).orderBy('createdAt', 'desc');
});`}
            className="resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
          />
          <span className="text-right font-mono text-[10px] text-[var(--color-text-subtle)]">
            {code.length} / 8192
          </span>
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            perspective (optional)
          </span>
          <input
            type="text"
            value={perspective}
            onChange={(e) => setPerspective(e.currentTarget.value)}
            maxLength={512}
            disabled={pending}
            placeholder="i'm new to briven and migrated from prisma"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
          />
        </label>

        <button
          type="submit"
          disabled={pending || !code.trim()}
          className="inline-flex w-fit items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
        >
          {pending ? 'thinking…' : 'explain this code'}
        </button>
      </form>

      {error ? (
        <div
          className={`rounded-md border p-4 font-mono text-xs ${
            notConfigured
              ? 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[var(--color-text-muted)]'
              : 'border-red-400/40 bg-red-500/5 text-red-300'
          }`}
        >
          {notConfigured ? (
            <>
              <p className="text-[var(--color-text)]">AI assistant offline</p>
              <p className="mt-1">{error}</p>
              <p className="mt-2 text-[var(--color-text-subtle)]">
                operator: set <code>BRIVEN_OLLAMA_URL</code> on the api container to enable.
              </p>
            </>
          ) : (
            error
          )}
        </div>
      ) : null}

      {result ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
          <p className="mb-3 font-mono text-xs text-[var(--color-text-subtle)]">
            explained by {result.model} in {result.elapsedMs}ms
          </p>
          <div className="whitespace-pre-wrap font-mono text-xs text-[var(--color-text)]">
            {result.explanation}
          </div>
        </div>
      ) : null}
    </div>
  );
}
