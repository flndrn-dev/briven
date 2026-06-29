import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiJson } from '@/lib/api';
import { requireUser } from '@/lib/session';
import { toValidDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface UserTicket {
  id: string;
  ticketNumber: string;
  status: string;
  topic: string;
  topicCode: string | null;
  subject: string;
  message: string;
  createdAt: string;
}

interface Reply {
  id: string;
  author: 'operator' | 'user';
  body: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  no_response: 'no response',
  in_review: 'in review',
  replied: 'replied',
  closed: 'closed',
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'in_review':
      return 'border-[var(--color-warning)] text-[var(--color-warning)]';
    case 'replied':
      return 'border-[var(--color-primary)] text-[var(--color-primary)]';
    case 'closed':
      return 'border-[var(--color-border)] text-[var(--color-text-muted)]';
    default:
      return 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]';
  }
}

export default async function UserTicketDetailPage({
  params,
}: {
  params: Promise<{ ticketNumber: string }>;
}) {
  await requireUser();
  const { ticketNumber } = await params;

  const result = await apiJson<{ ticket: UserTicket; replies: Reply[] }>(
    `/v1/me/tickets/${encodeURIComponent(ticketNumber)}`,
  ).catch(() => null);

  if (!result) notFound();

  const { ticket, replies } = result;
  const created = toValidDate(ticket.createdAt);

  return (
    <div className="flex max-w-3xl flex-col gap-6 pb-12">
      <Link
        href="/dashboard/support/tickets"
        className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        ← my tickets
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusBadgeClass(ticket.status)}`}
          >
            {STATUS_LABELS[ticket.status] ?? ticket.status}
          </span>
          <span className="font-mono text-sm text-[var(--color-primary)]">
            {ticket.ticketNumber}
          </span>
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            {created
              ? `${created.toISOString().slice(0, 16).replace('T', ' ')} utc`
              : '—'}
          </span>
        </div>
        <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">
          {ticket.subject || '(no subject)'}
        </h1>
      </header>

      {/* original message */}
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          your message
        </p>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-text)]">
          {ticket.message}
        </pre>
      </div>

      {/* reply thread */}
      {replies.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
            replies · {replies.length}
          </h2>
          {replies.map((r) => {
            const rd = toValidDate(r.createdAt);
            return (
              <div
                key={r.id}
                className={`rounded-md border px-4 py-3 ${
                  r.author === 'operator'
                    ? 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)]'
                    : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)]'
                }`}
              >
                <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  {r.author === 'operator' ? 'briven support' : 'you'} ·{' '}
                  {rd ? `${rd.toISOString().slice(0, 16).replace('T', ' ')} utc` : '—'}
                </p>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-text)]">
                  {r.body}
                </pre>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="font-mono text-sm text-[var(--color-text-muted)]">
          no replies yet — we&apos;ll get back to you within one business day.
        </p>
      )}
    </div>
  );
}
