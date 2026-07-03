import Image from 'next/image';

export const metadata = { title: 'down for maintenance · briven' };
// Always render live state — never a cached splash that shows the wrong
// end time after the window moves.
export const dynamic = 'force-dynamic';

/** The public maintenance contract from apps/api. */
interface MaintenanceStatus {
  active: boolean;
  scheduled: boolean;
  upcoming: boolean;
  startsAt: string | null;
  endsAt: string | null;
  message: string | null;
}

/**
 * Fetch the maintenance window straight from the public api. Self-contained:
 * no cookies, no gated data, so it renders even while the rest of the site is
 * gated behind the maintenance rewrite. Fails soft to nulls so the page still
 * shows the base "down for maintenance" message if the api is unreachable.
 */
async function getMaintenance(): Promise<MaintenanceStatus | null> {
  const origin = process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
  if (!origin) return null;
  try {
    const res = await fetch(`${origin}/v1/status/maintenance`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as MaintenanceStatus;
  } catch {
    return null;
  }
}

/** "Wed 3 Jul, 14:30" — a friendly local time the visitor can read. */
function formatWindowEnd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export default async function MaintenancePage() {
  const status = await getMaintenance();
  const endLabel = status?.endsAt ? formatWindowEnd(status.endsAt) : '';
  const customMessage = status?.message?.trim() || '';

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center bg-[var(--color-bg)] px-6 py-16 text-[var(--color-text)]">
      <div className="flex w-full max-w-lg flex-col items-center gap-8 text-center">
        <div className="flex items-center gap-2" aria-label="briven">
          <Image src="/icon.svg" alt="" width={36} height={36} priority className="opacity-95" />
          <span className="font-mono tracking-tight text-[var(--color-text)] text-[var(--text-small)]">
            briven
          </span>
        </div>

        <div className="flex flex-col gap-4">
          <span className="inline-flex items-center justify-center gap-2 self-center rounded-[var(--radius-full)] border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-3 py-1 font-mono uppercase tracking-wider text-[var(--color-primary)] text-[10px]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-primary)] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />
            </span>
            maintenance in progress
          </span>

          <h1 className="font-sans font-medium leading-[1.1] tracking-[-0.03em] text-[var(--color-text)] text-[var(--text-display-3)]">
            down for maintenance
          </h1>

          <p className="leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
            we&apos;re making briven better behind the scenes. your data is safe — we&apos;ll be back
            shortly. thanks for your patience.
          </p>
        </div>

        {endLabel ? (
          <p className="font-mono text-[var(--color-text)] text-[var(--text-small)]">
            back around{' '}
            <span className="text-[var(--color-primary)]">{endLabel}</span>
          </p>
        ) : null}

        {customMessage ? (
          <p className="max-w-prose rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 font-mono leading-relaxed text-[var(--color-text-muted)] text-[var(--text-xs)]">
            {customMessage}
          </p>
        ) : null}

        <p className="font-mono text-[var(--color-text-subtle)] text-[var(--text-xs)]">
          status updates:{' '}
          <a
            href="https://docs.briven.tech/status"
            className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            docs.briven.tech/status
          </a>
        </p>
      </div>

      <footer className="mt-12 font-mono text-[10px] text-[var(--color-text-subtle)]">
        built with <span className="text-[#e8344a]">♥</span> in Flanders · flndrn Limited
      </footer>
    </main>
  );
}
