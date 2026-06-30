'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/* ─── shared types (mirror the GET /v1/projects/:id/mcp payload) ─────────── */

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

export interface ProjectMcpStatus {
  globalEnabled: boolean;
  planTier: PlanTier;
  eligible: boolean;
  mcpEnabled: boolean;
  keys: MaskedKey[];
}

/** The endpoint agents/MCP clients connect to. Shown in the connect hint. */
const MCP_ENDPOINT = 'https://api.briven.tech/mcp';

/* ─── small fetch helper ─────────────────────────────────────────────────── */

type SendResult =
  | { kind: 'ok'; data: unknown }
  | { kind: 'error'; message: string };

async function post(apiOrigin: string, path: string, body?: unknown): Promise<SendResult> {
  try {
    const res = await fetch(`${apiOrigin}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const parsed = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
      if (parsed?.code === 'mcp_plan_required') {
        return { kind: 'error', message: 'this project needs a Pro or Team plan.' };
      }
      if (parsed?.code === 'mcp_global_disabled') {
        return { kind: 'error', message: 'agent access is currently disabled platform-wide.' };
      }
      if (parsed?.code === 'mcp_not_enabled') {
        return { kind: 'error', message: 'turn agent access on for this project first.' };
      }
      return { kind: 'error', message: parsed?.message || `request failed: ${res.status}` };
    }
    return { kind: 'ok', data: await res.json().catch(() => ({})) };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'request failed' };
  }
}

/* ─── panel ──────────────────────────────────────────────────────────────── */

export function McpAccessPanel({
  apiOrigin,
  projectId,
  initial,
}: {
  apiOrigin: string;
  projectId: string;
  initial: ProjectMcpStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ plaintext: string; name: string } | null>(null);
  const [keyName, setKeyName] = useState('');
  const [scope, setScope] = useState<McpScope>('read');
  const [, startTransition] = useTransition();

  const base = `/v1/projects/${projectId}/mcp`;

  function refresh() {
    startTransition(() => router.refresh());
  }

  // ── state 1: global off ────────────────────────────────────────────────
  if (!initial.globalEnabled) {
    return (
      <Card>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          agent access is currently disabled platform-wide. it isn&apos;t available right now —
          check back later.
        </p>
      </Card>
    );
  }

  // ── state 2: free tier (not eligible) ──────────────────────────────────
  if (!initial.eligible) {
    return (
      <Card>
        <div className="flex flex-col gap-3">
          <p className="font-mono text-sm text-[var(--color-text)]">
            Agent Access is a Pro/Team feature
          </p>
          <p className="font-mono text-xs text-[var(--color-text-muted)]">
            upgrade this project&apos;s plan to let AI agents and MCP clients connect to it with
            scoped keys you control.
          </p>
          <Link
            href="/dashboard/billing/upgrade?tier=pro"
            className="inline-flex w-fit rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
          >
            upgrade to Pro/Team
          </Link>
        </div>
      </Card>
    );
  }

  // ── state 3: Pro/Team — enable/disable + keys ──────────────────────────
  async function toggle(enable: boolean) {
    setBusy(true);
    setError(null);
    const result = await post(apiOrigin, enable ? `${base}/enable` : `${base}/disable`);
    setBusy(false);
    if (result.kind === 'error') {
      setError(result.message);
      return;
    }
    refresh();
  }

  async function issue() {
    if (keyName.trim().length === 0) {
      setError('name the key first.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await post(apiOrigin, `${base}/keys`, { name: keyName.trim(), scope });
    setBusy(false);
    if (result.kind === 'error') {
      setError(result.message);
      return;
    }
    const data = result.data as { plaintext?: string } | null;
    if (data?.plaintext) setRevealed({ plaintext: data.plaintext, name: keyName.trim() });
    setKeyName('');
    setScope('read');
    refresh();
  }

  async function revoke(keyId: string) {
    setBusy(true);
    setError(null);
    const result = await post(apiOrigin, `${base}/keys/${keyId}/revoke`);
    setBusy(false);
    if (result.kind === 'error') {
      setError(result.message);
      return;
    }
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* enable/disable */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-sm text-[var(--color-text)]">
              agent access for this project
            </span>
            <span className="font-mono text-xs text-[var(--color-text-muted)]">
              {initial.mcpEnabled
                ? 'on — agents with a valid key can reach this project.'
                : 'off — no agent can connect until you turn it on.'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={
                initial.mcpEnabled
                  ? 'inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary-subtle)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]'
                  : 'inline-flex items-center gap-1.5 rounded-md bg-[var(--color-surface-raised)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]'
              }
            >
              <span
                className={`size-1.5 rounded-full ${
                  initial.mcpEnabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-text-subtle)]'
                }`}
              />
              {initial.mcpEnabled ? 'enabled' : 'disabled'}
            </span>
            <button
              type="button"
              onClick={() => void toggle(!initial.mcpEnabled)}
              disabled={busy}
              className={
                initial.mcpEnabled
                  ? 'rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:text-[var(--color-error)] disabled:opacity-50'
                  : 'rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50'
              }
            >
              {busy ? 'saving…' : initial.mcpEnabled ? 'turn off' : 'turn on'}
            </button>
          </div>
        </div>
      </Card>

      {/* keys + issue, only when enabled */}
      {initial.mcpEnabled ? (
        <Card>
          <div className="flex flex-col gap-4">
            <h3 className="font-mono text-sm text-[var(--color-text)]">keys</h3>

            {initial.keys.length === 0 ? (
              <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                no keys issued yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {initial.keys.map((k) => (
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
                        onClick={() => void revoke(k.id)}
                        disabled={busy}
                        className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-error)] disabled:opacity-50"
                      >
                        revoke
                      </button>
                    ) : null}
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
              <div className="flex flex-wrap items-end gap-2 border-t border-[var(--color-border-subtle)] pt-4">
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
        </Card>
      ) : null}

      {/* how to connect */}
      {initial.mcpEnabled ? (
        <Card>
          <div className="flex flex-col gap-2">
            <h3 className="font-mono text-sm text-[var(--color-text)]">how to connect</h3>
            <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
              point your agent / MCP client at the endpoint below and authenticate with one of the
              keys above (send it as a Bearer token). the key is locked to this project.
            </p>
            <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5 rounded-md bg-[var(--color-surface-raised)] p-3 font-mono text-[11px]">
              <dt className="text-[var(--color-text-subtle)]">endpoint</dt>
              <dd>
                <code className="text-[var(--color-text)]">{MCP_ENDPOINT}</code>
              </dd>
              <dt className="text-[var(--color-text-subtle)]">project id</dt>
              <dd>
                <code className="text-[var(--color-text)]">{projectId}</code>
              </dd>
            </dl>
          </div>
        </Card>
      ) : null}

      {error ? <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p> : null}
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

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
      {children}
    </div>
  );
}
