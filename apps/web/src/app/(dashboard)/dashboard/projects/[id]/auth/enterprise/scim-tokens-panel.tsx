'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { EnterpriseCopyButton } from './enterprise-copy-button';

interface ScimToken {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface Props {
  projectId: string;
  items: ScimToken[];
}

export function ScimTokensPanel({ projectId, items }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  async function createToken(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setPending(true);
    setErr(null);
    setPlaintext(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/scim/tokens`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      const body = (await res.json()) as { plaintext: string };
      setPlaintext(body.plaintext);
      setName('');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed');
    } finally {
      setPending(false);
    }
  }

  async function revoke(tokenId: string): Promise<void> {
    setErr(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/scim/tokens/${tokenId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      setRevokeId(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'revoke failed');
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <div>
        <h3 className="font-mono text-sm text-[var(--color-text)]">SCIM tokens</h3>
        <p className="mt-1 max-w-xl font-mono text-[11px] text-[var(--color-text-muted)]">
          Secret password your company IT system uses to add/remove users. Shown once — paste into
          Okta / Entra / Google as Bearer token.
        </p>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => void createToken(e)}
      >
        <label className="flex flex-1 flex-col gap-1 font-mono text-xs text-[var(--color-text-muted)]">
          <span>token name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={64}
            placeholder="e.g. Okta production"
            className="rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'creating…' : 'create SCIM token'}
        </button>
      </form>

      {plaintext ? (
        <div className="flex flex-col gap-2 rounded-sm border border-[var(--color-primary)] bg-[var(--color-surface)] p-3">
          <p className="font-mono text-xs text-[var(--color-text)]">
            copy this token now — it will not be shown again
          </p>
          <pre className="overflow-x-auto rounded-sm bg-[var(--color-surface-raised)] p-2 font-mono text-[11px] text-[var(--color-text)]">
            {plaintext}
          </pre>
          <div className="flex gap-2">
            <EnterpriseCopyButton value={plaintext} label="copy token" />
            <button
              type="button"
              onClick={() => setPlaintext(null)}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            >
              i&apos;ve copied it
            </button>
          </div>
        </div>
      ) : null}

      {err ? <p className="font-mono text-xs text-[var(--color-error)]">{err}</p> : null}

      {items.length === 0 ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">no SCIM tokens yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full min-w-max font-mono text-xs">
            <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-normal">name</th>
                <th className="px-3 py-2 font-normal">hint</th>
                <th className="px-3 py-2 font-normal">last used</th>
                <th className="px-3 py-2 font-normal">status</th>
                <th className="px-3 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr
                  key={t.id}
                  className={`border-t border-[var(--color-border-subtle)] ${
                    t.revokedAt ? 'opacity-50 line-through' : ''
                  }`}
                >
                  <td className="px-3 py-2 text-[var(--color-text)]">{t.name}</td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    <code className="text-[10px]">
                      {t.prefix}•••{t.suffix}
                    </code>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {t.lastUsedAt ? t.lastUsedAt.slice(0, 10) : 'never'}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {t.revokedAt ? 'revoked' : <span className="text-[var(--color-primary)]">active</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {t.revokedAt ? null : revokeId === t.id ? (
                      <span className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => void revoke(t.id)}
                          className="rounded-md bg-[var(--color-error)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-inverse)]"
                        >
                          confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setRevokeId(null)}
                          className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)]"
                        >
                          cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRevokeId(t.id)}
                        className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
                      >
                        revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
