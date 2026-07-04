import Link from 'next/link';
import { notFound } from 'next/navigation';

import { LifeBuoyIcon } from '@/components/ui/life-buoy';
import { MailIcon } from '@/components/ui/mail';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { Section } from '../../_components/section';
import { MessageActions } from './message-actions';

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

export default async function AdminMessageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await apiJson<{ message: SerializedMessage; replies: Reply[] }>(
    `/v1/admin/contact-messages/${id}`,
  ).catch(() => null);

  if (!result) notFound();

  const { message, replies } = result;
  const created = toValidDate(message.createdAt);
  const handled = toValidDate(message.handledAt);

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <Link
        href="/admin/messages"
        className="font-mono text-xs text-[var(--color-text-muted)] transition hover:text-[var(--color-text)]"
      >
        ← inbox
      </Link>

      {/* header */}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[var(--color-primary)]">
            <MailIcon size={20} />
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusBadgeClass(message.status)}`}
          >
            {statusLabel(message.status)}
          </span>
          {message.isTicket && message.ticketNumber ? (
            <Link
              href="/admin/tickets"
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-primary)] transition-colors hover:border-[var(--color-primary)]"
            >
              <LifeBuoyIcon size={12} />
              ticket {message.ticketNumber}
            </Link>
          ) : (
            <span className="rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              plain message
            </span>
          )}
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            {created ? `${created.toISOString().slice(0, 16).replace('T', ' ')} utc` : '—'}
          </span>
        </div>
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          {message.subject || '(no subject)'}
        </h1>
        <div className="flex flex-wrap gap-4 font-mono text-[10px] text-[var(--color-text-subtle)]">
          <span>
            from: {message.name} · {message.email}
          </span>
          {message.country ? <span>country: {message.country}</span> : <span>country: —</span>}
          {message.topicCode ? (
            <span>topic: {message.topicCode}</span>
          ) : (
            <span>topic: {message.topic}</span>
          )}
          {handled ? (
            <span>handled: {handled.toISOString().slice(0, 16).replace('T', ' ')} utc</span>
          ) : null}
        </div>
      </header>

      {/* original message */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          message · from {message.name}
        </p>
        <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--color-text)]">
          {message.message}
        </pre>
      </div>

      {/* reply thread */}
      {replies.length > 0 ? (
        <Section
          title={`thread · ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
          icon={<MailIcon size={16} />}
        >
          <div className="flex flex-col gap-6">
            {replies.map((r) => {
              const rd = toValidDate(r.createdAt);
              return (
                <div
                  key={r.id}
                  className={`rounded-xl border p-6 ${
                    r.author === 'operator'
                      ? 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)]'
                      : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)]'
                  }`}
                >
                  <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                    {r.author === 'operator' ? 'operator' : 'user'} ·{' '}
                    {rd ? `${rd.toISOString().slice(0, 16).replace('T', ' ')} utc` : '—'}
                  </p>
                  <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--color-text)]">
                    {r.body}
                  </pre>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      {/* operator actions: reply + status */}
      <MessageActions
        message={{ id: message.id, status: message.status }}
        apiOrigin={publicApiOrigin()}
      />
    </div>
  );
}
