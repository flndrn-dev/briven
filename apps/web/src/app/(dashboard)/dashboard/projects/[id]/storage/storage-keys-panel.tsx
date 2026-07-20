'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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
  endpoint: string;
  /** Always known for this project (even before a key exists). */
  bucket: string;
  initial: StorageKey[];
  /** One-time flash from project create or mint (secret shown once). */
  initialCreated?: CreatedKey | null;
  /** Server action: mint key, flash secret cookie, revalidate. Returns error string or null. */
  mintAction: (formData: FormData) => Promise<string | null>;
  revokeAction: (formData: FormData) => Promise<void>;
}

/**
 * Storage keys — mint an S3 key scoped to this project's own bucket. The secret
 * is shown ONCE on creation (never stored), so the panel surfaces the full
 * connection details right after minting, with a clear "copy it now" warning.
 *
 * Mint/revoke go through server actions (same cookie+origin path as file delete)
 * so browser rewrites cannot drop the session the way a bare client POST can.
 */
export function StorageKeysPanel({
  projectId,
  endpoint,
  bucket,
  initial,
  initialCreated = null,
  mintAction,
  revokeAction,
}: Props) {
  const router = useRouter();
  const [keys, setKeys] = useState(initial);
  const [name, setName] = useState('');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedKey | null>(initialCreated);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onMint(formData: FormData): void {
    setErrMsg(null);
    startTransition(async () => {
      const error = await mintAction(formData);
      if (error) {
        setErrMsg(error);
        return;
      }
      setName('');
      // Full page refresh picks up flash cookie + new key list
      router.refresh();
    });
  }

  function onRevoke(formData: FormData): void {
    startTransition(async () => {
      await revokeAction(formData);
      const id = String(formData.get('keyId') ?? '');
      setKeys((k) =>
        k.map((x) =>
          x.id === id ? { ...x, enabled: false, revokedAt: new Date().toISOString() } : x,
        ),
      );
      router.refresh();
    });
  }

  const active = keys.filter((k) => !k.revokedAt);
  const showEndpoint = endpoint || 'https://s3.briven.tech';

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          storage keys
        </h3>
        <p className="mt-1 max-w-2xl font-mono text-[11px] text-[var(--color-text-muted)]">
          an S3 key that opens ONLY this project&apos;s bucket — plug it into any S3 tool or app
          code. the secret is shown once; store it safely.
        </p>
      </div>

      {/* Always show where this project stores files */}
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
          project storage connection (for your app&apos;s .env)
        </p>
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-[var(--color-text-muted)]">endpoint</span>
            <CopyField value={showEndpoint} label="endpoint" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-[var(--color-text-muted)]">bucket</span>
            <CopyField value={bucket} label="bucket" />
          </div>
          <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
            access key + secret key come from a key below (create with &quot;new key&quot; if the list
            is empty).
          </p>
        </div>
      </div>

      {created ? (
        <div className="rounded-md border border-[var(--color-primary)] bg-[var(--color-surface-raised)] p-4">
          <p className="font-mono text-xs text-[var(--color-text)]">
            copy these now — the secret key is shown only once. these four are the connection
            details a project or S3 tool needs.
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
        <form
          action={onMint}
          className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input
            type="text"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="key name (e.g. production)"
            maxLength={80}
            className="w-full max-w-xs rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
          >
            {pending ? 'minting…' : 'new key'}
          </button>
          {errMsg ? (
            <span className="w-full font-mono text-[11px] text-[var(--color-error)]">{errMsg}</span>
          ) : (
            <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              leave name empty → key labeled &quot;default&quot;
            </span>
          )}
        </form>
      )}

      {active.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-xs text-[var(--color-text-muted)]">
          no keys yet — click <strong>new key</strong> above to get access + secret for your app.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((k) => (
            <li
              key={k.id}
              className="flex flex-col gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-[var(--color-text)]">{k.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-muted)]">
                    {k.accessKeyId} · •••{k.suffix} ·{' '}
                    {new Date(k.createdAt).toISOString().slice(0, 10)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenId((cur) => (cur === k.id ? null : k.id))}
                    className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-[11px] text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                  >
                    {openId === k.id ? 'hide' : 'view'}
                  </button>
                  <form action={onRevoke}>
                    <input type="hidden" name="keyId" value={k.id} />
                    <button
                      type="submit"
                      disabled={pending}
                      className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-[11px] text-[var(--color-text-muted)] transition hover:border-[var(--color-error)] hover:text-[var(--color-error)] disabled:opacity-50"
                    >
                      revoke
                    </button>
                  </form>
                </div>
              </div>
              {openId === k.id ? (
                <div className="flex flex-col gap-2.5 border-t border-[var(--color-border-subtle)] pt-3">
                  {(
                    [
                      ['endpoint', showEndpoint],
                      ['bucket', k.bucket],
                      ['access key', k.accessKeyId],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex flex-col gap-1">
                      <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                        {label}
                      </span>
                      <CopyField value={value} label={label} />
                    </div>
                  ))}
                  <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
                    the secret key was shown only once at creation and isn&apos;t stored — revoke and
                    mint a new key if you&apos;ve lost it.
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
