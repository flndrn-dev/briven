'use client';

import { useCallback, useEffect, useState } from 'react';

import { CopyField } from '../../../../../../components/copy-field';

type Product = 'db' | 's3' | 'auth';
type Role = 'viewer' | 'developer' | 'admin';

interface MaskedBadge {
  id: string;
  product: Product | 'pay';
  name: string;
  role: Role;
  prefix: string;
  suffix: string;
  m2mClientId: string | null;
  storageAccessKeyId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

interface CreateResponse {
  badge: MaskedBadge;
  plaintext: string | null;
  s3: {
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  } | null;
  auth: {
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
  } | null;
}

const TABS: { id: Product; label: string; blurb: string }[] = [
  {
    id: 'db',
    label: 'Database',
    blurb:
      'Doltgres only — tables, query, studio. Agents use the sb_db_… secret as a Bearer token. Cannot open S3 or Auth.',
  },
  {
    id: 's3',
    label: 'S3 storage',
    blurb:
      'This project’s bucket only — same S3 tools you already use. You get access key + secret once. Cannot open the database or Auth.',
  },
  {
    id: 'auth',
    label: 'Auth (M2M)',
    blurb:
      'SuperTokens-style machine client: client id + secret → short token. For Auth / machine jobs. Cannot open S3 by itself.',
  },
];

export function ServiceBadgesPanel({
  apiOrigin,
  projectId,
}: {
  apiOrigin: string;
  projectId: string;
}) {
  const [product, setProduct] = useState<Product>('db');
  const [badges, setBadges] = useState<MaskedBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('developer');
  const [pending, setPending] = useState(false);
  const [revealed, setRevealed] = useState<CreateResponse | null>(null);

  const base = `${apiOrigin}/v1/projects/${projectId}/service-badges`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${base}?product=${product}`, { credentials: 'include' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message || `load failed (${res.status})`);
      }
      const data = (await res.json()) as { badges: MaskedBadge[] };
      setBadges(data.badges ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [base, product]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createBadge() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || defaultName(product), product, role }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message || `create failed (${res.status})`);
      }
      const data = (await res.json()) as CreateResponse;
      setRevealed(data);
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setPending(false);
    }
  }

  async function revoke(badgeId: string) {
    if (!confirm('Cut this badge? The machine using it will stop working.')) return;
    setError(null);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(badgeId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message || `revoke failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'revoke failed');
    }
  }

  const tab = TABS.find((t) => t.id === product)!;
  const active = badges.filter((b) => !b.revokedAt);
  const revoked = badges.filter((b) => b.revokedAt);

  return (
    <div className="flex flex-col gap-5">
      {/* product tabs */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border-subtle)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setProduct(t.id);
              setRevealed(null);
            }}
            className={`shrink-0 px-3 py-2 font-mono text-sm transition ${
              product === t.id
                ? 'font-medium text-[var(--color-text)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="font-mono text-xs text-[var(--color-text-muted)]">{tab.blurb}</p>

      {error ? (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
          {error}
        </p>
      ) : null}

      {/* one-time reveal */}
      {revealed ? (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
          <h3 className="font-mono text-sm text-[var(--color-text)]">copy now — shown once</h3>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            after you close this, Briven will not show the secret again.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {revealed.plaintext ? (
              <CopyField value={revealed.plaintext} label="database badge (Bearer secret)" />
            ) : null}
            {revealed.s3 ? (
              <>
                <CopyField value={revealed.s3.endpoint} label="S3 endpoint" />
                <CopyField value={revealed.s3.bucket} label="bucket" />
                <CopyField value={revealed.s3.accessKey} label="access key" />
                <CopyField value={revealed.s3.secretKey} label="secret key" />
              </>
            ) : null}
            {revealed.auth ? (
              <>
                <CopyField value={revealed.auth.clientId} label="client id" />
                <CopyField value={revealed.auth.clientSecret} label="client secret" />
                <CopyField value={revealed.auth.tokenUrl} label="token URL" />
              </>
            ) : null}
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setRevealed(null)}
              className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs font-medium text-[var(--color-text-inverse)]"
            >
              done
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <span className="font-mono text-xs text-[var(--color-text-muted)]">name</span>
            <input
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder={defaultName(product)}
              maxLength={80}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-xs text-[var(--color-text-muted)]">role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.currentTarget.value as Role)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-sm"
            >
              <option value="viewer">look (viewer)</option>
              <option value="developer">work (developer)</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() => void createBadge()}
            className="rounded-md bg-[var(--color-primary)] px-3 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] disabled:opacity-50"
          >
            {pending ? 'creating…' : `create ${tab.label.toLowerCase()} badge`}
          </button>
        </div>
      )}

      {/* list */}
      {loading ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">loading…</p>
      ) : active.length === 0 ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          no active {tab.label.toLowerCase()} badges yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-[var(--color-text)]">{b.name}</p>
                <p className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
                  {b.prefix}…{b.suffix}
                  {b.m2mClientId ? ` · client ${b.m2mClientId.slice(0, 12)}…` : ''}
                  {' · '}
                  {b.role}
                  {b.lastUsedAt
                    ? ` · last used ${new Date(b.lastUsedAt).toLocaleDateString()}`
                    : ' · never used'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void revoke(b.id)}
                className="shrink-0 rounded-md border border-[var(--color-border)] px-2.5 py-1 font-mono text-xs text-[var(--color-text-muted)] hover:border-red-500/50 hover:text-red-300"
              >
                revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {revoked.length > 0 ? (
        <details className="font-mono text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer">revoked ({revoked.length})</summary>
          <ul className="mt-2 flex flex-col gap-1 pl-2">
            {revoked.map((b) => (
              <li key={b.id}>
                {b.name} · …{b.suffix}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function defaultName(product: Product): string {
  if (product === 'db') return 'nightly-db-agent';
  if (product === 's3') return 'backup-storage';
  return 'cron-auth-machine';
}
