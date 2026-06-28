'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';

interface AdminUser {
  id: string;
  isAdmin: boolean;
  suspendedAt: string | null;
}

interface Props {
  user: AdminUser;
  apiOrigin: string;
}

export function UserActions({ user, apiOrigin }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function run(action: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/users/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPendingAction(action);
          return;
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `${action} failed: ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  }

  function trigger(action: string) {
    if (!confirm(`confirm ${action} for ${user.id}?`)) return;
    void run(action);
  }

  return (
    <div className="flex flex-col items-end gap-1 font-mono text-xs">
      <div className="flex gap-2">
        {user.suspendedAt ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => trigger('unsuspend')}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-primary)] disabled:opacity-50"
          >
            unsuspend
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => trigger('suspend')}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-red-400 disabled:opacity-50"
          >
            suspend
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => trigger('force-sign-out')}
          className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-muted)] disabled:opacity-50"
        >
          force sign-out
        </button>
        {user.isAdmin ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => trigger('revoke-admin')}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-muted)] disabled:opacity-50"
          >
            revoke admin
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => trigger('grant-admin')}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-primary)] disabled:opacity-50"
          >
            grant admin
          </button>
        )}
      </div>
      {error ? (
        <span className="text-[10px] text-[var(--color-error)]">{error}</span>
      ) : null}
      {pendingAction ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason={`${pendingAction.replace(/-/g, ' ')} a user requires fresh step-up auth.`}
          onSuccess={async () => {
            const action = pendingAction;
            setPendingAction(null);
            await run(action);
          }}
          onCancel={() => setPendingAction(null)}
        />
      ) : null}
    </div>
  );
}
