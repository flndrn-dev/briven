import { DocsShell } from '../../components/shell';
import { fetchIncidents } from '../../lib/incidents';

export const metadata = { title: 'status' };
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ServiceProbe {
  name: string;
  url: string;
  description: string;
  // For api /ready we extract per-dependency status from the response
  // body. For simple /health pings this stays false.
  expandChecks?: boolean;
}

// Runtime isn't probed directly — it lives on an internal network and
// the api /ready endpoint already reports its reachability under
// `checks.runtime`. The status page extracts that field when api/ready
// returns. Realtime is on its own public subdomain (realtime.briven.tech).
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
];

interface ProbeResult {
  name: string;
  description: string;
  ok: boolean;
  status: number | null;
  durationMs: number;
  detail: string | null;
  // For probes with expandChecks=true: per-dependency states extracted
  // from the api /ready body. null when the probe didn't ask for them.
  checks: Record<string, 'ok' | 'unreachable' | 'not_configured' | 'degraded'> | null;
}

async function probe(svc: ServiceProbe): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(svc.url, {
      // Tight timeout — the status page renders fast even when a service
      // is hung. AbortSignal.timeout is supported by node 20+ / bun.
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
  const [probes, incidents] = await Promise.all([
    Promise.all(PROBES.map(probe)),
    fetchIncidents({ limit: 50, fresh: true }),
  ]);
  const allOk = probes.every((p) => p.ok);
  const anyDown = probes.some((p) => !p.ok);

  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">status</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        live health of every briven service. probes run when this page is rendered (no cache).
        for incident history + post-mortems, see the changelog.
      </p>

      <div
        className={`mt-8 rounded-md border p-4 font-mono text-sm ${
          allOk
            ? 'border-[var(--color-primary)] text-[var(--color-text)]'
            : 'border-[var(--color-text-error)] text-[var(--color-text)]'
        }`}
      >
        <p>
          <strong>
            {allOk ? 'all systems operational' : anyDown ? 'incident in progress' : 'partial degradation'}
          </strong>
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          last checked {new Date().toISOString()}
        </p>
      </div>

      <ul className="mt-8 flex flex-col gap-3">
        {probes.map((p) => (
          <li
            key={p.name}
            className="flex items-start justify-between gap-4 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    p.ok ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-text-error)]'
                  }`}
                />
                <p className="font-mono text-sm">{p.name}</p>
                <span className="font-mono text-xs text-[var(--color-text-subtle)]">
                  {p.ok ? 'operational' : 'down'}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">{p.description}</p>
              {p.checks ? (
                <ul className="mt-2 flex flex-wrap gap-2 font-mono text-xs">
                  {Object.entries(p.checks).map(([name, state]) => {
                    const stateClass =
                      state === 'ok'
                        ? 'text-[var(--color-primary)] bg-[var(--color-primary-subtle)]'
                        : state === 'not_configured'
                          ? 'text-[var(--color-text-subtle)] bg-[var(--color-surface)]'
                          : 'text-[var(--color-text-error)] bg-red-500/10';
                    return (
                      <li key={name} className={`inline-flex rounded-md px-2 py-0.5 ${stateClass}`}>
                        {name.replace(/_/g, ' ')} · {state}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {p.detail ? (
                <p className="mt-2 truncate font-mono text-xs text-[var(--color-text-error)]" title={p.detail}>
                  {p.detail}
                </p>
              ) : null}
            </div>
            <div className="text-right font-mono text-xs text-[var(--color-text-subtle)]">
              <p>{p.status ?? '—'}</p>
              <p className="mt-1">{p.durationMs}ms</p>
            </div>
          </li>
        ))}
      </ul>

      <section className="mt-12">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-lg">incident history</h2>
          <a
            href="/api/status/incidents.xml"
            className="font-mono text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]"
          >
            rss
          </a>
        </div>
        {incidents.length === 0 ? (
          <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
            no incidents on record. when one happens, an entry lands here and on the rss feed.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {incidents.map((inc) => (
              <li
                key={inc.id}
                id={inc.id}
                className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span
                        className={`rounded-md px-2 py-0.5 ${
                          inc.severity === 'critical'
                            ? 'bg-red-500/15 text-red-300'
                            : inc.severity === 'major'
                              ? 'bg-yellow-500/15 text-yellow-300'
                              : inc.severity === 'minor'
                                ? 'bg-[var(--color-surface-raised)] text-[var(--color-text-subtle)]'
                                : 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
                        }`}
                      >
                        {inc.severity}
                      </span>
                      <span className="text-[var(--color-text-muted)]">
                        {inc.services.join(', ')}
                      </span>
                      <span className="text-[var(--color-text-subtle)]">
                        {inc.resolvedAt ? 'resolved' : 'ongoing'}
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-sm text-[var(--color-text)]">
                      {inc.summary}
                    </p>
                    {inc.postmortem ? (
                      <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-[var(--color-text-muted)]">
                        {inc.postmortem}
                      </pre>
                    ) : null}
                  </div>
                  <div className="text-right font-mono text-[10px] text-[var(--color-text-subtle)]">
                    <p>{inc.startedAt.slice(0, 10)}</p>
                    {inc.resolvedAt ? <p className="mt-1">→ {inc.resolvedAt.slice(0, 10)}</p> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-12 font-mono text-xs text-[var(--color-text-subtle)]">
        page renders fresh on every request (no cache). probe timeout: 3000ms. incidents are
        operator-curated and read live from the api (/v1/status/incidents); if the api is
        unreachable, the list renders empty rather than failing the page.
      </p>
    </DocsShell>
  );
}
