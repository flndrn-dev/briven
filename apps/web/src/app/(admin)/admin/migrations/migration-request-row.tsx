'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';
import { toValidDate } from '@/lib/utils';
import { ConvexTranslator } from './convex-translator';

interface AdminRequest {
  id: string;
  userId: string | null;
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

// Pre-baked operator reply templates per target status. {{source}} is
// substituted with the request's source platform (convex / supabase /
// etc.) so the operator's first draft already names the platform the
// customer is coming from. The operator edits these before sending —
// they're starting points, not final copy. Empty for 'new' since the
// confirmation email already fires on create.
const STATUS_TEMPLATES: Record<Status, string> = {
  new: '',
  contacted:
    "hi! thanks for the {{source}} migration request. we'd like to schedule a quick 15-min call to scope your data + auth specifics. what times work for you in the next 2–3 business days?",
  scheduled:
    "great — we've scheduled your {{source}} migration for [date / time]. you'll get a calendar invite shortly. nothing changes on your end until we kick off; your {{source}} keeps serving traffic the entire time.",
  in_progress:
    "we're starting your {{source}} migration now. expected duration: ~[X] hours. your current platform stays serving traffic throughout. you'll get another email the moment we're done and your data is ready to verify.",
  completed:
    "your {{source}} migration is complete on the briven side. please open the dashboard to verify your data — row counts, sample queries, anything that matters. when you're ready to flip writes from {{source}} to briven, the cutover button is one click. happy to walk you through it on a call.",
  cancelled:
    "no problem — we've cancelled this migration request. nothing changed on your {{source}}. if your situation changes, just reply to this email and we'll pick it right back up.",
};

interface Props {
  request: AdminRequest;
  apiOrigin: string;
}

interface PatchPayload {
  status?: Status;
  operatorNotes?: string;
  messageToCustomer?: string;
}

function applyTemplate(template: string, source: string): string {
  return template.replace(/\{\{source\}\}/g, source);
}

export function MigrationRequestRow({ request, apiOrigin }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] = useState<PatchPayload | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(request.operatorNotes);
  // Two-step status change: picking a new status opens a panel where
  // the operator confirms + edits the customer-facing message before
  // the PATCH fires. Skips the panel for transitions where there's
  // nothing meaningful to say (e.g., back to 'new').
  const [stagedStatus, setStagedStatus] = useState<Status | null>(null);
  const [messageToCustomer, setMessageToCustomer] = useState('');
  const [, startTransition] = useTransition();

  async function patch(payload: PatchPayload) {
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
      setStagedStatus(null);
      setMessageToCustomer('');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'update failed');
    } finally {
      setBusy(false);
    }
  }

  // Sentinel-keyed retry: step-up failure on promote stores `__promote`
  // in pendingPayload so the post-step-up handler knows to re-call
  // promoteToUser() rather than patch().
  const PROMOTE_SENTINEL = '__promote' as const;

  async function promoteToUser() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiOrigin}/v1/admin/migration-requests/${request.id}/promote-to-user`,
        {
          method: 'POST',
          credentials: 'include',
        },
      );
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPendingPayload({ messageToCustomer: PROMOTE_SENTINEL });
          return;
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `promote failed: ${res.status}`);
      }
      const body = (await res.json()) as { linkedUserId: string | null };
      if (!body.linkedUserId) {
        setError(
          'no briven user exists with this email yet. ask the customer to sign up, then try again.',
        );
      } else {
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'promote failed');
    } finally {
      setBusy(false);
    }
  }

  function pickStatus(next: Status) {
    if (next === request.status) return;
    setStagedStatus(next);
    const template = STATUS_TEMPLATES[next];
    setMessageToCustomer(template ? applyTemplate(template, request.source) : '');
  }

  function cancelStagedStatus() {
    setStagedStatus(null);
    setMessageToCustomer('');
  }

  function sendStatusUpdate() {
    if (!stagedStatus) return;
    void patch({
      status: stagedStatus,
      ...(messageToCustomer.trim() ? { messageToCustomer: messageToCustomer.trim() } : {}),
    });
  }

  return (
    <li className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${urgencyTone(request.urgency)}`}>
          {request.urgency.replace(/_/g, ' ')}
        </span>
        <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          {request.source}
        </span>
        {request.userId === null ? (
          <>
            <span className="rounded-full border border-[var(--color-warning)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-warning)]">
              unauth lead
            </span>
            <button
              type="button"
              onClick={promoteToUser}
              disabled={busy}
              title="link this lead to the briven user account with the same email (idempotent)"
              className="rounded-md border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
              promote to user
            </button>
          </>
        ) : null}
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          {request.contactEmail}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          ·{' '}
          {toValidDate(request.createdAt)
            ? `${toValidDate(request.createdAt)!.toISOString().slice(0, 16).replace('T', ' ')} utc`
            : '—'}
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

      {request.source === 'convex' ? (
        <ConvexTranslator apiOrigin={apiOrigin} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">status</span>
        <select
          value={stagedStatus ?? request.status}
          disabled={busy}
          onChange={(e) => pickStatus(e.target.value as Status)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        {stagedStatus ? (
          <span className="font-mono text-[10px] text-[var(--color-warning)]">
            unsaved · review the message below before sending
          </span>
        ) : null}
      </div>

      {stagedStatus ? (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] p-3">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-xs text-[var(--color-text)]">
              message to customer · auto-sent on save
            </p>
            <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              template loaded for {request.status.replace(/_/g, ' ')} →{' '}
              {stagedStatus.replace(/_/g, ' ')}
            </p>
          </div>
          <textarea
            value={messageToCustomer}
            onChange={(e) => setMessageToCustomer(e.target.value)}
            rows={6}
            maxLength={5_000}
            placeholder="leave blank to send the auto-generated status-change email without a custom message."
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
          />
          <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            the email also includes the standard status blurb for{' '}
            {stagedStatus.replace(/_/g, ' ')} and a link to /dashboard/migrations. this
            field is your editable preamble.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={sendStatusUpdate}
              disabled={busy}
              className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {busy ? 'sending…' : `send · status → ${stagedStatus.replace(/_/g, ' ')}`}
            </button>
            <button
              type="button"
              onClick={cancelStagedStatus}
              disabled={busy}
              className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              cancel
            </button>
          </div>
        </div>
      ) : null}

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
            if (payload?.messageToCustomer === PROMOTE_SENTINEL) {
              await promoteToUser();
            } else if (payload) {
              await patch(payload);
            }
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
