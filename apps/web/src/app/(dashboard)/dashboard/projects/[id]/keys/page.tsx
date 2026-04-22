import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../../lib/api';
import { NewKeyDialog } from './new-key-dialog';
import { RevokeButton } from './revoke-button';

interface ApiKey {
  id: string;
  name: string;
  suffix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export const dynamic = 'force-dynamic';

export default async function KeysPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { keys } = await apiJson<{ keys: ApiKey[] }>(`/v1/projects/${id}/api-keys`);

  async function createKey(formData: FormData) {
    'use server';
    const { id } = await params;
    const name = String(formData.get('name') ?? '').trim();
    const expires = formData.get('expiresInDays');
    const body: { name: string; expiresInDays?: number } = { name };
    if (expires && expires !== 'never') body.expiresInDays = Number(expires);

    const res = await apiFetch(`/v1/projects/${id}/api-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`create api key failed: ${res.status}`);
    const data = (await res.json()) as { plaintext: string };
    revalidatePath(`/dashboard/projects/${id}/keys`);
    return { plaintext: data.plaintext };
  }

  async function revoke(keyId: string) {
    'use server';
    const { id } = await params;
    const res = await apiFetch(`/v1/projects/${id}/api-keys/${keyId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`revoke failed: ${res.status}`);
    revalidatePath(`/dashboard/projects/${id}/keys`);
  }

  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-mono text-sm text-[var(--color-text)]">api keys</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            used by the cli and service integrations. the plaintext is shown once at creation and
            never stored.
          </p>
        </div>
        <NewKeyDialog action={createKey} />
      </header>

      {active.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
          no active keys.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((k) => (
            <KeyRow key={k.id} k={k} onRevoke={revoke} />
          ))}
        </ul>
      )}

      {revoked.length > 0 ? (
        <details className="mt-4 font-mono text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer">revoked ({revoked.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {revoked.map((k) => (
              <li key={k.id} className="px-4 py-2 text-[var(--color-text-subtle)]">
                {k.name} · brk_•••{k.suffix} · revoked{' '}
                {new Date(k.revokedAt!).toISOString().slice(0, 10)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function KeyRow({
  k,
  onRevoke,
}: {
  k: ApiKey;
  onRevoke: (keyId: string) => Promise<void>;
}) {
  return (
    <li className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3">
      <div>
        <p className="font-mono text-sm">{k.name}</p>
        <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
          brk_•••{k.suffix} · created {new Date(k.createdAt).toISOString().slice(0, 10)}
          {k.lastUsedAt
            ? ` · last used ${new Date(k.lastUsedAt).toISOString().slice(0, 10)}`
            : ' · never used'}
          {k.expiresAt ? ` · expires ${new Date(k.expiresAt).toISOString().slice(0, 10)}` : null}
        </p>
      </div>
      <RevokeButton keyId={k.id} onRevoke={onRevoke} />
    </li>
  );
}
