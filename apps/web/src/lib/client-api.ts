'use client';
import { apiOrigin } from './env';
export async function clientApiJson(path, init = {}) {
  const url = apiOrigin ? apiOrigin + path : path;
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init.headers }, credentials: 'include' });
  if (!res.ok) throw new Error(await res.text().catch(() => ''));
  return await res.json();
}
