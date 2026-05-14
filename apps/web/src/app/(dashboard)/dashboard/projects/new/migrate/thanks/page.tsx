import Link from 'next/link';

import { apiJson } from '../../../../../../../lib/api';

export const metadata = { title: 'migration requested' };

interface RequestRow {
  id: string;
  source: string;
  status: string;
  createdAt: string;
}

export default async function MigrationThanksPage() {
  // Show the user's own most recent request so they have a record of
  // what they submitted, with the briven request id they can reference
  // if they email us.
  const { requests } = await apiJson<{ requests: RequestRow[] }>(
    '/v1/migration-requests',
  );
  const latest = requests[0];

  return (
    <section className="max-w-2xl">
      <div className="rounded-md border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] p-6">
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          got it · we&apos;ll be in touch within one business day
        </h1>
        <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
          your migration request is queued. an operator on our side will reach out at the
          email you gave us with the next steps. for the source you picked we typically
          schedule a 15-minute call to walk through the data + auth specifics, then we do
          the move while you keep running on your current platform.
        </p>
        {latest ? (
          <p className="mt-4 font-mono text-xs text-[var(--color-text-subtle)]">
            request id: <code className="text-[var(--color-text-muted)]">{latest.id}</code>{' '}
            · source: <code className="text-[var(--color-text-muted)]">{latest.source}</code>{' '}
            · status: <code className="text-[var(--color-text-muted)]">{latest.status}</code>
          </p>
        ) : null}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          while you wait
        </h2>
        <p className="font-mono text-sm text-[var(--color-text-muted)]">
          most users find it useful to create a small blank briven project to poke around
          the dashboard and studio — that way the cutover later feels familiar instead of
          foreign.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard/migrations"
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
          >
            track this migration
          </Link>
          <Link
            href="/dashboard/projects/new/blank"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 font-mono text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            create a blank project to explore
          </Link>
        </div>
      </div>

      <p className="mt-10 font-mono text-xs text-[var(--color-text-subtle)]">
        question we missed? email{' '}
        <a
          href="mailto:migrations@briven.tech"
          className="underline underline-offset-2 hover:text-[var(--color-text-muted)]"
        >
          migrations@briven.tech
        </a>{' '}
        and quote your request id.
      </p>
    </section>
  );
}
