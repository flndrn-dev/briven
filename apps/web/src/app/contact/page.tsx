import type { Metadata } from 'next';
import Link from 'next/link';

import { BackgroundGrid } from '../../components/marketing/background-grid';
import { ContactForm } from '../../components/marketing/contact-form';
import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteHeader } from '../../components/marketing/site-header';
import { TrackPageView } from '../../components/marketing/track-page-view';
import { detectCountry } from '../../lib/geo-country';
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

// Legend for the topic select — explains where each routing choice goes,
// without ever exposing an email address.
const SUPPORT_TOPICS: readonly { label: string; body: string }[] = [
  { label: 'general', body: 'anything that doesn’t fit a box below.' },
  { label: 'support', body: 'something broken or not working as expected.' },
  { label: 'sales', body: 'plans, pricing, limits and getting started.' },
  { label: 'security', body: 'vulnerabilities and responsible disclosure.' },
  { label: 'privacy', body: 'your data, access requests and deletion.' },
  { label: 'legal', body: 'terms, contracts and compliance questions.' },
];

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const [user, params, country] = await Promise.all([
    getSessionUser().catch(() => null),
    searchParams,
    detectCountry().catch(() => null),
  ]);
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <TrackPageView
        apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
        source="contact"
      />
      <BackgroundGrid />
      <SiteHeader user={user} />

      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24 pt-16 sm:pt-24">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-12">
          {/* LEFT — heading + subtitle + form */}
          <div>
            <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-primary)] text-[var(--text-xs)]">
              contact
            </p>
            <h1 className="mt-4 font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[var(--color-text)] text-[var(--text-display-3)] sm:text-[var(--text-display-2)]">
              get in touch.
            </h1>
            <p className="mt-6 max-w-xl leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
              questions about briven — support, sales, security or privacy? leave a message
              below and we&apos;ll get back to you within one business day. we reply privately
              to the address you give us. no signup required, no marketing emails.
            </p>

            <div className="mt-8">
              <ContactForm
                apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
                initialTopic={params.topic}
                initialCountry={country}
              />
            </div>
          </div>

          {/* RIGHT — Briven-styled sidebar cards */}
          <aside className="flex flex-col gap-4">
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
              <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
                contact
              </p>
              <p className="mt-3 font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h4)]">
                the form reaches us directly
              </p>
              <p className="mt-2 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
                there&apos;s no inbox to dig up — send the form and it lands straight with the
                briven team. we reply privately to the address you give us, usually within one
                business day. nothing you send is posted publicly.
              </p>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
              <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
                support topics
              </p>
              <ul className="mt-3 flex flex-col gap-2.5">
                {SUPPORT_TOPICS.map((t) => (
                  <li key={t.label} className="leading-[1.5]">
                    <span className="font-mono text-xs text-[var(--color-primary)]">
                      {t.label}
                    </span>{' '}
                    <span className="text-[var(--color-text-muted)] text-[var(--text-small)]">
                      — {t.body}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
              <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
                quick links
              </p>
              <p className="mt-2 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
                for a lot of questions you can get unblocked right now, without waiting on a reply.
              </p>
              <ul className="mt-4 flex flex-col gap-3">
                {HELP_LINKS.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="group flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-3 transition hover:border-[var(--color-border-strong)]"
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
            </div>
          </aside>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
