'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';

/* ─── shared types (mirror the /v1/admin/mcp payload) ────────────────────── */

export type McpScope = 'read' | 'read-write' | 'admin';
export type PlanTier = 'free' | 'pro' | 'team';

export interface MaskedKey {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  scope: McpScope;
  enabled: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ProjectAccess {
  projectId: string;
  projectName: string;
  planTier: PlanTier;
  mcpEnabled: boolean;
  eligible: boolean;
  keys: MaskedKey[];
}

/* ─── small fetch helper with step-up detection ──────────────────────────── */

type SendResult =
  | { kind: 'ok'; data: unknown }
  | { kind: 'step_up' }
  | { kind: 'error'; message: string };

async function post(apiOrigin: string, path: string, body: unknown): Promise<SendResult> {
  try {
    const res = await fetch(`${apiOrigin}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 403) {
      const parsed = (await res.json().catch(() => null)) as { code?: string } | null;
      if (parsed?.code === 'step_up_required') return { kind: 'step_up' };
      if (parsed?.code === 'mcp_plan_required') {
        return { kind: 'error', message: 'this project needs a Pro or Team plan.' };
      }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { kind: 'error', message: text || `request failed: ${res.status}` };
    }
    return { kind: 'ok', data: await res.json().catch(() => ({})) };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'request failed' };
  }
}

/* ─── global kill-switch ─────────────────────────────────────────────────── */

export function McpGlobalToggle({
  apiOrigin,
  enabled,
}: {
  apiOrigin: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const [, startTransition] = useTransition();

  async function send(next: boolean) {
    setBusy(true);
    setError(null);
    const result = await post(apiOrigin, '/v1/admin/mcp/global', { enabled: next });
    setBusy(false);
    if (result.kind === 'step_up') {
      setPendingValue(next);
      return;
    }
    if (result.kind === 'error') {
      setError(result.message);
      return;
    }
    setConfirming(false);
    startTransition(() => router.refresh());
  }

  function onClick() {
    // Turning OFF cuts every agent at once — confirm first.
    if (enabled) {
      setConfirming(true);
      return;
    }
    void send(true);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-sm text-[var(--color-text)]">global agent access</span>
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            the master switch. OFF cuts every agent and MCP client at once, regardless of
            per-project settings.
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={
              enabled
                ? 'inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary-subtle)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]'
                : 'inline-flex items-center gap-1.5 rounded-md bg-[var(--color-surface-raised)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]'
            }
          >
            <span
              className={`size-1.5 rounded-full ${
                enabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-text-subtle)]'
              }`}
            />
            {enabled ? 'enabled' : 'disabled'}
          </span>
          <button
            type="button"
            onClick={onClick}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:text-[var(--color-text)] disabled:opacity-50"
          >
            {busy ? 'saving…' : enabled ? 'turn off' : 'turn on'}
          </button>
        </div>
      </div>

      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--color-warning)] bg-[var(--color-surface)] p-3 font-mono text-xs">
          <p className="text-[var(--color-text)]">
            turn OFF global agent access? this immediately blocks every agent / MCP client across
            ALL projects.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void send(false)}
              disabled={busy}
              className="rounded-md bg-[var(--color-error)] px-3 py-1.5 font-sans text-xs text-[var(--color-text-inverse)] disabled:opacity-50"
            >
              {busy ? 'turning off…' : 'yes, turn off'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p> : null}

      {pendingValue != null ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="flipping the global MCP switch requires fresh step-up auth."
          onSuccess={async () => {
            const v = pendingValue;
            setPendingValue(null);
            if (v != null) await send(v);
          }}
          onCancel={() => setPendingValue(null)}
        />
      ) : null}
    </div>
  );
}

/* ─── per-project controls (enable / disable / issue / revoke) ───────────── */

export function McpProjectControls({
  apiOrigin,
  project,
}: {
  apiOrigin: string;
  project: ProjectAccess;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The pending action we retry after a successful step-up.
  const [pending, setPending] = useState<null | { run: () => Promise<void>; reason: string }>(null);
  // The freshly-issued key, shown ONCE.
  const [revealed, setRevealed] = useState<{ plaintext: string; name: string } | null>(null);
  const [keyName, setKeyName] = useState('');
  const [scope, setScope] = useState<McpScope>('read');
  const [, startTransition] = useTransition();

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function toggle(enable: boolean) {
    const run = async () => {
      setBusy(true);
      setError(null);
      const result = await post(
        apiOrigin,
        enable ? '/v1/admin/mcp/projects/enable' : '/v1/admin/mcp/projects/disable',
        { projectId: project.projectId },
      );
      setBusy(false);
      if (result.kind === 'step_up') {
        setPending({ run, reason: `changing MCP access for ${project.projectName}.` });
        return;
      }
      if (result.kind === 'error') {
        setError(result.message);
        return;
      }
      refresh();
    };
    await run();
  }

  async function issue() {
    if (keyName.trim().length === 0) {
      setError('name the key first.');
      return;
    }
    const run = async () => {
      setBusy(true);
      setError(null);
      const result = await post(apiOrigin, '/v1/admin/mcp/keys', {
        projectId: project.projectId,
        name: keyName.trim(),
        scope,
      });
      setBusy(false);
      if (result.kind === 'step_up') {
        setPending({ run, reason: `issuing an MCP key for ${project.projectName}.` });
        return;
      }
      if (result.kind === 'error') {
        setError(result.message);
        return;
      }
      const data = result.data as { plaintext?: string } | null;
      if (data?.plaintext) setRevealed({ plaintext: data.plaintext, name: keyName.trim() });
      setKeyName('');
      setScope('read');
      refresh();
    };
    await run();
  }

  async function revoke(keyId: string, keyLabel: string) {
    const run = async () => {
      setBusy(true);
      setError(null);
      const result = await post(apiOrigin, '/v1/admin/mcp/keys/revoke', { keyId });
      setBusy(false);
      if (result.kind === 'step_up') {
        setPending({ run, reason: `revoking key ${keyLabel}.` });
        return;
      }
      if (result.kind === 'error') {
        setError(result.message);
        return;
      }
      refresh();
    };
    await run();
  }

  // Delete only ever runs on an already-revoked key (the button is shown only
  // for revoked keys) — REVOKE-THEN-DELETE. Hard-removes the row.
  async function remove(keyId: string, keyLabel: string) {
    const run = async () => {
      setBusy(true);
      setError(null);
      const result = await post(apiOrigin, '/v1/admin/mcp/keys/delete', { keyId });
      setBusy(false);
      if (result.kind === 'step_up') {
        setPending({ run, reason: `deleting key ${keyLabel}.` });
        return;
      }
      if (result.kind === 'error') {
        setError(result.message);
        return;
      }
      refresh();
    };
    await run();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-[var(--color-text)]">{project.projectName}</span>
          <PlanBadge tier={project.planTier} />
          {project.mcpEnabled ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary-subtle)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]">
              <span className="size-1.5 rounded-full bg-[var(--color-primary)]" /> mcp on
            </span>
          ) : null}
        </div>

        {project.mcpEnabled ? (
          <button
            type="button"
            onClick={() => void toggle(false)}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] px-2.5 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-error)] disabled:opacity-50"
          >
            disable mcp
          </button>
        ) : project.eligible ? (
          <button
            type="button"
            onClick={() => void toggle(true)}
            disabled={busy}
            className="rounded-md bg-[var(--color-primary)] px-2.5 py-1 font-mono text-[10px] text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
          >
            enable mcp
          </button>
        ) : (
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            requires Pro/Team
          </span>
        )}
      </div>

      {/* keys + issue, only when enabled */}
      {project.mcpEnabled ? (
        <div className="flex flex-col gap-3 border-t border-[var(--color-border-subtle)] pt-3">
          {project.keys.length === 0 ? (
            <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              no keys issued yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {project.keys.map((k) => (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--color-surface-raised)] px-2.5 py-1.5"
                >
                  <span className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-[var(--color-text-muted)]">
                    <span className="text-[var(--color-text)]">{k.name}</span>
                    <span className="text-[var(--color-text-subtle)]">
                      {k.prefix}•••{k.suffix}
                    </span>
                    <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5">{k.scope}</span>
                    {k.revokedAt ? (
                      <span className="text-[var(--color-error)]">revoked</span>
                    ) : (
                      <span className="text-[var(--color-primary)]">active</span>
                    )}
                  </span>
                  {!k.revokedAt ? (
                    <button
                      type="button"
                      onClick={() => void revoke(k.id, `${k.prefix}•••${k.suffix}`)}
                      disabled={busy}
                      className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-error)] disabled:opacity-50"
                    >
                      revoke
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void remove(k.id, `${k.prefix}•••${k.suffix}`)}
                      disabled={busy}
                      className="font-mono text-[10px] text-[var(--color-text-subtle)] hover:text-[var(--color-error)] disabled:opacity-50"
                    >
                      delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {revealed ? (
            <RevealOnce
              plaintext={revealed.plaintext}
              name={revealed.name}
              onDismiss={() => setRevealed(null)}
            />
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  key name
                </span>
                <input
                  value={keyName}
                  onChange={(e) => setKeyName(e.currentTarget.value)}
                  placeholder="e.g. cursor-agent"
                  maxLength={120}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  scope
                </span>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.currentTarget.value as McpScope)}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                >
                  <option value="read">read</option>
                  <option value="read-write">read-write</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => void issue()}
                disabled={busy}
                className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
              >
                {busy ? 'issuing…' : 'issue key'}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {error ? <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p> : null}

      {pending != null ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason={pending.reason}
          onSuccess={async () => {
            const job = pending;
            setPending(null);
            if (job) await job.run();
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}

/* ─── one-time key reveal (copy-once) ────────────────────────────────────── */

function RevealOnce({
  plaintext,
  name,
  onDismiss,
}: {
  plaintext: string;
  name: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--color-warning)] bg-[var(--color-surface)] p-3">
      <p className="font-mono text-[10px] text-[var(--color-warning)]">
        copy &ldquo;{name}&rdquo; now — this is the ONLY time the full key is shown. after you
        dismiss it, only the prefix…suffix hint remains.
      </p>
      <code className="block overflow-x-auto rounded bg-[var(--color-bg)] px-2.5 py-2 font-mono text-xs text-[var(--color-text)]">
        {plaintext}
      </code>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
        >
          {copied ? 'copied ✓' : 'copy key'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          done — hide it
        </button>
      </div>
    </div>
  );
}

function PlanBadge({ tier }: { tier: PlanTier }) {
  const paid = tier === 'pro' || tier === 'team';
  return (
    <span
      className={
        paid
          ? 'inline-flex rounded-md bg-[var(--color-surface-raised)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text)]'
          : 'inline-flex rounded-md bg-[var(--color-surface-raised)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]'
      }
    >
      {tier}
    </span>
  );
}
