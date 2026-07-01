import Link from 'next/link';

import { apiJson } from '../../../../lib/api';
import { RowDeleteMigrationButton } from './row-delete-migration-button';

export const metadata = { title: 'my migrations' };
export const dynamic = 'force-dynamic';

interface CustomerRequest {
  id: string;
  source: string;
  sourceUrl: string | null;
  sourceNotes: string;
  estimatedTables: number | null;
  estimatedRows: string | null;
  estimatedFunctions: number | null;
  urgency: string;
  status: string;
  contactEmail: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_BLURB: Record<string, string> = {
  new: 'queued — we’ll be in touch within one business day.',
  contacted: 'we’ve reached out — check your inbox.',
  scheduled: 'a migration window is scheduled.',
  in_progress: 'we’re moving your project right now.',
  completed: 'migration completed.',
  cancelled: 'request cancelled.',
};

function statusTone(status: string): string {
  if (status === 'completed') {
    return 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]';
  }
  if (status === 'cancelled') {
    return 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]';
  }
  if (status === 'in_progress') {
    return 'border-[var(--color-warning)] text-[var(--color-warning)]';
  }
  return 'border-[var(--color-border)] text-[var(--color-text-muted)]';
}

function formatTime(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' utc';
}

export default async function MyMigrationsPage() {
  const { requests } = await apiJson<{ requests: CustomerRequest[] }>(
    '/v1/migration-requests',
  );

  const open = requests.filter(
    (r) => r.status !== 'completed' && r.status !== 'cancelled',
  );
  const closed = requests.filter(
    (r) => r.status === 'completed' || r.status === 'cancelled',
  );

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="font-mono text-xl tracking-tight">my migrations</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          every migration request you’ve submitted. status updates from us land here as we
          progress through the move. for now you’ll also get email updates at the contact
          address on each request.
        </p>
      </header>

      {requests.length === 0 ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
          <p className="font-mono text-sm text-[var(--color-text)]">
            no migration requests yet.
          </p>
          <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
            coming from convex, supabase, firebase or somewhere else? start the wizard and
            we’ll handle the move for free during beta.
          </p>
          <Link
            href="/dashboard/projects/new"
            className="mt-4 inline-flex rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)]"
          >
            start a migration
          </Link>
        </div>
      ) : (
        <>
          {open.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
                open · {open.length}
              </h2>
              {open.map((r) => (
                <RequestCard key={r.id} request={r} />
              ))}
            </div>
          ) : null}

          {closed.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
                done · {closed.length}
              </h2>
              {closed.map((r) => (
                <RequestCard key={r.id} request={r} />
              ))}
            </div>
          ) : null}
        </>
      )}

      <p className="mt-4 font-mono text-xs text-[var(--color-text-subtle)]">
        question about an in-flight migration? email{' '}
        <a
          href="mailto:migrations@flndrn.com"
          className="underline underline-offset-2 hover:text-[var(--color-text-muted)]"
        >
          migrations@flndrn.com
        </a>{' '}
        and quote the request id.
      </p>
    </section>
  );
}

function RequestCard({ request }: { request: CustomerRequest }) {
  return (
    <article className="group flex flex-col gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 transition hover:border-[var(--color-border-strong)]">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusTone(request.status)}`}
        >
          {request.status.replace(/_/g, ' ')}
        </span>
        <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          {request.source}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          submitted {formatTime(request.createdAt)}
        </span>
        <Link
          href={`/dashboard/migrations/${request.id}`}
          className="ml-auto font-mono text-[10px] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] group-hover:text-[var(--color-text-muted)]"
        >
          {request.id} →
        </Link>
        <RowDeleteMigrationButton requestId={request.id} />
      </div>

      <p className="font-mono text-sm text-[var(--color-text)]">
        {STATUS_BLURB[request.status] ?? 'in progress.'}
      </p>

      <div className="flex flex-wrap gap-4 font-mono text-[10px] text-[var(--color-text-subtle)]">
        <span>urgency: {request.urgency.replace(/_/g, ' ')}</span>
        <span>tables: {request.estimatedTables ?? '—'}</span>
        <span>rows: {request.estimatedRows ?? '—'}</span>
        <span>functions: {request.estimatedFunctions ?? '—'}</span>
        <span>contact: {request.contactEmail}</span>
      </div>

      {request.sourceUrl ? (
        <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
          source URL: <code>{request.sourceUrl}</code>
        </p>
      ) : null}

      {request.sourceNotes ? (
        <details className="font-mono text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer">your notes</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words">{request.sourceNotes}</pre>
        </details>
      ) : null}
    </article>
  );
}
