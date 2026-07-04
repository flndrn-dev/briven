'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';
import { toValidDate } from '@/lib/utils';

type Severity = 'critical' | 'major' | 'minor' | 'maintenance';

interface Incident {
  id: string;
  startedAt: string;
  resolvedAt: string | null;
  severity: Severity;
  services: readonly string[];
  summary: string;
  postmortem: string;
  createdAt: string;
}

interface Props {
  incident: Incident;
  apiOrigin: string;
}

export function IncidentRow({ incident, apiOrigin }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<null | 'resolve' | 'save'>(null);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(incident.summary);
  const [postmortem, setPostmortem] = useState(incident.postmortem);
  const [, startTransition] = useTransition();

  async function resolve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/incidents/${incident.id}/resolve`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPendingAction('resolve');
          return;
        }
      }
      if (!res.ok) throw new Error(`resolve failed: ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'resolve failed');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/incidents/${incident.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary, postmortem }),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPendingAction('save');
          return;
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `save failed: ${res.status}`);
      }
      setEditing(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setBusy(false);
    }
  }

  const tone = severityTone(incident.severity);

  return (
    <li className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${tone}`}
        >
          {incident.severity}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          {incident.services.join(', ')}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          · started {formatTimestamp(incident.startedAt)}
          {incident.resolvedAt ? ` · resolved ${formatTimestamp(incident.resolvedAt)}` : ' · ongoing'}
        </span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={2000}
            rows={3}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
          />
          <textarea
            value={postmortem}
            onChange={(e) => setPostmortem(e.target.value)}
            maxLength={20_000}
            rows={6}
            placeholder="postmortem (markdown). write once resolved."
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none"
          />
        </div>
      ) : (
        <>
          <p className="font-mono text-sm text-[var(--color-text)]">{incident.summary}</p>
          {incident.postmortem ? (
            <details className="font-mono text-xs text-[var(--color-text-muted)]">
              <summary className="cursor-pointer">postmortem</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words">{incident.postmortem}</pre>
            </details>
          ) : null}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {busy ? 'saving…' : 'save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setSummary(incident.summary);
                setPostmortem(incident.postmortem);
              }}
              className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
          >
            edit
          </button>
        )}
        {!incident.resolvedAt ? (
          <button
            type="button"
            onClick={resolve}
            disabled={busy}
            className="rounded-md border border-[var(--color-border-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-[var(--color-text-inverse)] disabled:opacity-50"
          >
            mark resolved
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p>
      ) : null}

      {pendingAction ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason={
            pendingAction === 'resolve'
              ? 'marking an incident resolved updates the public status page. confirm with your password.'
              : 'editing an incident updates the public narrative. confirm with your password.'
          }
          onSuccess={async () => {
            const action = pendingAction;
            setPendingAction(null);
            if (action === 'resolve') await resolve();
            else if (action === 'save') await save();
          }}
          onCancel={() => setPendingAction(null)}
        />
      ) : null}
    </li>
  );
}

function severityTone(s: Severity): string {
  switch (s) {
    case 'critical':
      return 'border-[var(--color-error)] text-[var(--color-error)]';
    case 'major':
      return 'border-[var(--color-warning)] text-[var(--color-warning)]';
    case 'minor':
      return 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]';
    case 'maintenance':
      return 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]';
  }
}

function formatTimestamp(iso: string): string {
  const d = toValidDate(iso);
  return d ? d.toISOString().replace('T', ' ').slice(0, 16) + ' utc' : '—';
}
