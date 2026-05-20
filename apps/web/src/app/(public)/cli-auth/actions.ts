'use server';

import { redirect } from 'next/navigation';

import { apiFetch } from '../../../lib/api';

interface CliTokenResp {
  token: string;
}

export async function allow(
  { redirectUrl, state }: { redirectUrl: string; state: string },
): Promise<void> {
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
  const u = new URL(redirectUrl);
  u.searchParams.set('denied', '1');
  u.searchParams.set('state', state);
  redirect(u.toString());
}
