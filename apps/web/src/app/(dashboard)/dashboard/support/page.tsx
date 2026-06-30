import Link from 'next/link';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { ContactForm } from '../../../../components/marketing/contact-form';
import { detectCountry } from '../../../../lib/geo-country';
import { requireUser } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

interface HelpLink {
  href: string;
  title: string;
  body: string;
}

interface UserTicket {
  id: string;
  ticketNumber: string;
  status: string;
  subject: string;
  createdAt: string;
}

const TICKET_STATUS_LABELS: Record<string, string> = {
  no_response: 'no response',
  in_review: 'in review',
  replied: 'new reply',
  closed: 'closed',
};

function ticketStatusBadgeClass(status: string): string {
  switch (status) {
    case 'in_review':
      return 'border-[var(--color-warning)] text-[var(--color-warning)]';
    case 'replied':
      return 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]';
    case 'closed':
      return 'border-[var(--color-border)] text-[var(--color-text-muted)]';
    default: // no_response
      return 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]';
  }
}

// Non-email self-serve routes — same set as the public /contact page.
// Some folks get unblocked faster here than by waiting on a reply.
const HELP_LINKS: readonly HelpLink[] = [
  {
    href: 'https://docs.briven.tech/support',
    title: 'docs & support',
    body: 'guides, troubleshooting and the support handbook — the fastest path for most questions.',
  },
  {
    href: 'https://github.com/flndrn-dev/briven',
    title: 'source & issues',
    body: 'briven is open. read the code, file a bug, or follow along with what we’re building.',
  },
  {
    href: 'https://docs.briven.tech/status',
    title: 'system status',
    body: 'checking whether something’s down? the live status page shows current uptime and incidents.',
  },
];

export default async function SupportPage() {
  const [user, country, ticketsResult] = await Promise.all([
    requireUser(),
    detectCountry().catch(() => null),
    apiJson<{ tickets: UserTicket[] }>('/v1/me/tickets').catch(() => ({
      tickets: [] as UserTicket[],
    })),
  ]);

  const tickets = ticketsResult.tickets;
  const replyCount = tickets.filter((t) => t.status === 'replied').length;

  return (
    <div className="flex max-w-3xl flex-col gap-8 pb-12">
      <header>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text)]">
            contact support
          </h1>
          <Link
            href="/dashboard/support/tickets"
            className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            my tickets →
          </Link>
        </div>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          something broken, or just a question? send us a message — we reply right here in your
          tickets and to your account email, usually within one business day. no marketing emails,
          ever.
        </p>
      </header>

      {/* Your tickets — surfaced here so a reply is visible in the support
          section itself, not only in the inbox. A 'replied' ticket means a new
          response is waiting; click through to read the full conversation. */}
      {tickets.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-mono text-sm text-[var(--color-text)]">your tickets</h2>
            {replyCount > 0 ? (
              <span className="font-mono text-xs text-[var(--color-primary)]">
                {replyCount} new repl{replyCount === 1 ? 'y' : 'ies'} waiting
              </span>
            ) : null}
          </div>
          <ul className="flex flex-col gap-2">
            {tickets.map((t) => {
              const created = toValidDate(t.createdAt);
              return (
                <li key={t.id}>
                  <Link
                    // '#' is display-only; a '#' in a URL is the fragment marker and 404s the thread.
                    href={`/dashboard/support/tickets/${encodeURIComponent(t.ticketNumber.replace(/^#/, ''))}`}
                    className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-2.5 transition hover:border-[var(--color-border-strong)]"
                  >
                    <span
                      className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${ticketStatusBadgeClass(t.status)}`}
                    >
                      {TICKET_STATUS_LABELS[t.status] ?? t.status}
                    </span>
                    <span className="truncate font-mono text-xs text-[var(--color-text)]">
                      {t.subject || '(no subject)'}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--color-text-subtle)]">
                      {t.ticketNumber}
                      {created ? ` · ${created.toISOString().slice(0, 10)}` : ''}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section>
        <ContactForm
          apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
          initialTopic="support"
          initialCountry={country}
          initialName={user.name ?? ''}
          initialEmail={user.email}
        />
      </section>

      <section>
        <h2 className="font-mono text-sm text-[var(--color-text)]">quick links</h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          for a lot of questions you can get unblocked right now, without waiting on a reply.
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {HELP_LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="group flex h-full flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 transition hover:border-[var(--color-border-strong)]"
              >
                <span className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-small)]">
                  {l.title}
                </span>
                <span className="leading-[1.5] text-[var(--color-text-muted)] text-xs">
                  {l.body}
                </span>
                <span className="mt-1 font-mono text-xs text-[var(--color-text-link)] group-hover:underline">
                  open →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
