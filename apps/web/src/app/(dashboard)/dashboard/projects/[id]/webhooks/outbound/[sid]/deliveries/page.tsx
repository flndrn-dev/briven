import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiJson } from '../../../../../../../../../lib/api';
import { toValidDate } from '@/lib/utils';

type DeliveryStatus = 'pending' | 'ok' | 'failed' | 'cancelled';

interface Subscriber {
  id: string;
  name: string;
  targetUrl: string;
  eventTypes: string;
  enabled: boolean;
}

interface Delivery {
  id: string;
  eventId: string;
  eventType: string;
  status: DeliveryStatus;
  attemptCount: string;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  statusCode: string | null;
  durationMs: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export const dynamic = 'force-dynamic';

const FILTERS: { label: string; value: DeliveryStatus | '' }[] = [
  { label: 'all', value: '' },
  { label: 'pending', value: 'pending' },
  { label: 'ok', value: 'ok' },
  { label: 'failed', value: 'failed' },
  { label: 'cancelled', value: 'cancelled' },
];

const VALID_FILTERS = new Set<string>(
  FILTERS.map((f) => f.value).filter((v): v is DeliveryStatus => v !== ''),
);

export default async function OutboundDeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sid: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id, sid } = await params;
  const { status: statusParam } = await searchParams;
  const status = statusParam && VALID_FILTERS.has(statusParam) ? statusParam : '';
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';

  const [subsResult, deliveriesResult] = await Promise.all([
    apiJson<{ subscribers: Subscriber[] }>(`/v1/projects/${id}/outbound-webhooks`).catch(() => ({
      subscribers: [] as Subscriber[],
    })),
    apiJson<{ deliveries: Delivery[] }>(
      `/v1/projects/${id}/outbound-webhooks/${sid}/deliveries${qs}`,
    ).catch(() => ({ deliveries: [] as Delivery[] })),
  ]);

  const subscriber = subsResult.subscribers.find((s) => s.id === sid);
  if (!subscriber) notFound();

  const deliveries = deliveriesResult.deliveries;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href={`/dashboard/projects/${id}/webhooks`}
          className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          ← all webhooks
        </Link>
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          {subscriber.name} · outbound deliveries
        </h2>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          briven POSTs to <code>{subscriber.targetUrl}</code> on every matching event. failures
          retry with exponential backoff up to 5 attempts. showing the latest 100 rows
          {status ? ` matching ${status}` : ''}.
        </p>
      </header>

      <nav className="flex flex-wrap gap-1">
        {FILTERS.map((f) => {
          const active = (status ?? '') === f.value;
          const href =
            f.value === ''
              ? `/dashboard/projects/${id}/webhooks/outbound/${sid}/deliveries`
              : `/dashboard/projects/${id}/webhooks/outbound/${sid}/deliveries?status=${encodeURIComponent(f.value)}`;
          return (
            <Link
              key={f.value || 'all'}
              href={href}
              className={`rounded-md border px-2 py-0.5 font-mono text-[10px] ${
                active
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {deliveries.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
          no deliveries{status ? ` with status ${status}` : ''} yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
          {deliveries.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <StatusPill status={d.status} />
                  <span className="font-mono text-xs text-[var(--color-text)]">{d.eventType}</span>
                  <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                    · attempt {d.attemptCount}/5
                  </span>
                  {d.statusCode ? (
                    <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                      · http {d.statusCode}
                    </span>
                  ) : null}
                  {d.durationMs ? (
                    <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                      · {d.durationMs}ms
                    </span>
                  ) : null}
                </div>
                <time
                  className="font-mono text-[10px] text-[var(--color-text-subtle)]"
                  dateTime={d.createdAt}
                >
                  {formatTimestamp(d.createdAt)}
                </time>
              </div>
              <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                event id: <code>{d.eventId}</code>
                {d.status === 'pending' ? (
                  <span className="ml-2">
                    · next attempt {formatTimestamp(d.nextAttemptAt)}
                  </span>
                ) : null}
              </p>
              {d.errorMessage ? (
                <pre className="overflow-x-auto rounded-md bg-[var(--color-code-bg)] px-3 py-2 font-mono text-[10px] text-[var(--color-code-text)]">
                  {d.errorMessage}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: DeliveryStatus }) {
  const styles: Record<DeliveryStatus, string> = {
    pending: 'border-[var(--color-warning)] text-[var(--color-warning)]',
    ok: 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]',
    failed: 'border-[var(--color-error)] text-[var(--color-error)]',
    cancelled: 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]',
  };
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  const d = toValidDate(iso);
  return d ? d.toISOString().replace('T', ' ').slice(0, 19) + ' utc' : '—';
}
