'use client';

import { useState, type FormEvent } from 'react';

import { useAiStream } from '../../../../../../lib/use-ai-stream';

interface Props {
  projectId: string;
}

export function AiExplainForm({ projectId }: Props) {
  const [code, setCode] = useState('');
  const [perspective, setPerspective] = useState('');
  const { text, status, error, start } = useAiStream();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!code.trim()) return;
    await start(`/api/v1/projects/${projectId}/ai/explain-code/stream`, {
      code: code.trim(),
      ...(perspective.trim() ? { perspective: perspective.trim() } : {}),
    });
  }

  const pending = status === 'streaming';
  const notConfigured = status === 'not_configured';

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

      {text || pending ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
          <p className="mb-3 font-mono text-xs text-[var(--color-text-subtle)]">
            {pending ? 'streaming…' : `${text.length} chars`}
          </p>
          <div className="whitespace-pre-wrap font-mono text-xs text-[var(--color-text)]">
            {text}
            {pending ? (
              <span className="ml-0.5 inline-block h-3 w-2 animate-pulse bg-[var(--color-primary)] align-middle" />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
