import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../../lib/api';
import { CronExpressionField } from './cron-expression-field';

function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

interface Schedule {
  id: string;
  name: string;
  functionName: string;
  cronExpression: string;
  args: Record<string, unknown>;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunStatus: 'pending' | 'ok' | 'error' | 'skipped' | null;
  lastRunError: string | null;
  createdAt: string;
}

interface FunctionNames {
  names: string[];
}

export const dynamic = 'force-dynamic';

const COMMON_EXPRESSIONS: { label: string; expression: string }[] = [
  { label: 'every minute', expression: '* * * * *' },
  { label: 'every 5 minutes', expression: '*/5 * * * *' },
  { label: 'hourly', expression: '@hourly' },
  { label: 'every day at 04:00 UTC', expression: '0 4 * * *' },
  { label: 'every monday at 09:00 UTC', expression: '0 9 * * 1' },
  { label: 'first of month at midnight', expression: '@monthly' },
];

export default async function CronPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [schedulesResult, fnNamesResult] = await Promise.all([
    apiJson<{ schedules: Schedule[] }>(`/v1/projects/${id}/schedules`).catch(() => ({
      schedules: [] as Schedule[],
    })),
    apiJson<FunctionNames>(`/v1/projects/${id}/function-names`).catch(() => ({
      names: [] as string[],
    })),
  ]);
  const schedules = schedulesResult.schedules;
  const functionNames = fnNamesResult.names;

  async function create(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    const functionName = String(formData.get('functionName') ?? '').trim();
    const cronExpression = String(formData.get('cronExpression') ?? '').trim();
    const argsRaw = String(formData.get('args') ?? '').trim();

    let args: Record<string, unknown> = {};
    if (argsRaw.length > 0) {
      try {
        const parsed = JSON.parse(argsRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        } else {
          throw new Error('args must be a JSON object');
        }
      } catch (err) {
        throw new Error(`invalid args JSON: ${err instanceof Error ? err.message : 'parse error'}`);
      }
    }

    const res = await apiFetch(`/v1/projects/${id}/schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, functionName, cronExpression, args }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `create failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/cron`);
  }

  async function toggle(formData: FormData) {
    'use server';
    const scheduleId = String(formData.get('scheduleId') ?? '');
    const enabled = String(formData.get('enabled') ?? '') === 'true';
    const res = await apiFetch(`/v1/projects/${id}/schedules/${scheduleId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `toggle failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/cron`);
  }

  async function remove(formData: FormData) {
    'use server';
    const scheduleId = String(formData.get('scheduleId') ?? '');
    const res = await apiFetch(`/v1/projects/${id}/schedules/${scheduleId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);
    revalidatePath(`/dashboard/projects/${id}/cron`);
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">scheduled functions</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          cron-triggered invocations. utc only — 5-field expressions plus the standard{' '}
          <code>@hourly</code> / <code>@daily</code> / <code>@weekly</code> /{' '}
          <code>@monthly</code> aliases. the dispatcher fires every minute.
        </p>
      </header>

      <section className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          new schedule
        </h3>
        <form action={create} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              name
            </span>
            <input
              required
              name="name"
              pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}"
              placeholder="nightly-cleanup"
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              function
            </span>
            {functionNames.length > 0 ? (
              <select
                required
                name="functionName"
                defaultValue=""
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
              >
                <option value="" disabled>
                  pick a deployed function…
                </option>
                {functionNames.map((fn) => (
                  <option key={fn} value={fn}>
                    {fn}
                  </option>
                ))}
              </select>
            ) : (
              <input
                required
                name="functionName"
                placeholder="cleanupExpiredSessions"
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
              />
            )}
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              cron expression (utc)
            </span>
            <CronExpressionField projectId={id} apiOrigin={publicApiOrigin()} />
            <CommonExpressionsHint />
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              args (json object — optional)
            </span>
            <textarea
              name="args"
              rows={3}
              placeholder='{"olderThan": "7d"}'
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
            />
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 font-sans text-sm text-[var(--color-text-inverse)] transition-colors hover:bg-[var(--color-primary-hover)]"
            >
              create schedule
            </button>
          </div>
        </form>

        {functionNames.length === 0 ? (
          <p className="mt-4 font-mono text-xs text-[var(--color-warning)]">
            no deployed functions detected. deploy the project once before creating a schedule so
            the dispatcher has something to call.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          existing schedules
        </h3>
        {schedules.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
            no schedules yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {schedules.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-sm text-[var(--color-text)]">{s.name}</span>
                    <StatusPill enabled={s.enabled} status={s.lastRunStatus} />
                  </div>
                  <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
                    <code>{s.cronExpression}</code> · calls <code>{s.functionName}</code>
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-subtle)]">
                    next: {formatTimestamp(s.nextRunAt)}
                    {s.lastRunAt ? ` · last: ${formatTimestamp(s.lastRunAt)}` : ''}
                  </p>
                  {s.lastRunError ? (
                    <p className="mt-1 font-mono text-[10px] text-[var(--color-error)]">
                      last error: {s.lastRunError}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <form action={toggle}>
                    <input type="hidden" name="scheduleId" value={s.id} />
                    <input type="hidden" name="enabled" value={(!s.enabled).toString()} />
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                    >
                      {s.enabled ? 'pause' : 'resume'}
                    </button>
                  </form>
                  <form action={remove}>
                    <input type="hidden" name="scheduleId" value={s.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
                    >
                      delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CommonExpressionsHint() {
  return (
    <p className="mt-1 font-mono text-[10px] text-[var(--color-text-subtle)]">
      common patterns:{' '}
      {COMMON_EXPRESSIONS.map((c, i) => (
        <span key={c.expression}>
          {i > 0 ? ' · ' : ''}
          <code className="text-[var(--color-text-muted)]">{c.expression}</code>{' '}
          <span className="text-[var(--color-text-subtle)]">({c.label})</span>
        </span>
      ))}
    </p>
  );
}

function StatusPill({
  enabled,
  status,
}: {
  enabled: boolean;
  status: Schedule['lastRunStatus'];
}) {
  if (!enabled) {
    return (
      <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        paused
      </span>
    );
  }
  if (!status || status === 'pending') {
    return (
      <span className="rounded-full border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-primary)]">
        active
      </span>
    );
  }
  if (status === 'ok') {
    return (
      <span className="rounded-full border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-primary)]">
        last ok
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="rounded-full border border-[var(--color-error)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-error)]">
        last error
      </span>
    );
  }
  return (
    <span className="rounded-full border border-[var(--color-warning)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-warning)]">
      skipped
    </span>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' utc';
}
