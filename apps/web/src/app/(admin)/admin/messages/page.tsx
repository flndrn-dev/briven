import Link from 'next/link';

import { LifeBuoyIcon } from '@/components/ui/life-buoy';
import { MailIcon } from '@/components/ui/mail';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { StatCard } from '../_components/stat-card';
import { MessageFilter } from './message-filter';

export const metadata = { title: 'admin · messages' };
export const dynamic = 'force-dynamic';

interface SerializedMessage {
  id: string;
  ticketNumber: string | null;
  isTicket: boolean;
  status: string;
  topic: string;
  topicCode: string | null;
  name: string;
  email: string;
  subject: string | null;
  message: string;
  country: string | null;
  assignedTo: string | null;
  operatorNotes: string | null;
  createdAt: string;
  handledAt: string | null;
}

const VALID_FILTERS = ['all', 'plain', 'tickets'] as const;
type Filter = (typeof VALID_FILTERS)[number];

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

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const validFilter: Filter = VALID_FILTERS.includes(filter as never)
    ? (filter as Filter)
    : 'all';

  const { messages } = await apiJson<{ messages: SerializedMessage[] }>(
    `/v1/admin/contact-messages?filter=${validFilter}`,
  ).catch(() => ({ messages: [] as SerializedMessage[] }));

  const total = messages.length;
  const ticketCount = messages.filter((m) => m.isTicket).length;
  const plainCount = total - ticketCount;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <MailIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">messages</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          every message from the contact form — tagged ones are also tracked as tickets; plain
          ones live only here.
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-3">
        <StatCard
          label={validFilter === 'all' ? 'total messages' : `messages · ${validFilter}`}
          value={total}
          icon={<MailIcon size={16} />}
          hint="in the current view"
        />
        <StatCard
          label="plain (no ticket)"
          value={plainCount}
          hint="live only in the inbox"
        />
        <StatCard
          label="tickets"
          value={ticketCount}
          tone="primary"
          icon={<LifeBuoyIcon size={16} />}
          hint="also tracked as support tickets"
        />
      </div>

      <MessageFilter current={validFilter} />

      <Section title={`inbox · ${total}`} icon={<MailIcon size={16} />}>
        {total === 0 ? (
          <EmptyState
            icon={<MailIcon size={28} />}
            title="inbox is clear"
            message={
              validFilter === 'all'
                ? 'new contact-form submissions land here the moment they arrive.'
                : 'nothing under this filter — try "all" for the full inbox.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-6">
            {messages.map((m) => {
              const created = toValidDate(m.createdAt);
              return (
                <li key={m.id}>
                  <Link
                    href={`/admin/messages/${m.id}`}
                    className="flex flex-col gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 transition-colors hover:border-[var(--color-border-strong)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusBadgeClass(m.status)}`}
                      >
                        {STATUS_LABELS[m.status] ?? m.status}
                      </span>
                      <span className="rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                        {m.topicCode ?? m.topic}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                        {m.name}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                        · {m.email}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                        ·{' '}
                        {created
                          ? `${created.toISOString().slice(0, 16).replace('T', ' ')} utc`
                          : '—'}
                      </span>
                      {m.isTicket && m.ticketNumber ? (
                        <span className="ml-auto rounded-full border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-primary)]">
                          ticket {m.ticketNumber}
                        </span>
                      ) : (
                        <span className="ml-auto rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                          plain message
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-sm text-[var(--color-text)]">
                      {m.subject || '(no subject)'}
                    </p>
                    <p className="line-clamp-2 font-mono text-[11px] text-[var(--color-text-subtle)]">
                      {m.message}
                    </p>
                    {m.country ? (
                      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                        country: {m.country}
                      </p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
