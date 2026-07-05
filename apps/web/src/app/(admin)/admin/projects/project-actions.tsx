'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';

type Tier = 'free' | 'pro' | 'team';
const TIERS: readonly Tier[] = ['free', 'pro', 'team'];

interface AdminProject {
  id: string;
  tier: Tier;
  suspendedAt: string | null;
}

interface Props {
  project: AdminProject;
  apiOrigin: string;
}

/**
 * Interactive controls for the admin project-detail page. Mirrors
 * user-actions.tsx: same fetch-with-credentials pattern, same 403
 * step_up_required inline re-auth, same router.refresh() on success.
 * Adds a plan-tier <select> (free/pro/team → POST projects/:id/tier) on
 * top of the suspend/unsuspend buttons the project endpoints already back.
 */
export function ProjectActions({ project, apiOrigin }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [tier, setTier] = useState<Tier>(project.tier);
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Runs a fetch, surfacing step-up re-auth inline (like user-actions).
  // `retry` is stashed so the StepUpPrompt onSuccess can replay it.
  async function call(
    path: string,
    body: Record<string, unknown>,
    retry: () => Promise<void>,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
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
          return false;
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `request failed: ${res.status}`);
      }
      startTransition(() => router.refresh());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveTier(next: Tier) {
    const run = async () => {
      await call(`/v1/admin/projects/${project.id}/tier`, { tier: next }, run);
    };
    await run();
  }

  function suspend(action: 'suspend' | 'unsuspend') {
    if (!confirm(`confirm ${action} for ${project.id}?`)) return;
    const run = async () => {
      await call(`/v1/admin/projects/${action}`, { projectId: project.id }, run);
    };
    void run();
  }

  return (
    <div className="flex flex-col items-end gap-2 font-mono text-xs">
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          plan
        </label>
        <select
          value={tier}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.value as Tier;
            setTier(next);
            void saveTier(next);
          }}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)] disabled:opacity-50"
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {project.suspendedAt ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => suspend('unsuspend')}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-primary)] disabled:opacity-50"
          >
            unsuspend
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => suspend('suspend')}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-red-400 disabled:opacity-50"
          >
            suspend
          </button>
        )}
      </div>
      {error ? <span className="text-[10px] text-[var(--color-error)]">{error}</span> : null}
      {pending ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="changing a project requires fresh step-up auth."
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

/**
 * "Set ALL my projects to pro" — the bulk self-service upgrade button on the
 * projects LIST header. Hits POST projects/set-mine-tier, which the API
 * scopes strictly to orgs the calling admin created, so it can only ever
 * upgrade the admin's own projects. Shows the resulting count inline.
 */
export function SetMineToProButton({ apiOrigin }: { apiOrigin: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/projects/set-mine-tier`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier: 'pro' }),
      });
      if (res.status === 403) {
        const parsed = (await res.json().catch(() => null)) as { code?: string } | null;
        if (parsed?.code === 'step_up_required') {
          setPending(true);
          return;
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `request failed: ${res.status}`);
      }
      const body = (await res.json()) as { updated: number };
      setResult(`${body.updated} project${body.updated === 1 ? '' : 's'} set to pro`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  }

  function trigger() {
    if (!confirm('set every project you own to the pro plan?')) return;
    void run();
  }

  return (
    <div className="flex flex-col items-start gap-1 font-mono text-xs">
      <button
        type="button"
        disabled={busy}
        onClick={trigger}
        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-primary)] transition-colors hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
      >
        set all my projects to pro
      </button>
      {result ? <span className="text-[10px] text-[var(--color-success)]">{result}</span> : null}
      {error ? <span className="text-[10px] text-[var(--color-error)]">{error}</span> : null}
      {pending ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="bulk-upgrading your projects requires fresh step-up auth."
          onSuccess={async () => {
            setPending(false);
            await run();
          }}
          onCancel={() => setPending(false)}
        />
      ) : null}
    </div>
  );
}
