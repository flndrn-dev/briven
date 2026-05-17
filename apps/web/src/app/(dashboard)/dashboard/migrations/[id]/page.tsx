import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError, apiJson } from '../../../../../lib/api';

export const metadata = { title: 'migration detail' };
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

interface TimelineEntry {
  id: string;
  action: string;
  createdAt: string;
  metadata: {
    source: string | null;
    statusChanged: boolean | null;
    messageIncluded: boolean | null;
    linkedUserId: boolean;
  };
}

const ACTION_LABEL: Record<string, string> = {
  'migration_request.create': 'request submitted from the dashboard wizard',
  'migration_request.public_create': 'request submitted via the public /migrate form',
  'admin.migration_request.update': 'briven team updated your request',
  'admin.migration_request.promote_to_user': 'linked to your briven account',
};

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

/** Ordered phases every migration passes through. */
const PHASES = [
  { key: 'new', label: 'Request submitted', idx: 1 },
  { key: 'contacted', label: 'Request reviewed', idx: 2 },
  { key: 'scheduled', label: 'Migration scheduled', idx: 3 },
  { key: 'in_progress', label: 'Migration in progress', idx: 4 },
  { key: 'completed', label: 'Migration completed', idx: 5 },
] as const;

const PHASE_ORDER: Record<string, number> = Object.fromEntries(
  PHASES.map((p) => [p.key, p.idx]),
);

