import Link from 'next/link';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';
import { StatusFilter } from './status-filter';

export const metadata = { title: 'admin · tickets' };
export const dynamic = 'force-dynamic';

interface AdminTicket {
  id: string;
  ticketNumber: string;
  status: string;
  topic: string;
  topicCode: string | null;
  name: string;
  email: string;
  subject: string;
  message: string;
  country: string | null;
  assignedTo: string | null;
  operatorNotes: string;
  createdAt: string;
  handledAt: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  no_response: 'no response',
  in_review: 'in review',
  replied: 'replied',
  closed: 'closed',
};

const VALID_STATUSES = ['no_response', 'in_review', 'replied', 'closed'] as const;

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'in_review':
      return 'border-[var(--color-warning)] text-[var(--color-warning)]';
    case 'replied':
      return 'border-[var(--color-primary)] text-[var(--color-primary)]';
    case 'closed':
      return 'border-[var(--color-border)] text-[var(--color-text-muted)]';
    default: // no_response
      return 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]';
  }
}

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const validStatus = VALID_STATUSES.includes(status as never) ? status : undefined;

  const qs = validStatus ? `?status=${validStatus}&limit=200` : '?limit=200';
  const { tickets } = await apiJson<{ tickets: AdminTicket[] }>(
    `/v1/admin/tickets${qs}`,
  ).catch(() => ({ tickets: [] as AdminTicket[] }));

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h2 className="font-mono text-lg tracking-tight">support tickets</h2>
        <p className="font-mono text-sm text-[var(--color-text-muted)]">
          incoming support tickets from the contact form. triage newest-first; change status as
          you review / reply / close. click a ticket to open the full thread.
        </p>
      </header>

      <StatusFilter current={validStatus} />

      {tickets.length === 0 ? (
        <p className="font-mono text-sm text-[var(--color-text-muted)]">
          no tickets
          {validStatus
            ? ` with status "${STATUS_LABELS[validStatus] ?? validStatus}"`
            : ' yet — the queue is clear.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tickets.map((t) => {
            const created = toValidDate(t.createdAt);
            return (
              <li key={t.id}>
                <Link
                  href={`/admin/tickets/${t.id}`}
                  className="flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusBadgeClass(t.status)}`}
                    >
                      {STATUS_LABELS[t.status] ?? t.status}
                    </span>
                    <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                      {t.topicCode ?? t.topic}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                      {t.name}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                      ·{' '}
                      {created
                        ? `${created.toISOString().slice(0, 16).replace('T', ' ')} utc`
                        : '—'}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-[var(--color-primary)]">
                      {t.ticketNumber}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-[var(--color-text)]">
                    {t.subject || '(no subject)'}
                  </p>
                  <p className="line-clamp-2 font-mono text-[10px] text-[var(--color-text-subtle)]">
                    {t.message}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
