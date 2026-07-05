'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CopyField } from '@/components/copy-field';

interface StorageKey {
  id: string;
  name: string;
  accessKeyId: string;
  suffix: string;
  bucket: string;
  enabled: boolean;
  createdAt: string;
  revokedAt: string | null;
}

interface CreatedKey {
  record: StorageKey;
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

interface Props {
  projectId: string;
  initial: StorageKey[];
}

/**
 * Storage keys — mint an S3 key scoped to this project's own bucket. The secret
 * is shown ONCE on creation (never stored), so the panel surfaces the full
 * connection details right after minting, with a clear "copy it now" warning.
 */
export function StorageKeysPanel({ projectId, initial }: Props) {
  const router = useRouter();
  const [keys, setKeys] = useState(initial);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedKey | null>(null);

  async function create(): Promise<void> {
    const label = name.trim();
    if (!label) return;
    setPending(true);
    setErrMsg(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/storage-keys`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: label }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        throw new Error(b.message ?? b.code ?? `http ${res.status}`);
      }
      const body = (await res.json()) as CreatedKey;
      setCreated(body);
      setKeys((k) => [body.record, ...k]);
      setName('');
      router.refresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'create failed');
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    setPending(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/storage-keys/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('revoke failed');
      setKeys((k) =>
        k.map((x) => (x.id === id ? { ...x, enabled: false, revokedAt: new Date().toISOString() } : x)),
      );
      router.refresh();
    } catch {
      // best-effort; the list re-syncs on refresh
    } finally {
      setPending(false);
    }
  }

  const active = keys.filter((k) => !k.revokedAt);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          storage keys
        </h3>
        <p className="mt-1 max-w-2xl font-mono text-[11px] text-[var(--color-text-muted)]">
          an S3 key that opens ONLY this project&apos;s bucket — plug it into any S3 tool. the
          secret is shown once; store it safely.
        </p>
      </div>

      {created ? (
        <div className="rounded-md border border-[var(--color-primary)] bg-[var(--color-surface-raised)] p-4">
          <p className="font-mono text-xs text-[var(--color-text)]">
            copy these now — the secret key is shown only once. these four are the
            connection details a project or S3 tool needs.
          </p>
          <div className="mt-3 flex flex-col gap-2.5">
            {(
              [
                ['endpoint', created.endpoint],
                ['bucket', created.bucket],
                ['access key', created.accessKey],
                ['secret key', created.secretKey],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  {label}
                </span>
                <CopyField value={value} label={label} />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="mt-3 rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-[11px] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            done — I&apos;ve copied it
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="key name (e.g. production)"
            maxLength={80}
            className="w-full max-w-xs rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={pending || !name.trim()}
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
          >
            {pending ? 'minting…' : 'new key'}
          </button>
          {errMsg ? (
            <span className="font-mono text-[11px] text-[var(--color-error)]">{errMsg}</span>
          ) : null}
        </div>
      )}

      {active.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-xs text-[var(--color-text-muted)]">
          no keys yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-[var(--color-text)]">{k.name}</p>
                <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-muted)]">
                  {k.accessKeyId} · •••{k.suffix} · {new Date(k.createdAt).toISOString().slice(0, 10)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void revoke(k.id)}
                disabled={pending}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-[11px] text-[var(--color-text-muted)] transition hover:border-[var(--color-error)] hover:text-[var(--color-error)] disabled:opacity-50"
              >
                revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
