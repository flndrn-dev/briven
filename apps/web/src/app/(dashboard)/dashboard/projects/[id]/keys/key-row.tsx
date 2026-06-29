'use client';

import { useState, useTransition } from 'react';

import { toValidDate } from '@/lib/utils';
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

interface Props {
  apiKey: ApiKey;
  onRevoke: (keyId: string) => Promise<void>;
  onRename: (keyId: string, name: string) => Promise<void>;
}

/**
 * A single active API-key row with inline rename. The secret itself is
 * never re-displayable (hashed at rest), so the only editable field is
 * the human-readable name.
 */
export function KeyRow({ apiKey, onRevoke, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(apiKey.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === apiKey.name) {
      setEditing(false);
      setName(apiKey.name);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onRename(apiKey.id, trimmed);
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'rename failed');
      }
    });
  }

  function cancel() {
    setEditing(false);
    setName(apiKey.name);
    setError(null);
  }

  // Compute expiry state for the inline pill. Soft warning at <=7d,
  // hard warning when already past the expires_at timestamp (the api
  // already rejects requests with such keys; the dashboard shows them
  // explicitly so the operator notices + revokes/replaces).
  const expiryState = expiryStateFor(apiKey.expiresAt);

  return (
    <li className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3">
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') cancel();
              }}
              maxLength={80}
              disabled={pending}
              className="max-w-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 font-mono text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-50"
            />
            <button
              type="button"
              disabled={pending}
              onClick={save}
              className="rounded-md bg-[var(--color-primary)] px-2 py-1 font-mono text-xs font-medium text-[var(--color-text-inverse)] disabled:opacity-50"
            >
              {pending ? 'saving...' : 'save'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={cancel}
              className="font-mono text-xs text-[var(--color-text-muted)]"
            >
              cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="click to rename"
              className="text-left font-mono text-sm hover:text-[var(--color-primary)]"
            >
              {apiKey.name}
            </button>
            {expiryState ? <ExpiryPill state={expiryState} /> : null}
          </div>
        )}
        <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
          brk_•••{apiKey.suffix} · created{' '}
          {toValidDate(apiKey.createdAt)?.toISOString().slice(0, 10) ?? '—'}
          {toValidDate(apiKey.lastUsedAt)
            ? ` · last used ${toValidDate(apiKey.lastUsedAt)!.toISOString().slice(0, 10)}`
            : ' · never used'}
          {toValidDate(apiKey.expiresAt)
            ? ` · expires ${toValidDate(apiKey.expiresAt)!.toISOString().slice(0, 10)}`
            : null}
        </p>
        {error ? (
          <p role="alert" className="mt-1 font-mono text-xs text-red-400">
            {error}
          </p>
        ) : null}
      </div>
      <RevokeButton keyId={apiKey.id} onRevoke={onRevoke} />
    </li>
  );
}

type ExpiryState =
  | { kind: 'expired'; daysAgo: number }
  | { kind: 'expiring'; daysLeft: number };

function expiryStateFor(expiresAt: string | null): ExpiryState | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (days < 0) return { kind: 'expired', daysAgo: -days };
  if (days <= 7) return { kind: 'expiring', daysLeft: days };
  return null;
}

function ExpiryPill({ state }: { state: ExpiryState }) {
  if (state.kind === 'expired') {
    return (
      <span
        title="this key is past its expires_at and is rejected by the api — revoke and replace"
        className="rounded-full border border-[var(--color-error)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-error)]"
      >
        expired · {state.daysAgo}d ago
      </span>
    );
  }
  return (
    <span
      title="this key expires within 7 days — rotate before it does to avoid an interruption"
      className="rounded-full border border-[var(--color-warning)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-warning)]"
    >
      expires in {state.daysLeft}d
    </span>
  );
}
