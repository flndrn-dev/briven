'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  projectId: string;
  originId: string;
}

interface ErrorBody {
  code?: string;
  message?: string;
}

export function DeleteDomainButton({ projectId, originId }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function remove(): Promise<void> {
    setPending(true);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/auth/allowed-domains/${originId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorBody;
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      router.refresh();
    } catch {
      setPending(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
      >
        remove
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => void remove()}
        disabled={pending}
        className="rounded-md bg-[var(--color-error)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-inverse)] disabled:opacity-50"
      >
        {pending ? '…' : 'confirm'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)]"
      >
        cancel
      </button>
    </span>
  );
}
