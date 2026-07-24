'use client';

import { useState } from 'react';

/**
 * Bulk import users into briven-engine (leave SuperTokens / Clerk).
 */
export function AuthMigrationClient({ projectId }: { projectId?: string }) {
  const [json, setJson] = useState(
    JSON.stringify(
      {
        users: [
          {
            email: 'alice@example.com',
            passwordPlaintext: 'ChangeMe!99',
            projectId: projectId ?? 'p_…',
            emailVerified: true,
            name: 'Alice',
          },
          {
            email: 'bob@example.com',
            passwordHash:
              '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
            hashingAlgorithm: 'bcrypt',
            projectId: projectId ?? 'p_…',
          },
        ],
      },
      null,
      2,
    ),
  );
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(): Promise<void> {
    setPending(true);
    setErr(null);
    setResult(null);
    try {
      const body = JSON.parse(json) as { users?: unknown[] };
      if (!Array.isArray(body.users)) throw new Error('JSON must have users: []');
      const res = await fetch('/api/v1/auth-core/migration/users', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        imported?: number;
        skipped?: number;
        failed?: number;
        errors?: Array<{ index: number; message: string }>;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(data.message ?? `http ${res.status}`);
      }
      setResult(
        `imported ${data.imported ?? 0} · skipped ${data.skipped ?? 0} · failed ${data.failed ?? 0}` +
          (data.errors?.length
            ? `\n` +
              data.errors
                .slice(0, 5)
                .map((e) => `#${e.index}: ${e.message}`)
                .join('\n')
            : ''),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'import failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="font-mono text-xs text-[var(--color-text-muted)] leading-relaxed">
        Paste users from SuperTokens, Clerk, or CSV-turned-JSON. Each row needs{' '}
        <code className="text-[var(--color-text)]">email</code> plus either{' '}
        <code className="text-[var(--color-text)]">passwordPlaintext</code> or a{' '}
        <code className="text-[var(--color-text)]">passwordHash</code> (bcrypt / argon2).
        Max 500 per request.
      </p>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={16}
        spellCheck={false}
        className="rounded-md border bg-[var(--color-surface)] px-3 py-2 font-mono text-[11px] text-[var(--color-text)]"
        style={{ borderColor: 'var(--auth-accent-border)' }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => void run()}
        className="self-start rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
        style={{ background: '#FFFD74' }}
      >
        {pending ? 'importing…' : 'import users'}
      </button>
      {result ? (
        <pre className="whitespace-pre-wrap font-mono text-xs text-[var(--color-text)]">
          {result}
        </pre>
      ) : null}
      {err ? (
        <p className="font-mono text-xs text-red-400">{err}</p>
      ) : null}
    </div>
  );
}
