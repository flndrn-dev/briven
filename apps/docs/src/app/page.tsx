import Link from 'next/link';

import { DocsShell } from '../components/shell';

export const metadata = {
  title: 'overview',
};

export default function DocsIndex() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">briven docs</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        doltgres-first reactive backend for typescript. git-for-your-data, hosted or self-hosted.
      </p>

      <div className="mt-6 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong className="text-[var(--color-text)]">engine.</strong> product SQL runs on{' '}
        <a className="underline" href="/doltgres">
          Doltgres
        </a>{' '}
        (Postgres wire + version history) — control plane and every project database. files use{' '}
        <a className="underline" href="/storage">
          MinIO S3
        </a>
        . sign-in uses{' '}
        <a className="underline" href="/auth">
          Briven Auth
        </a>
        .
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DocCard
          href="/quickstart"
          title="quickstart"
          body="briven setup (new) or connect (existing) → deploy."
        />
        <DocCard
          href="/connect"
          title="connect"
          body="cli, sdk, http, mcp — how your app and agents attach."
        />
        <DocCard href="/auth" title="auth" body="pk_briven_auth_…, @briven/auth, hosted sign-in." />
        <DocCard
          href="/storage"
          title="storage (s3)"
          body="per-project buckets, keys, media urls, soft-delete."
        />
        <DocCard
          href="/doltgres"
          title="doltgres"
          body="the engine under every project database."
        />
        <DocCard href="/cli" title="cli" body="setup, connect, deploy, auth scaffold, more." />
        <DocCard
          href="/schema"
          title="schema dsl"
          body="declare tables, columns, indexes in typescript."
        />
        <DocCard
          href="/functions"
          title="functions"
          body="query, mutation, action — typed db client and ctx."
        />
      </div>
    </DocsShell>
  );
}

function DocCard({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="block rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 transition hover:border-[var(--color-border)]"
    >
      <p className="font-mono text-sm">{title}</p>
      <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">{body}</p>
    </Link>
  );
}
