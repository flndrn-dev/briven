'use server';

import { redirect } from 'next/navigation';

import { apiFetch } from '../../../lib/api';

interface CliTokenResp {
  token?: string;
  message?: string;
  code?: string;
}

function isLoopbackHttp(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'http:' &&
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
      u.port.length > 0
    );
  } catch {
    return false;
  }
}

/**
 * User clicked Allow — mint a 24h CLI token and send the browser back to the
 * local CLI callback (http://127.0.0.1:port/cb?token=…&state=…).
 *
 * On failure we redirect back to /cli-auth with ?error=… so the user sees a
 * clear message instead of the global 500 page.
 */
export async function allow({
  redirectUrl,
  state,
}: {
  redirectUrl: string;
  state: string;
}): Promise<void> {
  if (!isLoopbackHttp(redirectUrl) || state.length === 0 || state.length > 256) {
    redirect('/cli-auth?error=bad_request');
  }

  const res = await apiFetch('/v1/auth/cli-token', { method: 'POST' });
  if (res.status === 401) {
    const back = `/cli-auth?redirect=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}`;
    redirect(`/signin?next=${encodeURIComponent(back)}`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as CliTokenResp;
    const code = encodeURIComponent(
      body.code ?? body.message ?? `mint_failed_${res.status}`,
    );
    redirect(
      `/cli-auth?redirect=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}&error=${code}`,
    );
  }
  const body = (await res.json()) as CliTokenResp;
  if (!body.token) {
    redirect(
      `/cli-auth?redirect=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}&error=no_token`,
    );
  }
  const u = new URL(redirectUrl);
  u.searchParams.set('token', body.token);
  u.searchParams.set('state', state);
  redirect(u.toString());
}

export async function deny({
  redirectUrl,
  state,
}: {
  redirectUrl: string;
  state: string;
}): Promise<void> {
  if (!isLoopbackHttp(redirectUrl)) {
    redirect('/cli-auth?error=bad_request');
  }
  const u = new URL(redirectUrl);
  u.searchParams.set('denied', '1');
  u.searchParams.set('state', state);
  redirect(u.toString());
}
