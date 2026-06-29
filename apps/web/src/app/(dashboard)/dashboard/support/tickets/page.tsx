import Link from 'next/link';

import { apiJson } from '@/lib/api';
import { requireUser } from '@/lib/session';
import { toValidDate } from '@/lib/utils';

export const metadata = { title: 'my tickets' };
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
    default: // no_response
      return 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]';
  }
}

export default async function MyTicketsPage() {
  await requireUser();

  const { tickets } = await apiJson<{ tickets: UserTicket[] }>('/v1/me/tickets').catch(() => ({
    tickets: [] as UserTicket[],
  }));

  return (
    <div className="flex max-w-3xl flex-col gap-8 pb-12">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
            my tickets
          </h1>
          <Link
            href="/dashboard/support"
            className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            ← contact support
          </Link>
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">
          support tickets linked to your account. click one to see the full conversation.
        </p>
      </header>

      {tickets.length === 0 ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-8 text-center">
          <p className="font-mono text-sm text-[var(--color-text-muted)]">no tickets yet.</p>
          <Link
            href="/dashboard/support"
            className="mt-2 inline-block font-mono text-xs text-[var(--color-primary)] hover:underline"
          >
            contact support →
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {tickets.map((t) => {
            const created = toValidDate(t.createdAt);
            return (
              <li key={t.id}>
                <Link
                  href={`/dashboard/support/tickets/${encodeURIComponent(t.ticketNumber)}`}
                  className="flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 transition hover:border-[var(--color-border-strong)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusBadgeClass(t.status)}`}
                    >
                      {STATUS_LABELS[t.status] ?? t.status}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
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
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
