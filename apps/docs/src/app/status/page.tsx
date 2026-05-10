import { DocsShell } from '../../components/shell';

export const metadata = { title: 'status' };
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ServiceProbe {
  name: string;
  url: string;
  description: string;
}

const PROBES: readonly ServiceProbe[] = [
  {
    name: 'api',
    url: process.env.BRIVEN_STATUS_API_URL ?? 'https://api.briven.cloud/ready',
    description: 'control plane — accounts, projects, billing, deploy intake',
  },
  {
    name: 'runtime',
    url: process.env.BRIVEN_STATUS_RUNTIME_URL ?? 'https://api.briven.cloud/v1/runtime/health',
    description: 'function host — deno isolates, cold-start budget',
  },
  {
    name: 'realtime',
    url: process.env.BRIVEN_STATUS_REALTIME_URL ?? 'https://api.briven.cloud/v1/realtime/health',
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
    let detail: string | null = null;
    if (!res.ok) {
      detail = await res.text().catch(() => null);
      if (detail && detail.length > 200) detail = `${detail.slice(0, 200)}…`;
    }
    return {
      name: svc.name,
      description: svc.description,
      ok: res.ok,
      status: res.status,
      durationMs,
      detail,
    };
  } catch (err) {
    return {
      name: svc.name,
      description: svc.description,
      ok: false,
      status: null,
      durationMs: Date.now() - t0,
      detail: err instanceof Error ? err.message : 'unreachable',
    };
  }
}

export default async function StatusPage() {
  const probes = await Promise.all(PROBES.map(probe));
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

      <p className="mt-12 font-mono text-xs text-[var(--color-text-subtle)]">
        page renders fresh on every request (no cache). probe timeout: 3000ms.
      </p>
    </DocsShell>
  );
}