function StepTimeline({
  status,
  timeline,
}: {
  status: string;
  timeline: TimelineEntry[];
}) {
  const currentIdx = PHASE_ORDER[status] ?? 0;
  const isCancelled = status === 'cancelled';

  // Phase timestamps: Phase 1 = request creation time.
  // Status-change entries carry `newStatus` (the API now serialises it).
  // Map newStatus → phase key directly instead of guessing sequentially.
  const phaseTimestamps: Record<string, string | null> = {};
  for (const entry of timeline) {
    if (
      entry.action === 'migration_request.public_create' ||
      entry.action === 'migration_request.create'
    ) {
      if (!phaseTimestamps['new']) phaseTimestamps['new'] = entry.createdAt;
    }
    if (entry.metadata.statusChanged && entry.metadata.newStatus) {
      phaseTimestamps[entry.metadata.newStatus] = entry.createdAt;
    }
  }
  // Fallback: if no explicit create entry exists, use the first entry.
  if (!phaseTimestamps['new'] && timeline.length > 0) {
    phaseTimestamps['new'] = timeline[0].createdAt;
  }

  return (
    <div className="mb-4 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      {isCancelled ? (
        <p className="font-mono text-sm text-[var(--color-text-subtle)]">
          This request was cancelled.
        </p>
      ) : (
        <div className="flex items-start gap-0">
          {PHASES.map((phase, i) => {
            const reached = currentIdx >= phase.idx;
            const isCurrent = currentIdx === phase.idx;
            const ts = phaseTimestamps[phase.key];

            return (
              <div key={phase.key} className="flex items-start gap-0 min-w-0 flex-1">
                <div className="flex flex-col items-center gap-1.5 min-w-0 w-full">
                  {/* Dot */}
                  <div
                    className={`z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-mono font-semibold ${
                      reached
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-text-inverse)]'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text-muted)]'
                    }`}
                  >
                    {reached ? '✓' : phase.idx}
                  </div>
                  {/* Label */}
                  <p
                    className={`text-center font-mono text-[10px] leading-tight ${
                      reached
                        ? 'text-[var(--color-text)]'
                        : 'text-[var(--color-text-subtle)]'
                    }`}
                  >
                    Phase {phase.idx}
                    <br />
                    {phase.label}
                  </p>
                  {/* Timestamp */}
                  {ts ? (
                    <p className="font-mono text-[8px] text-[var(--color-text-subtle)] leading-tight text-center">
                      {formatTime(ts)}
                    </p>
                  ) : isCurrent ? (
                    <p className="font-mono text-[8px] text-[var(--color-text-muted)] text-center italic">
                      processing…
                    </p>
                  ) : null}
                </div>
                {/* Connector line (except last) */}
                {i < PHASES.length - 1 && (
                  <div className="relative mt-3 h-0.5 w-full shrink-0">
                    <div
                      className={`h-full rounded-full ${
                        currentIdx > phase.idx
                          ? 'bg-[var(--color-primary)]'
                          : 'bg-[var(--color-border-subtle)]'
                      }`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default async function MigrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let data: { request: CustomerRequest; timeline: TimelineEntry[] };
  try {
    data = await apiJson<{ request: CustomerRequest; timeline: TimelineEntry[] }>(
      `/v1/migration-requests/${id}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const { request, timeline } = data;

  return (
    <section className="flex flex-col gap-6">
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        <Link href="/dashboard/migrations" className="hover:text-[var(--color-text)]">
          ← all migrations
        </Link>
      </p>

      <header className="flex flex-col gap-3">
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
            {request.id}
          </span>
        </div>
        <h1 className="font-mono text-xl tracking-tight">
          {request.source} → briven
        </h1>
        <p className="font-mono text-sm text-[var(--color-text-muted)]">
          {STATUS_BLURB[request.status] ?? 'in progress.'}
        </p>
      </header>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
        <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          what you submitted
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 font-mono text-xs text-[var(--color-text-muted)] sm:grid-cols-4">
          <div>
            <dt className="text-[var(--color-text-subtle)]">submitted</dt>
            <dd className="text-[var(--color-text)]">{formatTime(request.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-subtle)]">urgency</dt>
            <dd className="text-[var(--color-text)]">
              {request.urgency.replace(/_/g, ' ')}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-subtle)]">contact</dt>
            <dd className="text-[var(--color-text)]">{request.contactEmail}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-subtle)]">last update</dt>
            <dd className="text-[var(--color-text)]">{formatTime(request.updatedAt)}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-subtle)]">tables</dt>
            <dd className="text-[var(--color-text)]">{request.estimatedTables ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-subtle)]">rows</dt>
            <dd className="text-[var(--color-text)]">{request.estimatedRows ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-subtle)]">functions</dt>
            <dd className="text-[var(--color-text)]">
              {request.estimatedFunctions ?? '—'}
            </dd>
          </div>
          {request.sourceUrl ? (
            <div className="col-span-2 sm:col-span-2">
              <dt className="text-[var(--color-text-subtle)]">source URL</dt>
              <dd className="break-all text-[var(--color-text)]">
                <code>{request.sourceUrl}</code>
              </dd>
            </div>
          ) : null}
        </dl>
        {request.sourceNotes ? (
          <details className="mt-4 font-mono text-xs text-[var(--color-text-muted)]">
            <summary className="cursor-pointer">your notes at submission</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-3">
              {request.sourceNotes}
            </pre>
          </details>
        ) : null}
      </div>

      <div>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          migration steps
        </h2>
        <StepTimeline status={request.status} timeline={timeline} />
        {timeline.length === 0 ? (
          <p className="font-mono text-sm text-[var(--color-text-muted)]">
            no activity yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {timeline.map((entry) => (
              <li
                key={entry.id}
                className="flex gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
              >
                <span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm text-[var(--color-text)]">
                    {ACTION_LABEL[entry.action] ?? entry.action}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-subtle)]">
                    {formatTime(entry.createdAt)}
                    {entry.metadata.statusChanged
                      ? ' · status changed'
                      : ''}
                    {entry.metadata.messageIncluded
                      ? ' · message sent to your inbox'
                      : ''}
                    {entry.metadata.linkedUserId
                      ? ' · linked to this account'
                      : ''}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <p className="font-mono text-xs text-[var(--color-text-subtle)]">
        questions? reply to any email we sent, or write to{' '}
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
