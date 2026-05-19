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
    // Status-change entries carry the new status name so the timeline can
    // map directly into `phaseTimestamps` without guessing sequentially.
    // Optional because only `statusChanged` entries include it.
    newStatus?: string | null;
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

/** Compact one-line variant for the timeline — `May 17 · 08:29`. */
function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate().toString().padStart(2, '0');
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  return `${month} ${day} · ${hh}:${mm}`;
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
  const firstEntry = timeline[0];
  if (!phaseTimestamps['new'] && firstEntry) {
    phaseTimestamps['new'] = firstEntry.createdAt;
  }

  // Progress fill spans from dot-1 center to dot-N center. Cells are
  // even-width; dot centres sit at 10%, 30%, 50%, 70%, 90% for 5 phases.
  // Track therefore runs from 10% → 90%; fill from 10% to
  // (10% + (currentIdx - 1) / (PHASES.length - 1) * 80%).
  const segments = PHASES.length - 1;
  const cellCenterStart = 100 / (PHASES.length * 2);
  const trackStart = cellCenterStart;
  const trackEnd = 100 - cellCenterStart;
  const trackWidth = trackEnd - trackStart;
  const progressIdx = Math.max(0, Math.min(segments, currentIdx - 1));
  const fillWidth = (progressIdx / segments) * trackWidth;

  return (
    <div className="mb-4 rounded-lg border border-[var(--color-border-subtle)] bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-surface-raised)]/40 p-6">
      {isCancelled ? (
        <div className="flex items-center gap-2 font-mono text-sm text-[var(--color-text-subtle)]">
          <span
            className="inline-flex size-2 rounded-full bg-[var(--color-text-subtle)]"
            aria-hidden="true"
          />
          this request was cancelled.
        </div>
      ) : (
        <div className="relative">
          {/* Track: continuous behind the dots */}
          <div
            className="absolute top-4 h-px bg-[var(--color-border-subtle)]"
            style={{
              left: `${trackStart}%`,
              width: `${trackWidth}%`,
            }}
            aria-hidden="true"
          />
          {/* Track progress fill */}
          <div
            className="absolute top-4 h-px bg-[var(--color-primary)] transition-[width] duration-500"
            style={{
              left: `${trackStart}%`,
              width: `${fillWidth}%`,
            }}
            aria-hidden="true"
          />
          {/* Steps */}
          <ol
            className="relative grid"
            style={{ gridTemplateColumns: `repeat(${PHASES.length}, minmax(0, 1fr))` }}
          >
            {PHASES.map((phase) => {
              const reached = currentIdx >= phase.idx;
              const isCurrent = currentIdx === phase.idx;
              const ts = phaseTimestamps[phase.key];

              return (
                <li
                  key={phase.key}
                  className="flex flex-col items-center gap-2 px-1"
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {/* Dot */}
                  <div
                    className={`relative z-10 flex size-8 items-center justify-center rounded-full font-mono text-[11px] font-medium transition-colors ${
                      reached && !isCurrent
                        ? 'bg-[var(--color-primary)] text-[var(--color-text-inverse)] shadow-[0_0_0_4px_var(--color-bg)]'
                        : isCurrent
                          ? 'bg-[var(--color-bg)] text-[var(--color-primary)] shadow-[0_0_0_4px_var(--color-bg),0_0_0_5px_var(--color-primary),0_0_18px_var(--color-primary)/40]'
                          : 'bg-[var(--color-bg)] text-[var(--color-text-subtle)] shadow-[0_0_0_4px_var(--color-bg),inset_0_0_0_1px_var(--color-border)]'
                    }`}
                  >
                    {reached && !isCurrent ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="size-4"
                        aria-hidden="true"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : isCurrent ? (
                      <span
                        className="size-2 rounded-full bg-[var(--color-primary)]"
                        aria-hidden="true"
                      />
                    ) : (
                      phase.idx
                    )}
                  </div>

                  {/* Phase number eyebrow */}
                  <p
                    className={`font-mono text-[10px] uppercase tracking-wider ${
                      reached
                        ? 'text-[var(--color-text-muted)]'
                        : 'text-[var(--color-text-subtle)]'
                    }`}
                  >
                    phase {phase.idx}
                  </p>

                  {/* Label */}
                  <p
                    className={`text-center font-mono text-xs leading-tight ${
                      reached
                        ? 'text-[var(--color-text)]'
                        : 'text-[var(--color-text-subtle)]'
                    } ${isCurrent ? 'font-medium' : ''}`}
                  >
                    {phase.label.toLowerCase()}
                  </p>

                  {/* Timestamp / processing chip */}
                  {ts ? (
                    <span className="rounded-sm bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-subtle)]">
                      {formatTimeShort(ts)}
                    </span>
                  ) : isCurrent ? (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-primary)]">
                      <span
                        className="inline-flex size-1.5 animate-pulse rounded-full bg-[var(--color-primary)]"
                        aria-hidden="true"
                      />
                      in progress
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
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
