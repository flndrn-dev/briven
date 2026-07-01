import Image from 'next/image';
import Link from 'next/link';

const YEAR = new Date().getFullYear();

export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-24 border-t border-[var(--color-border-subtle)]">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-10 px-6 py-12 sm:grid-cols-3 md:grid-cols-5">
        <div className="col-span-2 flex flex-col gap-4 md:col-span-2">
          <div className="flex items-center gap-2">
            <Image src="/icon.svg" alt="" width={22} height={22} />
            <span className="font-mono text-sm text-[var(--color-text)]">briven</span>
            <span className="font-mono text-xs text-[var(--color-text-subtle)]">· tech</span>
          </div>
          <p className="max-w-sm font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
            the database anyone can use — no coding required. start from a template, edit like a
            spreadsheet, and undo any mistake. made in Flanders, independent.
          </p>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-[var(--color-text-subtle)]">
            <Link
              href="https://codeberg.org/flndrn/briven"
              className="hover:text-[var(--color-text-muted)]"
            >
              source
            </Link>
            <span aria-hidden>·</span>
            <Link href="/status" className="hover:text-[var(--color-text-muted)]">
              status
            </Link>
            <span aria-hidden>·</span>
            <Link
              href="https://docs.briven.tech/changelog/feed.xml"
              className="hover:text-[var(--color-text-muted)]"
            >
              rss
            </Link>
            <span aria-hidden>·</span>
            <WebDownLink>web down</WebDownLink>
            <span aria-hidden>·</span>
            <KatsuroLink>katsuro</KatsuroLink>
          </div>
        </div>

        <FooterColumn title="product">
          <FooterLink href="https://docs.briven.tech/quickstart">quickstart</FooterLink>
          <FooterLink href="https://docs.briven.tech/cli">cli</FooterLink>
          <FooterLink href="https://docs.briven.tech/sdks">sdks</FooterLink>
          <FooterLink href="https://docs.briven.tech/self-host">self-host</FooterLink>
          <FooterLink href="/dashboard">dashboard</FooterLink>
        </FooterColumn>

        <FooterColumn title="company">
          <FooterLink href="/customers">customers</FooterLink>
          <FooterLink href="/compare">compare</FooterLink>
          <FooterLink href="/status">status</FooterLink>
          <FooterLink href="https://docs.briven.tech/changelog">changelog</FooterLink>
          <FooterLink href="https://docs.briven.tech/roadmap">roadmap</FooterLink>
        </FooterColumn>

        <FooterColumn title="legal">
          <FooterLink href="/terms">terms</FooterLink>
          <FooterLink href="/privacy">privacy</FooterLink>
          <FooterLink href="/subprocessors">subprocessors</FooterLink>
          <FooterLink href="/trust">trust</FooterLink>
          <FooterLink href="https://docs.briven.tech/support">support</FooterLink>
        </FooterColumn>
      </div>

      <div className="border-t border-[var(--color-border-subtle)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2 px-6 py-6 text-center font-mono text-[10px] leading-relaxed text-[var(--color-text-subtle)] sm:flex-row sm:justify-between sm:gap-4 sm:text-left">
          {/* left */}
          <span className="whitespace-nowrap">
            © {YEAR} briven.tech · an{' '}
            <Link
              href="https://flndrn.com"
              className="text-[#f5d90a]/60 transition-colors hover:text-[#f5d90a]"
            >
              flndrn
            </Link>{' '}
            company
          </span>
          {/* center */}
          <span className="text-[var(--color-text-muted)]">
            100% self-funded, sustainable &amp; independent
          </span>
          {/* right */}
          <span className="whitespace-nowrap">flndrn Limited</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {title}
      </p>
      <ul className="flex flex-col gap-2 font-mono text-xs text-[var(--color-text-muted)]">
        {children}
      </ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="hover:text-[var(--color-text)]">
        {children}
      </Link>
    </li>
  );
}

/** Up-right external arrow (lucide arrow-up-right), inherits text color. */
function ExternalArrow({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

/** web-down.com link in the web-down brand blue, with the up-right arrow. */
export function WebDownLink({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href="https://web-down.com"
      className="inline-flex items-center gap-0.5 text-[#09a1d3] transition-colors hover:text-[#5dc0e0]"
    >
      {children}
      <ExternalArrow className="-translate-y-px" />
    </Link>
  );
}

/** katsuro.dev link in the Katsuro brand red, with the up-right arrow. */
export function KatsuroLink({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href="https://katsuro.dev"
      className="inline-flex items-center gap-0.5 text-[#ed1b23] transition-colors hover:text-[#f5575d]"
    >
      {children}
      <ExternalArrow className="-translate-y-px" />
    </Link>
  );
}
