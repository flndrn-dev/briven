'use client';

import { useState } from 'react';

interface Props {
  invitationId: string;
  action: (invitationId: string) => Promise<void>;
}

export function AcceptButton({ invitationId, action }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    try {
      await action(invitationId);
      // Server action redirects on success — control should not return
      // here, but if it does (e.g. revalidatePath without redirect) the
      // row will disappear on the next render.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'accept failed');
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'accepting…' : 'accept'}
      </button>
      {error ? (
        <span className="font-mono text-xs text-[var(--color-text-error)]">{error}</span>
      ) : null}
    </div>
  );
}
