'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '../../../../../components/step-up-prompt';

const RESOLUTIONS = ['no_action', 'warned', 'suspended', 'banned'] as const;
type Resolution = (typeof RESOLUTIONS)[number];

interface Props {
  reportId: string;
  currentStatus: 'open' | 'triaged' | 'resolved';
  apiOrigin: string;
}

type Pending =
  | { kind: 'triage' }
  | { kind: 'resolve'; resolution: Resolution; projectId: string | undefined };

export function TriageActions({ reportId, currentStatus, apiOrigin }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Resolution>('no_action');
  const [projectId, setProjectId] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [, startTransition] = useTransition();

  async function run(action: Pending) {
    setBusy(true);
    setError(null);
    try {
      const body =
        action.kind === 'triage'
          ? { action: 'triage' }
          : {
              action: 'resolve',
              resolution: action.resolution,
              projectId: action.projectId,
            };
      const res = await fetch(`${apiOrigin}/v1/admin/abuse-reports/${reportId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 403) {
        const j = (await res.json().catch(() => null)) as { code?: string } | null;
        if (j?.code === 'step_up_required') {
          setPending(action);
          return;
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `${action.kind} failed: ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action.kind} failed`);
    } finally {
      setBusy(false);
    }
  }

  function triage() {
    void run({ kind: 'triage' });
  }
  function resolve() {
    const trimmed = projectId.trim();
    const willSuspend = resolution === 'suspended' || resolution === 'banned';
    void run({
      kind: 'resolve',
      resolution,
      projectId: willSuspend && trimmed ? trimmed : undefined,
    });
  }

  const showProjectInput = resolution === 'suspended' || resolution === 'banned';

  if (currentStatus === 'resolved') {
    return <span className="font-mono text-xs text-[var(--color-text-subtle)]">resolved</span>;
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {currentStatus === 'open' ? (
          <button
            type="button"
            onClick={triage}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] px-3 py-1 font-mono text-xs hover:bg-[var(--color-surface)] disabled:opacity-60"
          >
            {busy && pending?.kind === 'triage' ? '…' : 'triage'}
          </button>
        ) : null}
        <select
          value={resolution}
          onChange={(e) => setResolution(e.target.value as Resolution)}
          disabled={busy}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 font-mono text-xs"
        >
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={resolve}
          disabled={busy}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
        >
          {busy && pending?.kind === 'resolve' ? '…' : 'resolve'}
        </button>
      </div>
      {showProjectInput ? (
        <div className="flex flex-col items-end gap-1">
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.currentTarget.value)}
            placeholder="p_… (auto-suspend target)"
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs disabled:opacity-60"
          />
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            optional — when set, the project is suspended in the same step
          </span>
        </div>
      ) : null}
      {error ? (
        <span className="font-mono text-xs text-[var(--color-text-error)]">{error}</span>
      ) : null}
      {pending ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason={
            pending.kind === 'triage'
              ? 'moving a report to triage requires fresh step-up auth.'
              : 'resolving a report (and any auto-suspension it triggers) requires fresh step-up auth.'
          }
          onSuccess={async () => {
            const action = pending;
            setPending(null);
            await run(action);
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
