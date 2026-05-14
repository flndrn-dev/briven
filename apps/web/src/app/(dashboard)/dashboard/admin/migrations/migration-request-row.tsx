'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '../../../../../components/step-up-prompt';

interface AdminRequest {
  id: string;
  userId: string;
  source: string;
  sourceUrl: string | null;
  sourceNotes: string;
  estimatedTables: number | null;
  estimatedRows: string | null;
  estimatedFunctions: number | null;
  urgency: string;
  status: string;
  contactEmail: string;
  operatorNotes: string;
  createdAt: string;
  updatedAt: string;
}

type Status = 'new' | 'contacted' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

const STATUS_OPTIONS: readonly Status[] = [
  'new',
  'contacted',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
];

interface Props {
  request: AdminRequest;
  apiOrigin: string;
}

export function MigrationRequestRow({ request, apiOrigin }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] =
    useState<null | { status?: Status; operatorNotes?: string }>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(request.operatorNotes);
  const [, startTransition] = useTransition();

  async function patch(payload: { status?: Status; operatorNotes?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/migration-requests/${request.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPendingPayload(payload);
          return;
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `update failed: ${res.status}`);
      }
      setEditingNotes(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${urgencyTone(request.urgency)}`}>
          {request.urgency.replace(/_/g, ' ')}
        </span>
        <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          {request.source}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          {request.contactEmail}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          · {new Date(request.createdAt).toISOString().slice(0, 16).replace('T', ' ')} utc
        </span>
        <span className="ml-auto font-mono text-[10px] text-[var(--color-text-subtle)]">
          {request.id}
        </span>
      </div>

      {request.sourceUrl ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          source URL:{' '}
          <code className="text-[var(--color-text)]">{request.sourceUrl}</code>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-4 font-mono text-[10px] text-[var(--color-text-subtle)]">
        <span>tables: {request.estimatedTables ?? '—'}</span>
        <span>rows: {request.estimatedRows ?? '—'}</span>
        <span>functions: {request.estimatedFunctions ?? '—'}</span>
      </div>

      {request.sourceNotes ? (
        <details className="font-mono text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer">customer notes</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words">{request.sourceNotes}</pre>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">status</span>
        <select
          value={request.status}
          disabled={busy}
          onChange={(e) => patch({ status: e.target.value as Status })}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {editingNotes ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={20_000}
            rows={4}
            placeholder="internal notes — never shown to the customer. paste call notes, scheduling info, blocker reasons."
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => patch({ operatorNotes: notes })}
              disabled={busy}
              className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {busy ? 'saving…' : 'save notes'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingNotes(false);
                setNotes(request.operatorNotes);
              }}
              className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEditingNotes(true)}
            className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
          >
            {request.operatorNotes ? 'edit notes' : 'add notes'}
          </button>
          {request.operatorNotes ? (
            <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              · {request.operatorNotes.length} chars of operator notes
            </span>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p>
      ) : null}

      {pendingPayload ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="updating a migration request requires fresh step-up auth. confirm with your password."
          onSuccess={async () => {
            const payload = pendingPayload;
            setPendingPayload(null);
            if (payload) await patch(payload);
          }}
          onCancel={() => setPendingPayload(null)}
        />
      ) : null}
    </li>
  );
}

function urgencyTone(u: string): string {
  switch (u) {
    case 'this_week':
      return 'border-[var(--color-error)] text-[var(--color-error)]';
    case 'this_month':
      return 'border-[var(--color-warning)] text-[var(--color-warning)]';
    case 'this_quarter':
      return 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]';
    default:
      return 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]';
  }
}
