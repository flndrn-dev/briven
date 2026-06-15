import type { Metadata } from 'next';
import Link from 'next/link';

import { BackgroundGrid } from '../../components/marketing/background-grid';
import { SiteFooter, WebDownLink } from '../../components/marketing/site-footer';
import { SiteHeader } from '../../components/marketing/site-header';
import { getSessionUser } from '../../lib/session';

export const metadata: Metadata = {
  title: 'status — briven',
  description: 'live health of every briven service. probes run when this page is rendered.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ServiceProbe {
  name: string;
  url: string;
  description: string;
  expandChecks?: boolean;
}

const PROBES: readonly ServiceProbe[] = [
  {
    name: 'api',
    url: process.env.BRIVEN_STATUS_API_URL ?? 'https://api.briven.tech/ready',
    description: 'control plane — accounts, projects, billing, deploy intake',
    expandChecks: true,
  },
  {
    name: 'realtime',
    url: process.env.BRIVEN_STATUS_REALTIME_URL ?? 'https://realtime.briven.tech/ready',
    description: 'reactive query websocket service',
  },
  {
    name: 'web',
    url: process.env.BRIVEN_STATUS_WEB_URL ?? 'https://briven.tech/health',
    description: 'marketing site + signed-in dashboard',
  },
  {
    name: 'docs',
    url: process.env.BRIVEN_STATUS_DOCS_URL ?? 'https://docs.briven.tech',
    description: 'developer docs + sdk reference',
  },
];

interface ProbeResult {
  name: string;
  description: string;
  ok: boolean;
  status: number | null;
  durationMs: number;
  detail: string | null;
  checks: Record<string, 'ok' | 'unreachable' | 'not_configured' | 'degraded'> | null;
}

async function probe(svc: ServiceProbe): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(svc.url, {
      signal: AbortSignal.timeout(3000),
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const durationMs = Date.now() - t0;
    const body = await res.text().catch(() => '');
    let detail: string | null = null;
    let checks: ProbeResult['checks'] = null;
    if (svc.expandChecks) {
      try {
        const parsed = JSON.parse(body) as { checks?: Record<string, string> };
        if (parsed.checks) checks = parsed.checks as ProbeResult['checks'];
      } catch {
        // non-JSON body; checks stay null
      }
    }
    if (!res.ok && !detail) {
      detail = body.slice(0, 200) || null;
      if (detail && body.length > 200) detail = `${detail}…`;
    }
    return {
      name: svc.name,
      description: svc.description,
      ok: res.ok,
      status: res.status,
      durationMs,
      detail,
      checks,
    };
  } catch (err) {
    return {
      name: svc.name,
      description: svc.description,
      ok: false,
      status: null,
      durationMs: Date.now() - t0,
      detail: err instanceof Error ? err.message : 'unreachable',
      checks: null,
    };
  }
}

export default async function StatusPage() {
  const [user, probes] = await Promise.all([
    getSessionUser().catch(() => null),
    Promise.all(PROBES.map(probe)),
  ]);
  const allOk = probes.every((p) => p.ok);
  const anyDown = probes.some((p) => !p.ok);

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <BackgroundGrid />
      <SiteHeader user={user} />

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-12 pt-16 sm:pt-20">
        <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-primary)] text-[var(--text-xs)]">
          status
        </p>
        <h1 className="mt-4 font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[var(--color-text)] text-[var(--text-display-3)]">
          briven, live.
        </h1>
        <p className="mt-4 max-w-2xl leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
          probes run when this page is rendered — no cached numbers, no marketing dashboards. for
          incident history and post-mortems, see the{' '}
          <Link
            href="https://docs.briven.tech/status"
            className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            full status page
          </Link>{' '}
          on docs.
        </p>
        <p className="mt-4 font-mono text-xs text-[var(--color-text-subtle)]">
          every briven server &amp; domain is guarded around the clock by{' '}
          <WebDownLink>web down</WebDownLink> — our independent uptime watchdog.
        </p>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6">
        <div
          className={`rounded-[var(--radius-md)] border p-5 font-mono text-sm ${
            allOk
              ? 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)]'
              : 'border-[var(--color-error)] bg-[var(--color-surface)]'
          }`}
        >
          <p className="text-[var(--color-text)]">
            <strong>
              {allOk
                ? 'all systems operational'
                : anyDown
                  ? 'incident in progress'
                  : 'partial degradation'}
            </strong>
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            checked at {new Date().toISOString()} · ttl 0s
          </p>
        </div>
      </section>

      <section className="relative z-10 mx-auto mt-8 w-full max-w-4xl px-6 pb-20">
        <ul className="flex flex-col gap-3">
          {probes.map((p) => (
            <li
              key={p.name}
              className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-sm text-[var(--color-text)]">{p.name}</p>
                  <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
                    {p.description}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-flex items-center gap-2 rounded-[var(--radius-full)] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                      p.ok
                        ? 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
                        : 'border-[var(--color-error)] text-[var(--color-error)]'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${p.ok ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-error)]'}`}
                    />
                    {p.ok ? 'ok' : 'down'}
                  </span>
                  <p className="mt-1.5 font-mono text-[10px] text-[var(--color-text-subtle)]">
                    {p.status ?? '—'} · {p.durationMs}ms
                  </p>
                </div>
              </div>

              {p.checks ? (
                <ul className="mt-4 grid grid-cols-2 gap-2 border-t border-[var(--color-border-subtle)] pt-4 sm:grid-cols-3 md:grid-cols-4">
                  {Object.entries(p.checks).map(([k, v]) => (
                    <li key={k} className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          v === 'ok'
                            ? 'bg-[var(--color-primary)]'
                            : v === 'degraded'
                              ? 'bg-[var(--color-warning)]'
                              : 'bg-[var(--color-error)]'
                        }`}
                      />
                      <span className="font-mono text-xs text-[var(--color-text-muted)]">
                        {k}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-[var(--color-text-subtle)]">
                        {v}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {p.detail ? (
                <pre className="mt-3 overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--color-code-bg)] p-3 font-mono text-[11px] text-[var(--color-code-text)]">
                  {p.detail}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>

        <p className="mt-8 font-mono text-xs text-[var(--color-text-subtle)]">
          probes timeout at 3000ms. /ready returns the service&apos;s view of its dependencies;
          /health only confirms the process is alive.
        </p>
      </section>

      <SiteFooter />
    </main>
  );
}
