import Link from 'next/link';

interface NavItem {
  href: string;
  label: string;
}

const NAV: readonly NavItem[] = [
  { href: '/', label: 'overview' },
  { href: '/quickstart', label: 'quickstart' },
  { href: '/cli', label: 'cli' },
  { href: '/schema', label: 'schema dsl' },
  { href: '/functions', label: 'functions' },
  { href: '/self-host', label: 'self-host' },
];

export function DocsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--color-border-subtle)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-mono text-sm">
            briven <span className="text-[var(--color-text-subtle)]">· docs</span>
          </Link>
          <nav className="flex items-center gap-4 font-mono text-xs">
            <Link
              href="https://briven.cloud"
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              dashboard
            </Link>
            <Link
              href="https://github.com/flndrn-dev/briven"
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              github
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl grid-cols-[220px_1fr] gap-10 px-6 py-10">
        <nav aria-label="docs sections" className="flex flex-col gap-1 font-mono text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <main className="prose prose-invert max-w-none">{children}</main>
      </div>

      <footer className="border-t border-[var(--color-border-subtle)] py-6">
        <p className="mx-auto max-w-6xl px-6 font-mono text-xs text-[var(--color-text-subtle)]">
          briven · open-core reactive postgres ·{' '}
          <Link
            href="https://github.com/flndrn-dev/briven"
            className="underline underline-offset-2 hover:text-[var(--color-text-muted)]"
          >
            source
          </Link>
        </p>
      </footer>
    </div>
  );
}
