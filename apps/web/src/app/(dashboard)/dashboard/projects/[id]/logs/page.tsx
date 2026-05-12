import Link from 'next/link';

import { apiJson } from '../../../../../../lib/api';

interface FunctionLog {
  id: string;
  invocationId: string;
  functionName: string;
  status: 'ok' | 'err';
  durationMs: string;
  touchedTables: unknown;
  userLogsJson: unknown;
  errCode: string | null;
  errMessage: string | null;
  createdAt: string;
}

export const metadata = { title: 'logs' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function LogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ function?: string; status?: string; before?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (sp.function) qs.set('function', sp.function);
  if (sp.status === 'ok' || sp.status === 'err') qs.set('status', sp.status);
  if (sp.before) qs.set('before', sp.before);

  const [{ logs }, { names }] = await Promise.all([
    apiJson<{ logs: FunctionLog[] }>(`/v1/projects/${id}/function-logs?${qs.toString()}`),
    apiJson<{ names: string[] }>(`/v1/projects/${id}/function-names`).catch(() => ({
      names: [] as string[],
    })),
  ]);

  function urlWith(overrides: Record<string, string | null>): string {
    const next = new URLSearchParams();
    if (sp.function) next.set('function', sp.function);
    if (sp.status) next.set('status', sp.status);
    if (sp.before) next.set('before', sp.before);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const q = next.toString();
    return `/dashboard/projects/${id}/logs${q ? `?${q}` : ''}`;
  }

  const lastTs = logs.length > 0 ? logs[logs.length - 1]?.createdAt : null;

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">function logs</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          every invocation — name, duration, touched tables, user logs, errors. retention
          depends on your tier (free: 7 days). populated by the runtime log-fanout worker.
        </p>
      </header>

      <nav className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
        <Link
          href={urlWith({ function: null, before: null })}
          className={`rounded-md border px-2 py-0.5 ${
            !sp.function
              ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
              : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          all functions
        </Link>
        {names.map((n) => (
          <Link
            key={n}
            href={urlWith({ function: n, before: null })}
            className={`rounded-md border px-2 py-0.5 ${
              sp.function === n
                ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {n}
          </Link>
        ))}
        <span className="mx-2 text-[var(--color-text-subtle)]">·</span>
        <Link
          href={urlWith({ status: null, before: null })}
          className={`rounded-md border px-2 py-0.5 ${
            !sp.status
              ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
              : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          any status
        </Link>
        <Link
          href={urlWith({ status: 'ok', before: null })}
          className={`rounded-md border px-2 py-0.5 ${
            sp.status === 'ok'
              ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
              : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          ok
        </Link>
        <Link
          href={urlWith({ status: 'err', before: null })}
          className={`rounded-md border px-2 py-0.5 ${
            sp.status === 'err'
              ? 'border-red-400/60 text-red-400'
              : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          err
        </Link>
      </nav>

      {logs.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-10 text-center font-mono text-sm text-[var(--color-text-muted)]">
          {sp.function || sp.status
            ? 'no logs matching this filter.'
            : 'no invocations yet — deploy a function and call it from the cli or sdk.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {logs.map((log) => (
            <li
              key={log.id}
              className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        log.status === 'ok'
                          ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
                          : 'bg-red-400/15 text-red-400'
                      }`}
                    >
                      {log.status}
                    </span>
                    <span className="font-medium text-[var(--color-text)]">
                      {log.functionName}
                    </span>
                    <span className="text-[var(--color-text-subtle)]">
                      · {log.durationMs}ms
                    </span>
                  </p>
                  {log.errMessage ? (
                    <p className="mt-1 text-red-400">
                      {log.errCode ? `[${log.errCode}] ` : ''}
                      {log.errMessage}
                    </p>
                  ) : null}
                  {Array.isArray(log.userLogsJson) && log.userLogsJson.length > 0 ? (
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-sm bg-[var(--color-bg)] p-2 text-[10px] text-[var(--color-text-muted)]">
                      {(log.userLogsJson as unknown[])
                        .map((entry) =>
                          typeof entry === 'string' ? entry : JSON.stringify(entry),
                        )
                        .join('\n')}
                    </pre>
                  ) : null}
                  {Array.isArray(log.touchedTables) && log.touchedTables.length > 0 ? (
                    <p className="mt-1 text-[10px] text-[var(--color-text-subtle)]">
                      touched:{' '}
                      {(log.touchedTables as string[]).map((t, i) => (
                        <span key={i}>
                          {i > 0 ? ', ' : ''}
                          <Link
                            href={`/dashboard/projects/${id}/studio/${encodeURIComponent(t)}`}
                            className="hover:text-[var(--color-text)]"
                          >
                            {t}
                          </Link>
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
                <time className="shrink-0 text-[10px] text-[var(--color-text-subtle)]">
                  {new Date(log.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}

      {logs.length === PAGE_SIZE && lastTs ? (
        <Link
          href={urlWith({ before: lastTs })}
          className="self-end rounded-md border border-[var(--color-border)] px-3 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          older →
        </Link>
      ) : null}
    </section>
  );
}
