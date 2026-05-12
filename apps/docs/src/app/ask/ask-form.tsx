'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

interface AskResponse {
  question: string;
  answer: string;
  citations: { slug: string; title: string }[];
  model: string;
  elapsedMs: number;
}

interface NotConfiguredResponse {
  code: 'not_configured';
  message: string;
}

export function AskForm() {
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!question.trim()) return;
    setPending(true);
    setError(null);
    setResult(null);
    setNotConfigured(false);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
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
      const data = (await res.json()) as AskResponse;
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
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.currentTarget.value)}
          rows={3}
          maxLength={2000}
          required
          disabled={pending}
          placeholder="how do I make a query reactive? — what's the difference between query and action? — how do I migrate from prisma?"
          className="resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
        />
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            {question.length} / 2000
          </span>
          <button
            type="submit"
            disabled={pending || !question.trim()}
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
          >
            {pending ? 'thinking…' : 'ask'}
          </button>
        </div>
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
              <p className="text-[var(--color-text)]">ask is offline</p>
              <p className="mt-1">{error}</p>
              <p className="mt-2 text-[var(--color-text-subtle)]">
                in the meantime, try{' '}
                <Link href="/search" className="underline">
                  keyword search
                </Link>
                .
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
            answered by {result.model} in {result.elapsedMs}ms · grounded in{' '}
            {result.citations.length} page{result.citations.length === 1 ? '' : 's'}
          </p>
          <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-[var(--color-text)]">
            {result.answer}
          </div>
          {result.citations.length > 0 ? (
            <div className="mt-4 flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                citations
              </p>
              {result.citations.map((c) => (
                <Link
                  key={c.slug}
                  href={c.slug}
                  className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  {c.slug} — {c.title}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
