import Link from 'next/link';

import { ContactForm } from '../../../../components/marketing/contact-form';
import { detectCountry } from '../../../../lib/geo-country';
import { requireUser } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

interface HelpLink {
  href: string;
  title: string;
  body: string;
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
    href: 'https://codeberg.org/flndrn/briven',
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
  const [user, country] = await Promise.all([
    requireUser(),
    detectCountry().catch(() => null),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-8 pb-12">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text)]">
          contact support
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          something broken, or just a question? send us a message — we reply privately to your
          account email, usually within one business day. no marketing emails, ever.
        </p>
      </header>

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
