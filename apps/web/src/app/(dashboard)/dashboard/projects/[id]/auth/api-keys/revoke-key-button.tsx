'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  projectId: string;
  keyId: string;
}

interface ErrorBody {
  code?: string;
  message?: string;
}

/**
 * Two-click revoke — first click puts the row into a confirm state, the
 * second sends the DELETE. Prevents accidental nuking of a production
 * key. The api endpoint is idempotent (already-revoked is a no-op).
 */
export function RevokeKeyButton({ projectId, keyId }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function revoke(): Promise<void> {
    setPending(true);
    setErrMsg(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/api-keys/${keyId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorBody;
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'revoke failed');
      setPending(false);
      setConfirming(false);
    }
  }

  if (errMsg) {
    return (
      <span className="font-mono text-[10px] text-[var(--color-error)]" title={errMsg}>
        revoke failed
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
      >
        revoke
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => void revoke()}
        disabled={pending}
        className="rounded-md bg-[var(--color-error)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-inverse)] disabled:opacity-50"
      >
        {pending ? '…' : 'confirm'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
      >
        cancel
      </button>
    </span>
  );
}
