import Image from 'next/image';
import Link from 'next/link';

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
            open-core reactive postgres backend for typescript. self-host the engine, or use the
            hosted control plane on briven.tech.
          </p>
          <div className="flex items-center gap-3 font-mono text-[10px] text-[var(--color-text-subtle)]">
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
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-2 px-6 py-4 font-mono text-[10px] text-[var(--color-text-subtle)] sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span>© {new Date().getFullYear()} flndrn Limited, Limassol, Cyprus</span>
            <span className="hidden sm:inline" aria-hidden>
              ·
            </span>
            <span>agpl-3.0 core · mit cli + sdks</span>
          </div>
          <span>
            made with <span className="text-[#e8344a]">♥</span> in Flanders by flndrn · 100%
            self-funded, sustainable &amp; independent
          </span>
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
