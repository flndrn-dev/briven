'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';

type Status = 'no_response' | 'in_review' | 'replied' | 'closed';

const STATUS_OPTIONS: readonly Status[] = ['no_response', 'in_review', 'replied', 'closed'];

const STATUS_LABELS: Record<Status, string> = {
  no_response: 'no response',
  in_review: 'in review',
  replied: 'replied',
  closed: 'closed',
};

interface TicketSummary {
  id: string;
  status: string;
  assignedTo: string | null;
  operatorNotes: string;
}

interface Props {
  ticket: TicketSummary;
  apiOrigin: string;
}

interface PatchPayload {
  status?: Status;
  assignedTo?: string;
  operatorNotes?: string;
}

export function TicketActions({ ticket, apiOrigin }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] = useState<PatchPayload | null>(null);

  const [status, setStatus] = useState<Status>(ticket.status as Status);
  const [assignedTo, setAssignedTo] = useState(ticket.assignedTo ?? '');
  const [operatorNotes, setOperatorNotes] = useState(ticket.operatorNotes);
  const [editingNotes, setEditingNotes] = useState(false);

  // Reply
  const [replyBody, setReplyBody] = useState('');
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const [, startTransition] = useTransition();

  async function patch(payload: PatchPayload) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/tickets/${ticket.id}`, {
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

  async function sendReply() {
    if (!replyBody.trim()) return;
    setReplying(true);
    setReplyError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/tickets/${ticket.id}/reply`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: replyBody.trim() }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `reply failed: ${res.status}`);
      }
      setReplyBody('');
      startTransition(() => router.refresh());
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'reply failed');
    } finally {
      setReplying(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-4">
      <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
        operator actions
      </h3>

      {/* status */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">status</span>
        <select
          value={status}
          disabled={busy}
          onChange={(e) => setStatus(e.target.value as Status)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || status === (ticket.status as Status)}
          onClick={() => void patch({ status })}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {busy ? 'saving…' : 'save status'}
        </button>
      </div>

      {/* assigned to */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">assigned to</span>
        <input
          type="text"
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          maxLength={200}
          placeholder="email or name"
          disabled={busy}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void patch({ assignedTo: assignedTo.trim() !== '' ? assignedTo.trim() : undefined })
          }
          className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:opacity-50"
        >
          {busy ? 'saving…' : 'save'}
        </button>
      </div>

      {/* operator notes */}
      {editingNotes ? (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            operator notes
          </span>
          <textarea
            value={operatorNotes}
            onChange={(e) => setOperatorNotes(e.target.value)}
            maxLength={20_000}
            rows={4}
            placeholder="internal notes — never shown to the user."
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void patch({ operatorNotes })}
              disabled={busy}
              className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {busy ? 'saving…' : 'save notes'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingNotes(false);
                setOperatorNotes(ticket.operatorNotes);
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
            {ticket.operatorNotes ? 'edit notes' : 'add notes'}
          </button>
          {ticket.operatorNotes ? (
            <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              · {ticket.operatorNotes.length} chars
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
          reason="updating a ticket requires fresh step-up auth. confirm with your password."
          onSuccess={async () => {
            const payload = pendingPayload;
            setPendingPayload(null);
            if (payload) await patch(payload);
          }}
          onCancel={() => setPendingPayload(null)}
        />
      ) : null}

      {/* reply box */}
      <div className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-4">
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          reply to user
        </span>
        <textarea
          value={replyBody}
          onChange={(e) => setReplyBody(e.target.value)}
          rows={5}
          maxLength={10_000}
          placeholder="your reply — this will be emailed to the customer."
          disabled={replying}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
        />
        {replyError ? (
          <p className="font-mono text-[10px] text-[var(--color-error)]">{replyError}</p>
        ) : null}
        <div>
          <button
            type="button"
            onClick={() => void sendReply()}
            disabled={replying || !replyBody.trim()}
            className="rounded-md bg-[var(--color-primary)] px-4 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
          >
            {replying ? 'sending…' : 'send reply'}
          </button>
        </div>
      </div>
    </div>
  );
}
