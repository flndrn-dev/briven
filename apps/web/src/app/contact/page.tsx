import type { Metadata } from 'next';
import Link from 'next/link';

import { BackgroundGrid } from '../../components/marketing/background-grid';
import { ContactForm } from '../../components/marketing/contact-form';
import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteHeader } from '../../components/marketing/site-header';
import { TrackPageView } from '../../components/marketing/track-page-view';
import { getSessionUser } from '../../lib/session';

export const metadata: Metadata = {
  title: 'contact briven — get in touch',
  description:
    'questions about briven, support, sales, security or privacy? send us a message and we’ll get back to you within one business day. no signup needed.',
};

interface HelpLink {
  href: string;
  title: string;
  body: string;
}

// Non-email self-serve routes. Some folks get unblocked faster here than
// by waiting on a reply — keep this in sync with the footer + docs.
const HELP_LINKS: readonly HelpLink[] = [
  {
    href: 'https://docs.briven.tech/support',
    title: 'docs & support',
    body: 'guides, troubleshooting and the support handbook — the fastest path for most questions.',
  },
  {
    href: 'https://codeberg.org/flndrn/briven',
    title: 'source & issues',
    body: 'briven is open. read the code, file a bug, or follow along with what we’re building.',
  },
  {
    href: '/status',
    title: 'system status',
    body: 'checking whether something’s down? the live status page shows current uptime and incidents.',
  },
];

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const [user, params] = await Promise.all([
    getSessionUser().catch(() => null),
    searchParams,
  ]);
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <TrackPageView
        apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
        source="contact"
      />
      <BackgroundGrid />
      <SiteHeader user={user} />

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-12 pt-16 sm:pt-24">
        <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-primary)] text-[var(--text-xs)]">
          contact
        </p>
        <h1 className="mt-4 font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[var(--color-text)] text-[var(--text-display-3)] sm:text-[var(--text-display-2)]">
          get in touch.
        </h1>
        <p className="mt-6 max-w-2xl leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
          questions about briven — support, sales, security or privacy? leave a message
          below and we&apos;ll get back to you within one business day. we reply privately
          to the address you give us. no signup required, no marketing emails.
        </p>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16">
        <ContactForm
          apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
          initialTopic={params.topic}
        />
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-24">
        <h2 className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
          might be quicker
        </h2>
        <p className="mt-2 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
          for a lot of questions you can get unblocked right now, without waiting on a reply.
        </p>
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {HELP_LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="group flex h-full flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 transition hover:border-[var(--color-border-strong)]"
              >
                <p className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h4)]">
                  {l.title}
                </p>
                <p className="leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
                  {l.body}
                </p>
                <span className="mt-auto font-mono text-xs text-[var(--color-text-link)] group-hover:underline">
                  open →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <SiteFooter />
    </main>
  );
}
