import Link from 'next/link';

import { apiJson } from '../../../../../../../lib/api';

import { CopyKeyButton } from './copy-key-button';
import { CreateKeyForm } from './create-key-form';
import { RevokeKeyButton } from './revoke-key-button';

interface MaskedKey {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  scope: 'read' | 'read-write' | 'admin';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

interface KeysResponse {
  items: MaskedKey[];
}

interface AuthStateResponse {
  enabled: boolean;
}

export const metadata = { title: 'auth · api keys' };
export const dynamic = 'force-dynamic';

export default async function AuthApiKeysPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const state = await apiJson<AuthStateResponse>(`/v1/projects/${id}/auth/config`).catch(
    () => null,
  );

  if (!state || !state.enabled) {
    return (
      <section className="flex flex-col gap-6">
        <header>
          <h2 className="font-mono text-lg tracking-tight">auth · api keys</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            enable auth on this project first.
          </p>
        </header>
        <Link
          href={`/dashboard/projects/${id}/auth`}
          className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          ← back to auth overview
        </Link>
      </section>
    );
  }

  const data = await apiJson<KeysResponse>(`/v1/projects/${id}/auth/api-keys`);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-lg tracking-tight">auth · api keys</h2>
        <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          SDK keys for <code>@briven/auth</code>. each key is now also stored
          encrypted at rest, so you can copy it again later with the copy
          button — the value is never shown on screen, only copied to your
          clipboard, and every copy is recorded. revoked keys (and any key made
          before this change) can&apos;t be copied — rotate to get a copyable
          one. a sha-256 digest is still what verifies the key. revoked keys
          remain in the list with a strike-through so the audit trail stays
          intact.
        </p>
      </header>

      <CreateKeyForm projectId={id} />

      {data.items.length === 0 ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-xs text-[var(--color-text-muted)]">
          no keys yet — create one above to embed in your customer app.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full min-w-max font-mono text-xs">
            <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-normal">name</th>
                <th className="px-3 py-2 font-normal">scope</th>
                <th className="px-3 py-2 font-normal">key</th>
                <th className="px-3 py-2 font-normal">last used</th>
                <th className="px-3 py-2 font-normal">created</th>
                <th className="px-3 py-2 font-normal">status</th>
                <th className="px-3 py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((k) => (
                <tr
                  key={k.id}
                  className={`border-t border-[var(--color-border-subtle)] ${
                    k.revokedAt ? 'opacity-50 line-through' : ''
                  }`}
                >
                  <td className="px-3 py-2 text-[var(--color-text)]">{k.name}</td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{k.scope}</td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    <code className="text-[10px]">
                      {k.prefix}•••{k.suffix}
                    </code>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {k.lastUsedAt ? relative(k.lastUsedAt) : 'never'}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {relative(k.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {k.revokedAt ? (
                      <span>revoked {relative(k.revokedAt)}</span>
                    ) : k.expiresAt && Date.parse(k.expiresAt) < Date.now() ? (
                      <span>expired</span>
                    ) : (
                      <span className="text-[var(--color-primary)]">active</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {k.revokedAt ? null : (
                      <span className="inline-flex items-center justify-end gap-2">
                        <CopyKeyButton projectId={id} keyId={k.id} />
                        <RevokeKeyButton projectId={id} keyId={k.id} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function relative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const deltaMs = Date.now() - then;
  if (deltaMs < 0) return iso.slice(0, 10);
  if (deltaMs < 60_000) return 'just now';
  if (deltaMs < 60 * 60_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs < 24 * 60 * 60_000) return `${Math.floor(deltaMs / (60 * 60_000))}h ago`;
  if (deltaMs < 30 * 24 * 60 * 60_000)
    return `${Math.floor(deltaMs / (24 * 60 * 60_000))}d ago`;
  return iso.slice(0, 10);
}
