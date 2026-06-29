import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';
import { TicketActions } from './ticket-actions';

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

interface Reply {
  id: string;
  author: 'operator' | 'user';
  body: string;
  createdAt: string;
}

function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

function statusLabel(s: string): string {
  switch (s) {
    case 'no_response':
      return 'no response';
    case 'in_review':
      return 'in review';
    case 'replied':
      return 'replied';
    case 'closed':
      return 'closed';
    default:
      return s;
  }
}

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

export default async function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await apiJson<{ ticket: AdminTicket; replies: Reply[] }>(
    `/v1/admin/tickets/${id}`,
  ).catch(() => null);

  if (!result) notFound();

  const { ticket, replies } = result;
  const created = toValidDate(ticket.createdAt);
  const handled = toValidDate(ticket.handledAt);

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <Link
        href="/admin/tickets"
        className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        ← tickets
      </Link>

      {/* header */}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusBadgeClass(ticket.status)}`}
          >
            {statusLabel(ticket.status)}
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
        <h2 className="font-mono text-base tracking-tight text-[var(--color-text)]">
          {ticket.subject || '(no subject)'}
        </h2>
        <div className="flex flex-wrap gap-4 font-mono text-[10px] text-[var(--color-text-subtle)]">
          <span>
            from: {ticket.name} · {ticket.email}
          </span>
          {ticket.country ? <span>country: {ticket.country}</span> : null}
          {ticket.topicCode ? <span>topic: {ticket.topicCode}</span> : null}
          {handled ? (
            <span>
              handled: {handled.toISOString().slice(0, 16).replace('T', ' ')} utc
            </span>
          ) : null}
        </div>
      </header>

      {/* original message */}
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          message · from {ticket.name}
        </p>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-text)]">
          {ticket.message}
        </pre>
      </div>

      {/* reply thread */}
      {replies.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
            thread · {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </h3>
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
                  {r.author === 'operator' ? 'operator' : 'user'} ·{' '}
                  {rd ? `${rd.toISOString().slice(0, 16).replace('T', ' ')} utc` : '—'}
                </p>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-text)]">
                  {r.body}
                </pre>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* operator actions: status, assignedTo, operatorNotes, reply */}
      <TicketActions
        ticket={{
          id: ticket.id,
          status: ticket.status,
          assignedTo: ticket.assignedTo,
          operatorNotes: ticket.operatorNotes,
        }}
        apiOrigin={publicApiOrigin()}
      />
    </section>
  );
}
