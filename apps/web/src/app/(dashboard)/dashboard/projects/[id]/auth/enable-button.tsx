'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  projectId: string;
}

interface EnableResponse {
  ok: true;
  tables: number;
  authUrl: string;
  basePath: string;
}

interface ErrorBody {
  code?: string;
  message?: string;
}

/**
 * Triggers POST /v1/projects/:id/auth/enable, then refreshes the route so
 * the server component re-renders in the enabled state. Idempotent — the
 * api endpoint re-running on an already-enabled project is a no-op (every
 * DDL statement is IF NOT EXISTS).
 */
export function EnableAuthButton({ projectId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function enable(): Promise<void> {
    setPending(true);
    setErrMsg(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/enable`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorBody;
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      const body = (await res.json()) as EnableResponse;
      if (!body.ok) {
        throw new Error('enable returned non-ok response');
      }
      // Server component re-fetches `{enabled, config}` and renders the
      // configured state. router.refresh() forces a fresh server render
      // without a full page reload.
      router.refresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'enable failed');
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void enable()}
        disabled={pending}
        className="self-start rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
      >
        {pending ? 'provisioning…' : 'enable auth'}
      </button>
      {errMsg ? <p className="font-mono text-xs text-[var(--color-error)]">{errMsg}</p> : null}
    </div>
  );
}
