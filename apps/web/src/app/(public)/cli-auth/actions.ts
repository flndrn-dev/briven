'use server';

import { redirect } from 'next/navigation';

import { apiFetch } from '../../../lib/api';

interface CliTokenResp {
  token: string;
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

export async function allow(
  { redirectUrl, state }: { redirectUrl: string; state: string },
): Promise<void> {
  if (!isLoopbackHttp(redirectUrl)) throw new Error('invalid redirect');
  const res = await apiFetch('/v1/auth/cli-token', { method: 'POST' });
  if (!res.ok) {
    throw new Error(`mint failed: ${res.status}`);
  }
  const body = (await res.json()) as CliTokenResp;
  const u = new URL(redirectUrl);
  u.searchParams.set('token', body.token);
  u.searchParams.set('state', state);
  redirect(u.toString());
}

export async function deny(
  { redirectUrl, state }: { redirectUrl: string; state: string },
): Promise<void> {
  if (!isLoopbackHttp(redirectUrl)) throw new Error('invalid redirect');
  const u = new URL(redirectUrl);
  u.searchParams.set('denied', '1');
  u.searchParams.set('state', state);
  redirect(u.toString());
}
