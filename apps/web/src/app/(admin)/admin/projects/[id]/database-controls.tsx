'use client';

import { useCallback, useEffect, useState } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';

interface DbHealth {
  reachable: boolean;
  latencyMs: number | null;
  tableCount: number | null;
  headCommit: string | null;
  error: string | null;
}

interface Snapshot {
  id: string;
  name: string;
  tableCount: number;
  createdAt: string;
  auto: boolean;
  commitHash: string;
}

interface Props {
  project: { id: string; name: string; slug: string };
  apiOrigin: string;
}

/**
 * Database controls for the admin project-detail page. Mirrors
 * project-actions.tsx: same fetch-with-credentials pattern, same 403
 * step_up_required inline re-auth, same honest inline error text. Loads
 * health + snapshots on mount, then offers three actions: restart
 * connections (safe), recover to a snapshot (typed RECOVER confirm), and
 * reprovision (typed project-name confirm — destroys everything).
 */
export function DatabaseControls({ project, apiOrigin }: Props) {
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const [showRecover, setShowRecover] = useState(false);
  const [recoverTarget, setRecoverTarget] = useState<string | null>(null);
  const [recoverWord, setRecoverWord] = useState('');
  const [showReprovision, setShowReprovision] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [healthRes, snapsRes] = await Promise.all([
        fetch(`${apiOrigin}/v1/admin/projects/${project.id}/database/health`, {
          credentials: 'include',
        }),
        fetch(`${apiOrigin}/v1/admin/projects/${project.id}/database/snapshots`, {
          credentials: 'include',
        }),
      ]);
      if (!healthRes.ok) throw new Error(`health check failed: ${healthRes.status}`);
      const healthBody = (await healthRes.json()) as { health: DbHealth };
      setHealth(healthBody.health);
      if (snapsRes.ok) {
        const snapsBody = (await snapsRes.json()) as { snapshots: Snapshot[] };
        setSnapshots(snapsBody.snapshots);
      } else {
        setSnapshots(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setLoading(false);
    }
  }, [apiOrigin, project.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Runs a mutation, surfacing step-up re-auth inline (like project-actions).
  // `retry` is stashed so the StepUpPrompt onSuccess can replay it.
  async function call(
    path: string,
    body: Record<string, unknown>,
    retry: () => Promise<void>,
  ): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiOrigin}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 403) {
        const parsed = (await res.json().catch(() => null)) as { code?: string } | null;
        if (parsed?.code === 'step_up_required') {
          setPending(() => retry);
          return null;
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `request failed: ${res.status}`);
      }
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    const run = async () => {
      const result = await call(
        `/v1/admin/projects/${project.id}/database/restart`,
        {},
        run,
      );
      if (result) {
        setNotice('connections restarted — fresh pool on the next query.');
        await refresh();
      }
    };
    await run();
  }

  async function recover(snapshotId: string) {
    const run = async () => {
      const result = await call(
        `/v1/admin/projects/${project.id}/database/recover`,
        { snapshotId },
        run,
      );
      if (result) {
        setNotice(
          `recovered to ${snapshotId} — a safety snapshot (${String(
            result.preRecoverySnapshotId,
          )}) was taken first, ${String(result.tablesAfterRecover)} tables now.`,
        );
        setShowRecover(false);
        setRecoverTarget(null);
        setRecoverWord('');
        await refresh();
      }
    };
    await run();
  }

  async function reprovision() {
    const run = async () => {
      const result = await call(
        `/v1/admin/projects/${project.id}/database/reprovision`,
        { confirmName },
        run,
      );
      if (result) {
        setNotice('database reprovisioned — fresh and empty.');
        setShowReprovision(false);
        setConfirmName('');
        await refresh();
      }
    };
    await run();
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 font-mono text-xs">
      {/* ── status line ────────────────────────────────────────────── */}
      {loading ? (
        <span className="text-[var(--color-text-muted)]">checking database health…</span>
      ) : health ? (
        <div className="flex flex-wrap items-center gap-3">
          {health.reachable ? (
            <span className="rounded-full bg-green-400/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-success)]">
              healthy
            </span>
          ) : (
            <span className="rounded-full bg-red-400/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-red-400">
              unreachable
            </span>
          )}
          {health.latencyMs != null ? (
            <span className="text-[var(--color-text-muted)]">{health.latencyMs}ms</span>
          ) : null}
          {health.tableCount != null ? (
            <span className="text-[var(--color-text-muted)]">
              {health.tableCount} table{health.tableCount === 1 ? '' : 's'}
            </span>
          ) : null}
          {health.headCommit ? (
            <span className="text-[var(--color-text-subtle)]">
              head {health.headCommit.slice(0, 8)}
            </span>
          ) : null}
          {health.error ? <span className="text-[var(--color-error)]">{health.error}</span> : null}
        </div>
      ) : (
        <span className="text-[var(--color-text-muted)]">health unavailable.</span>
      )}

      {/* ── actions ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => void restart()}
          className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-primary)] disabled:opacity-50"
        >
          restart connections
        </button>
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => {
            setShowRecover((v) => !v);
            setShowReprovision(false);
          }}
          className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-text)] disabled:opacity-50"
        >
          recover…
        </button>
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => {
            setShowReprovision((v) => !v);
            setShowRecover(false);
          }}
          className="rounded-md border border-red-400/40 px-2 py-1 text-red-400 disabled:opacity-50"
        >
          reprovision…
        </button>
      </div>
      <p className="text-[10px] text-[var(--color-text-subtle)]">
        restart is safe — it only drops the connection pool, never data.
      </p>

      {/* ── recover panel ──────────────────────────────────────────── */}
      {showRecover ? (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] p-3">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            snapshots
          </span>
          {snapshots === null ? (
            <span className="text-[var(--color-text-muted)]">snapshots unavailable.</span>
          ) : snapshots.length === 0 ? (
            <span className="text-[var(--color-text-muted)]">no snapshots yet.</span>
          ) : (
            <ul className="flex flex-col gap-2">
              {snapshots.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3">
                  <span className="text-[var(--color-text)]">{s.name}</span>
                  <span className="text-[var(--color-text-muted)]">
                    {new Date(s.createdAt).toLocaleString()}
                  </span>
                  <span className="text-[var(--color-text-muted)]">
                    {s.tableCount} table{s.tableCount === 1 ? '' : 's'}
                  </span>
                  {recoverTarget === s.id ? (
                    <span className="flex items-center gap-2">
                      <input
                        value={recoverWord}
                        disabled={busy}
                        onChange={(e) => setRecoverWord(e.target.value)}
                        placeholder="type RECOVER"
                        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)] disabled:opacity-50"
                      />
                      <button
                        type="button"
                        disabled={busy || recoverWord !== 'RECOVER'}
                        onClick={() => void recover(s.id)}
                        className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-primary)] disabled:opacity-50"
                      >
                        confirm recover
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setRecoverTarget(null);
                          setRecoverWord('');
                        }}
                        className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-muted)] disabled:opacity-50"
                      >
                        cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setRecoverTarget(s.id);
                        setRecoverWord('');
                      }}
                      className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-text)] disabled:opacity-50"
                    >
                      recover to this
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-[var(--color-text-subtle)]">
            a fresh safety snapshot is taken automatically before every recover, so a recover can
            itself be undone.
          </p>
        </div>
      ) : null}

      {/* ── reprovision panel ──────────────────────────────────────── */}
      {showReprovision ? (
        <div className="flex flex-col gap-2 rounded-md border border-red-400/40 p-3">
          <p className="text-red-400">
            this wipes the database completely — every table, every row, and every snapshot is
            destroyed permanently. there is no undo. a fresh empty database takes its place.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={confirmName}
              disabled={busy}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder="type the project name to confirm"
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)] disabled:opacity-50"
            />
            <button
              type="button"
              disabled={busy || confirmName.length === 0}
              onClick={() => void reprovision()}
              className="rounded-md border border-red-400/40 px-2 py-1 text-red-400 disabled:opacity-50"
            >
              reprovision database
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setShowReprovision(false);
                setConfirmName('');
              }}
              className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-muted)] disabled:opacity-50"
            >
              cancel
            </button>
          </div>
        </div>
      ) : null}

      {notice ? <span className="text-[10px] text-[var(--color-success)]">{notice}</span> : null}
      {error ? <span className="text-[10px] text-[var(--color-error)]">{error}</span> : null}
      {pending ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="database controls require fresh step-up auth."
          onSuccess={async () => {
            const retry = pending;
            setPending(null);
            await retry();
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
