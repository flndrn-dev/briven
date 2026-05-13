'use client';

import { useState, type FormEvent } from 'react';

import { useAiStream } from '../../../../../../lib/use-ai-stream';

interface Props {
  projectId: string;
}

export function AiSchemaForm({ projectId }: Props) {
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const { text, status, error, start } = useAiStream();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setCopied(false);
    await start(`/api/v1/projects/${projectId}/ai/generate-schema/stream`, {
      prompt: prompt.trim(),
    });
  }

  async function copy() {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const pending = status === 'streaming';
  const notConfigured = status === 'not_configured';

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            describe your data model
          </span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.currentTarget.value)}
            rows={5}
            maxLength={4000}
            required
            disabled={pending}
            placeholder="a blog with users, posts, and threaded comments. users can favourite posts."
            className="resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
          />
          <span className="text-right font-mono text-[10px] text-[var(--color-text-subtle)]">
            {prompt.length} / 4000
          </span>
        </label>

        <button
          type="submit"
          disabled={pending || !prompt.trim()}
          className="inline-flex w-fit items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
        >
          {pending ? 'streaming…' : 'generate schema'}
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
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-xs text-[var(--color-text-subtle)]">
              {pending ? 'streaming…' : `${text.length} chars`}
            </p>
            {!pending && text ? (
              <button
                type="button"
                onClick={copy}
                className="rounded-md border border-[var(--color-border)] px-3 py-1 font-mono text-xs hover:bg-[var(--color-surface-raised)]"
              >
                {copied ? 'copied!' : 'copy'}
              </button>
            ) : null}
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">
            <code>{text}</code>
            {pending ? (
              <span className="ml-0.5 inline-block h-3 w-2 animate-pulse bg-[var(--color-primary)] align-middle" />
            ) : null}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
