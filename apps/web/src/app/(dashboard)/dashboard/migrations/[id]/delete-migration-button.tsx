'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  requestId: string;
}

interface ErrorBody {
  code?: string;
  message?: string;
}

/**
 * Two-click delete for a migration request. Same pattern as the auth
 * sdk-key revoke: first click arms the confirm state, second sends the
 * DELETE. Hard delete — the api cascades audit-event rows.
 */
export function DeleteMigrationButton({ requestId }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function del(): Promise<void> {
    setPending(true);
    setErrMsg(null);
    try {
      const res = await fetch(`/api/v1/migration-requests/${requestId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorBody;
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      router.replace('/dashboard/migrations');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'delete failed');
      setPending(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
        >
          delete migration request
        </button>
        {errMsg ? (
          <p className="font-mono text-[10px] text-[var(--color-error)]">{errMsg}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--color-error)] bg-[var(--color-bg)] p-3">
      <p className="font-mono text-xs text-[var(--color-text)]">
        permanently delete this migration request? this also deletes its audit
        history.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void del()}
          disabled={pending}
          className="rounded-md bg-[var(--color-error)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-inverse)] disabled:opacity-50"
        >
          {pending ? 'deleting…' : 'yes, delete'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          cancel
        </button>
      </div>
    </div>
  );
}
