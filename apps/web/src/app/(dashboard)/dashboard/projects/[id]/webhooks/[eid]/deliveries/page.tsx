import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiJson } from '../../../../../../../../lib/api';
import { toValidDate } from '@/lib/utils';

type DeliveryStatus =
  | 'ok'
  | 'rejected_signature'
  | 'rejected_replay'
  | 'invoke_error'
  | 'disabled';

interface Endpoint {
  id: string;
  name: string;
  functionName: string;
  enabled: boolean;
}

interface Delivery {
  id: string;
  status: DeliveryStatus;
  functionName: string | null;
  durationMs: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export const dynamic = 'force-dynamic';

const FILTERS: { label: string; value: DeliveryStatus | '' }[] = [
  { label: 'all', value: '' },
  { label: 'ok', value: 'ok' },
  { label: 'signature rejected', value: 'rejected_signature' },
  { label: 'replay rejected', value: 'rejected_replay' },
  { label: 'function error', value: 'invoke_error' },
  { label: 'disabled', value: 'disabled' },
];

const VALID_FILTERS = new Set<string>(
  FILTERS.map((f) => f.value).filter((v): v is DeliveryStatus => v !== ''),
);

export default async function DeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; eid: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id, eid } = await params;
  const { status: statusParam } = await searchParams;
  const status = statusParam && VALID_FILTERS.has(statusParam) ? statusParam : '';
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';

  // Fan-out: deliveries list + endpoint detail (we filter the list of all
  // endpoints client-side since there's no per-endpoint GET route).
  const [endpointsResult, deliveriesResult] = await Promise.all([
    apiJson<{ endpoints: Endpoint[] }>(`/v1/projects/${id}/webhooks`).catch(() => ({
      endpoints: [] as Endpoint[],
    })),
    apiJson<{ deliveries: Delivery[] }>(
      `/v1/projects/${id}/webhooks/${eid}/deliveries${qs}`,
    ).catch(() => ({ deliveries: [] as Delivery[] })),
  ]);

  const endpoint = endpointsResult.endpoints.find((e) => e.id === eid);
  if (!endpoint) notFound();

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
          {endpoint.name} · deliveries
        </h2>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          every inbound POST is logged here — accepted, rejected, errored. showing the latest 100
          rows{status ? ` matching ${status.replace('_', ' ')}` : ''}.
        </p>
      </header>

      <nav className="flex flex-wrap gap-1">
        {FILTERS.map((f) => {
          const active = (status ?? '') === f.value;
          const href =
            f.value === ''
              ? `/dashboard/projects/${id}/webhooks/${eid}/deliveries`
              : `/dashboard/projects/${id}/webhooks/${eid}/deliveries?status=${encodeURIComponent(f.value)}`;
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
                  <span className="font-mono text-xs text-[var(--color-text)]">
                    {d.functionName ?? endpoint.functionName}
                  </span>
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
    ok: 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]',
    rejected_signature: 'border-[var(--color-warning)] text-[var(--color-warning)]',
    rejected_replay: 'border-[var(--color-warning)] text-[var(--color-warning)]',
    invoke_error: 'border-[var(--color-error)] text-[var(--color-error)]',
    disabled: 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]',
  };
  const labels: Record<DeliveryStatus, string> = {
    ok: 'ok',
    rejected_signature: 'sig rejected',
    rejected_replay: 'replay rejected',
    invoke_error: 'fn error',
    disabled: 'disabled',
  };
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  const d = toValidDate(iso);
  return d ? d.toISOString().replace('T', ' ').slice(0, 19) + ' utc' : '—';
}
