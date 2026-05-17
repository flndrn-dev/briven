'use client';

import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiJson } from '../../../../../lib/api';

const ACTION_LABEL: Record<string, string> = {
  'migration_request.public_create': 'you submitted a migration request',
  'migration_request.create': 'migration request created',
  'migration_request.status_change': 'status updated',
  'admin.migration_request.send_update': 'the briven team sent you an update',
  'admin.migration_request.promote_to_user': 'linked to your briven account',
};

const STATUS_BLURB: Record<string, string> = {
  new: "queued — we'll be in touch within one business day.",
  contacted: "we've reached out — check your inbox.",
  scheduled: 'a migration window is scheduled.',
  in_progress: "we're moving your project right now.",
  completed: 'migration completed.',
  cancelled: 'request cancelled.',
};

const STEPS = [
  { key: 'new', label: 'Migration request submitted', idx: 1 },
  { key: 'contacted', label: 'Request reviewed by briven', idx: 2 },
  { key: 'scheduled', label: 'Migration window scheduled', idx: 3 },
  { key: 'in_progress', label: 'Migration in progress', idx: 4 },
  { key: 'completed', label: 'Migration completed', idx: 5 },
] as const;

const STEP_ORDER: Record<string, number> = Object.fromEntries(
  STEPS.map((s) => [s.key, s.idx]),
);

function statusTone(s: string): string {
  if (s === 'completed') return 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]';
  if (s === 'cancelled') return 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]';
  if (s === 'in_progress') return 'border-[var(--color-warning)] text-[var(--color-warning)]';
  return 'border-[var(--color-border)] text-[var(--color-text-muted)]';
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10) + ' at ' + d.toISOString().slice(11, 16) + ' utc';
}

