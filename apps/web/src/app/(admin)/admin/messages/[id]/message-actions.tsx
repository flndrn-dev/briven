'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';

import { toValidDate } from '@/lib/utils';

type Status = 'no_response' | 'in_review' | 'replied' | 'closed';

const STATUS_OPTIONS: readonly Status[] = ['no_response', 'in_review', 'replied', 'closed'];

const STATUS_LABELS: Record<Status, string> = {
  no_response: 'no response',
  in_review: 'in review',
  replied: 'replied',
  closed: 'closed',
};

interface MessageSummary {
  id: string;
  status: string;
}

interface Reply {
  id: string;
  author: 'operator' | 'user';
  body: string;
  createdAt: string;
}

interface Props {
  message: MessageSummary;
  apiOrigin: string;
}

export function MessageActions({ message, apiOrigin }: Props) {
  const router = useRouter();

  // Status control
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<Status | null>(null);
  const [status, setStatus] = useState<Status>(message.status as Status);

  // Reply
  const [replyBody, setReplyBody] = useState('');
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [sentReplies, setSentReplies] = useState<Reply[]>([]);
  // When the reply hits an expired step-up, hold it so the StepUpPrompt
  // can re-run it after the operator re-confirms — the reply text stays
  // in `replyBody` (only cleared on success), so no re-typing.
  const [pendingReply, setPendingReply] = useState(false);

  const [, startTransition] = useTransition();

  async function patchStatus(next: Status) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/contact-messages/${message.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPendingStatus(next);
          return;
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `update failed: ${res.status}`);
      }
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
      const res = await fetch(`${apiOrigin}/v1/admin/contact-messages/${message.id}/reply`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: replyBody.trim() }),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          // Show the password re-confirm prompt right here, then retry the
          // reply automatically on success — no need to change status first.
          setPendingReply(true);
          return;
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `reply failed: ${res.status}`);
      }
      const data = (await res.json().catch(() => null)) as { reply?: Reply } | null;
      if (data?.reply) setSentReplies((prev) => [...prev, data.reply as Reply]);
      setReplyBody('');
      startTransition(() => router.refresh());
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'reply failed');
    } finally {
      setReplying(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <h3 className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        operator actions
      </h3>

      {/* just-sent replies (optimistic; the server thread re-renders on refresh) */}
      {sentReplies.length > 0 ? (
        <div className="flex flex-col gap-4">
          {sentReplies.map((r) => {
            const rd = toValidDate(r.createdAt);
            return (
              <div
                key={r.id}
                className="rounded-xl border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] p-6"
              >
                <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  operator ·{' '}
                  {rd ? `${rd.toISOString().slice(0, 16).replace('T', ' ')} utc` : '—'}
                </p>
                <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--color-text)]">
                  {r.body}
                </pre>
              </div>
            );
          })}
        </div>
      ) : null}

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
          disabled={busy || status === (message.status as Status)}
          onClick={() => void patchStatus(status)}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {busy ? 'saving…' : 'save status'}
        </button>
      </div>

      {error ? (
        <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p>
      ) : null}

      {pendingStatus ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason="updating a message requires fresh step-up auth. confirm with your password."
          onSuccess={async () => {
            const next = pendingStatus;
            setPendingStatus(null);
            if (next) await patchStatus(next);
          }}
          onCancel={() => setPendingStatus(null)}
        />
      ) : null}

      {/* reply box */}
      <div className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-4">
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">reply to user</span>
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
        {pendingReply ? (
          <StepUpPrompt
            apiOrigin={apiOrigin}
            reason="sending a reply requires fresh step-up auth. confirm with your password."
            onSuccess={async () => {
              setPendingReply(false);
              await sendReply();
            }}
            onCancel={() => setPendingReply(false)}
          />
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
