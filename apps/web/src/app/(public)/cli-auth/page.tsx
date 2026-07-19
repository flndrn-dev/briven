import { redirect } from 'next/navigation';

import { apiJson } from '../../../lib/api';
import { allow, deny } from './actions';

/**
 * `/v1/me` returns a flat profile `{ id, email, ... }` (see apps/api meRouter).
 * Tolerate a nested `{ user }` shape in case older proxies wrap it.
 */
function profileFromMe(data: unknown): { id: string; email: string } | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  if (typeof rec.id === 'string' && typeof rec.email === 'string') {
    return { id: rec.id, email: rec.email };
  }
  if (rec.user && typeof rec.user === 'object') {
    const u = rec.user as Record<string, unknown>;
    if (typeof u.id === 'string' && typeof u.email === 'string') {
      return { id: u.id, email: u.email };
    }
  }
  return null;
}

function isLoopbackHttp(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'http:'
      && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
      && u.port.length > 0
    );
  } catch {
    return false;
  }
}

export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; state?: string; host?: string }>;
}) {
  const { redirect: redirectUrl, state, host } = await searchParams;

  if (!redirectUrl || !state) {
    return <ErrorCard reason="missing redirect or state query param" />;
  }
  if (!isLoopbackHttp(redirectUrl)) {
    return <ErrorCard reason="redirect must be a local-loopback http URL" />;
  }
  if (state.length > 256) {
    return <ErrorCard reason="state too long" />;
  }

  let user: { id: string; email: string } | null = null;
  try {
    const data = await apiJson<unknown>('/v1/me');
    user = profileFromMe(data);
  } catch {
    user = null;
  }

  if (!user) {
    const back = `/cli-auth?redirect=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}${host ? `&host=${encodeURIComponent(host)}` : ''}`;
    redirect(`/signin?next=${encodeURIComponent(back)}`);
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 font-mono text-sm">
      <h1 className="text-base">authorize the briven cli?</h1>
      <p className="text-[var(--color-text-muted)]">
        signed in as <strong>{user.email}</strong>
        {host ? ` · machine ${host}` : null}
      </p>
      <p className="text-xs text-[var(--color-text-muted)]">
        issues a 24-hour session token to the cli on your laptop. revoke with{' '}
        <code>briven logout</code>.
      </p>
      <form className="flex gap-2">
        <button
          formAction={allow.bind(null, { redirectUrl, state })}
          className="flex-1 rounded-md bg-[var(--color-primary)] px-3 py-2 text-[var(--color-text-inverse)]"
        >
          allow
        </button>
        <button
          formAction={deny.bind(null, { redirectUrl, state })}
          className="flex-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          deny
        </button>
      </form>
    </div>
  );
}

function ErrorCard({ reason }: { reason: string }) {
  return (
    <div className="rounded-md border border-[var(--color-error)] bg-[var(--color-surface)] p-6 font-mono text-sm text-[var(--color-error)]">
      <h1 className="text-base">this URL was not opened by the briven cli</h1>
      <p className="mt-2 text-xs">close this tab. ({reason})</p>
    </div>
  );
}
