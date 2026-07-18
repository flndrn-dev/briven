import Link from 'next/link';

import { fetchIncidents } from '../lib/incidents';

interface NavItem {
  href: string;
  label: string;
}

interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

const GROUPS: readonly NavGroup[] = [
  {
    label: 'start',
    items: [
      { href: '/', label: 'overview' },
      { href: '/quickstart', label: 'quickstart' },
      { href: '/connect', label: 'connect' },
      { href: '/cli', label: 'cli' },
      { href: '/templates', label: 'templates' },
    ],
  },
  {
    label: 'build',
    items: [
      { href: '/schema', label: 'schema dsl' },
      { href: '/undo', label: 'undo + snapshots' },
      { href: '/examples', label: 'examples' },
      { href: '/functions', label: 'functions' },
      { href: '/realtime', label: 'realtime' },
      { href: '/sdks', label: 'client sdks' },
      { href: '/api', label: 'http api' },
      { href: '/ai', label: 'ai schema' },
    ],
  },
  {
    label: 'move + run',
    items: [
      { href: '/migration', label: 'migration' },
      { href: '/self-host', label: 'self-host' },
      { href: '/operator', label: 'operator' },
    ],
  },
  {
    label: 'meta',
    items: [
      { href: '/roadmap', label: 'roadmap' },
      { href: '/changelog', label: 'changelog' },
      { href: '/status', label: 'status' },
      { href: '/support', label: 'support' },
    ],
  },
];

export async function DocsShell({ children }: { children: React.ReactNode }) {
  // Surface ongoing incidents in the docs header so a visitor mid-outage
  // sees the acknowledgement without having to navigate to /status. The
  // fetch degrades to [] when the api is unreachable, so a broken api
  // doesn't break docs page renders.
  const ongoing = await fetchIncidents({ activeOnly: true, limit: 1 });
  const active = ongoing[0] ?? null;

  return (
    <div className="min-h-dvh">
      {active ? (
        <Link
          href="/status"
          className="block border-b border-[var(--color-warning)] bg-[var(--color-warning)]/10 px-6 py-2 text-center font-mono text-xs text-[var(--color-warning)] hover:bg-[var(--color-warning)]/20"
        >
          <span className="font-semibold uppercase tracking-wider">
            {active.severity}
          </span>{' '}
          · {active.summary}{' '}
          <span className="text-[var(--color-text-subtle)]">→ status</span>
        </Link>
      ) : null}

      <header className="border-b border-[var(--color-border-subtle)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-mono text-sm">
            briven <span className="text-[var(--color-text-subtle)]">· docs</span>
          </Link>
          <nav className="flex items-center gap-4 font-mono text-xs">
            <Link
              href="https://briven.tech"
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              dashboard
            </Link>
            <Link
              href="https://codeberg.org/flndrn/briven"
              className="inline-flex items-center opacity-80 transition-opacity hover:opacity-100"
              aria-label="Codeberg"
            >
              <img src="/codeberg.svg" alt="Codeberg" className="h-5 w-auto" />
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl grid-cols-[220px_1fr] gap-10 px-6 py-10">
        <nav aria-label="docs sections" className="flex flex-col gap-5 font-mono text-sm">
          {GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="px-3 pb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-subtle)]">
                {group.label}
              </p>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <main className="prose prose-invert max-w-none">{children}</main>
      </div>

      <footer className="border-t border-[var(--color-border-subtle)] py-6">
        <p className="mx-auto max-w-6xl px-6 font-mono text-xs text-[var(--color-text-subtle)]">
          briven · open-core reactive postgres · ©{' '}
          {new Date().getFullYear()} flndrn Limited ·{' '}
          <Link
            href="https://codeberg.org/flndrn/briven"
            className="underline underline-offset-2 hover:text-[var(--color-text-muted)]"
          >
            source
          </Link>{' '}
          · built with <span className="text-[#e8344a]">♥</span> in Flanders
        </p>
      </footer>
    </div>
  );
}