function StepTimeline({
  status,
  timeline,
}: {
  status: string;
  timeline: Array<{
    id: string;
    action: string;
    createdAt: string;
    metadata: {
      source?: string | null;
      statusChanged?: boolean | null;
      messageIncluded?: boolean | null;
      linkedUserId?: boolean | null;
      newStatus?: string | null;
      previousStatus?: string | null;
    };
  }>;
}) {
  const currentIdx = STEP_ORDER[status] ?? 0;
  const isCancelled = status === 'cancelled';

  const stepTimestamps: Record<string, string | null> = {};
  for (const entry of timeline) {
    if (
      entry.action === 'migration_request.public_create' ||
      entry.action === 'migration_request.create'
    ) {
      if (!stepTimestamps['new']) stepTimestamps['new'] = entry.createdAt;
    }
    if (entry.metadata.statusChanged && entry.metadata.newStatus) {
      stepTimestamps[entry.metadata.newStatus] = entry.createdAt;
    }
  }
  if (!stepTimestamps['new'] && timeline.length > 0) {
    stepTimestamps['new'] = timeline[0].createdAt;
  }

  if (isCancelled) {
    return (
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <p className="font-mono text-sm text-[var(--color-text-subtle)]">This request was cancelled.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <ol>
        {STEPS.map((step, i) => {
          const done = currentIdx >= step.idx;
          const isCurrent = currentIdx === step.idx;
          const ts = stepTimestamps[step.key];

          return (
            <li key={step.key} className="relative flex gap-4 pb-8 last:pb-0">
              {i < STEPS.length - 1 ? (
                <div className="absolute left-[11px] top-7 bottom-0 w-0.5">
                  <div
                    className={`h-full w-full rounded-full ${
                      done ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border-subtle)]'
                    }`}
                  />
                </div>
              ) : null}

              <div className="relative z-10 shrink-0">
                {done ? (
                  <div className="flex size-6 items-center justify-center rounded-full bg-[var(--color-primary)]">
                    <svg className="size-3 text-[var(--color-text-inverse)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div
                    className={`flex size-6 items-center justify-center rounded-full border-2 ${
                      isCurrent
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)]'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-bg)]'
                    }`}
                  >
                    <span
                      className={`font-mono text-[10px] font-semibold ${
                        isCurrent ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'
                      }`}
                    >
                      {step.idx}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-0.5 min-w-0 pt-0.5">
                <p
                  className={`font-mono text-sm leading-snug ${
                    done ? 'text-[var(--color-text)]' : isCurrent ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'
                  }`}
                >
                  {step.label}
                </p>
                {done && ts ? (
                  <p className="font-mono text-[11px] text-[var(--color-primary)]">completed {fmt(ts)}</p>
                ) : isCurrent ? (
                  <p className="font-mono text-[11px] text-[var(--color-text-subtle)] italic">in progress...</p>
                ) : (
                  <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">waiting</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {status !== 'completed' && status !== 'cancelled' ? (
        <p className="mt-4 font-mono text-[10px] text-[var(--color-primary)] text-center">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] animate-pulse mr-1.5 align-middle" />
          updates in real time
        </p>
      ) : null}
    </div>
  );
}

const POLL_MS = 5000;

export default function MigrationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [request, setRequest] = useState<{
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
  } | null>(null);
  const [timeline, setTimeline] = useState<
    Array<{
      id: string;
      action: string;
      createdAt: string;
      metadata: {
        source?: string | null;
        statusChanged?: boolean | null;
        messageIncluded?: boolean | null;
        linkedUserId?: boolean | null;
        newStatus?: string | null;
        previousStatus?: string | null;
      };
    }>
  >([]);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await apiJson<{
        request: {
          id: string; source: string; sourceUrl: string | null; sourceNotes: string;
          estimatedTables: number | null; estimatedRows: string | null;
          estimatedFunctions: number | null; urgency: string; status: string;
          contactEmail: string; createdAt: string; updatedAt: string;
        };
        timeline: Array<{
          id: string; action: string; createdAt: string;
          metadata: {
            source?: string | null; statusChanged?: boolean | null;
            messageIncluded?: boolean | null; linkedUserId?: boolean | null;
            newStatus?: string | null; previousStatus?: string | null;
          };
        }>;
      }>(`/v1/migration-requests/${id}`);
      setRequest(data.request);
      setTimeline(data.timeline);
      setErrorStatus(null);
      return data.request.status;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
        setErrorStatus(404);
      }
      return null;
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (errorStatus === 404) return;
    if (!request) return;
    if (request.status === 'completed' || request.status === 'cancelled') return;
    pollRef.current = setInterval(() => { fetchData(); }, POLL_MS);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [request?.status, fetchData, errorStatus, request]);

  if (errorStatus === 404) notFound();

  if (!request) {
    return (
      <section className="flex flex-col gap-6">
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          <Link href="/dashboard/migrations" className="hover:text-[var(--color-text)]">&larr; all migrations</Link>
        </p>
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
          <p className="font-mono text-sm text-[var(--color-text-muted)] animate-pulse">loading migration details...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        <Link href="/dashboard/migrations" className="hover:text-[var(--color-text)]">&larr; all migrations</Link>
      </p>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusTone(request.status)}`}>
            {request.status.replace(/_/g, ' ')}
          </span>
          <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            {request.source}
          </span>
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">{request.id}</span>
        </div>
        <h1 className="font-mono text-xl tracking-tight">{request.source} &rarr; briven</h1>
        <p className="font-mono text-sm text-[var(--color-text-muted)]">{STATUS_BLURB[request.status] ?? 'in progress.'}</p>
      </header>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
        <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">what you submitted</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-4">
          <div><dt className="text-[var(--color-text-subtle)]">submitted</dt><dd className="text-[var(--color-text)]">{fmt(request.createdAt)}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">urgency</dt><dd className="text-[var(--color-text)]">{request.urgency.replace(/_/g, ' ')}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">contact</dt><dd className="text-[var(--color-text)]">{request.contactEmail}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">last update</dt><dd className="text-[var(--color-text)]">{fmt(request.updatedAt)}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">tables</dt><dd className="text-[var(--color-text)]">{request.estimatedTables ?? '\u2014'}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">rows</dt><dd className="text-[var(--color-text)]">{request.estimatedRows ?? '\u2014'}</dd></div>
          <div><dt className="text-[var(--color-text-subtle)]">functions</dt><dd className="text-[var(--color-text)]">{request.estimatedFunctions ?? '\u2014'}</dd></div>
          {request.sourceUrl ? (
            <div className="col-span-2 sm:col-span-2">
              <dt className="text-[var(--color-text-subtle)]">source URL</dt>
              <dd className="break-all text-[var(--color-text)]"><code>{request.sourceUrl}</code></dd>
            </div>
          ) : null}
        </dl>
        {request.sourceNotes ? (
          <details className="mt-4 font-mono text-xs text-[var(--color-text-muted)]">
            <summary className="cursor-pointer">your notes at submission</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-3">{request.sourceNotes}</pre>
          </details>
        ) : null}
      </div>

      <div>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">migration steps</h2>
        <StepTimeline status={request.status} timeline={timeline} />
        {timeline.length > 0 ? (
          <details className="mt-4">
            <summary className="font-mono text-xs text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text)]">
              audit log ({timeline.length} events)
            </summary>
            <ol className="mt-3 flex flex-col gap-2">
              {timeline.map((entry) => (
                <li key={entry.id} className="flex gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-[var(--color-text)]">{ACTION_LABEL[entry.action] ?? entry.action}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-subtle)]">
                      {fmt(entry.createdAt)}
                      {entry.metadata.statusChanged ? ' \u00b7 status changed' : ''}
                      {entry.metadata.messageIncluded ? ' \u00b7 message sent to your inbox' : ''}
                      {entry.metadata.linkedUserId ? ' \u00b7 linked to this account' : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>

      <p className="font-mono text-xs text-[var(--color-text-subtle)]">
        questions? reply to any email we sent, or write to{' '}
        <a href="mailto:migrations@flndrn.com" className="underline underline-offset-2 hover:text-[var(--color-text-muted)]">migrations@flndrn.com</a>{' '}
        and quote the request id.
      </p>
    </section>
  );
}
