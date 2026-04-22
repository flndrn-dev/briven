import Link from 'next/link';

import { DocsShell } from '../components/shell.js';

export const metadata = {
  title: 'overview',
};

export default function DocsIndex() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">briven docs</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        open-core reactive postgres for typescript developers. fully self-hostable.
      </p>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DocCard
          href="/quickstart"
          title="quickstart"
          body="from nothing to deployed in five minutes."
        />
        <DocCard
          href="/cli"
          title="cli"
          body="every command, flag, and env var."
        />
        <DocCard
          href="/schema"
          title="schema dsl"
          body="declare tables and migrations in typescript."
        />
        <DocCard
          href="/self-host"
          title="self-host"
          body="dokploy, coolify, bare postgres. your call."
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
