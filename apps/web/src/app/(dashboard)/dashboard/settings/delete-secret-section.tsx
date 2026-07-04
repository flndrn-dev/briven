'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

interface Props {
  hasDeleteSecret: boolean;
  deleteSecretSetAt: string | null;
  apiOrigin: string;
}

const MASK = '••••••••••••';

/** The four live secret rules, enforced in the UI as the user types. */
function checkRules(secret: string) {
  return {
    length: secret.length >= 12,
    capital: /[A-Z]/.test(secret),
    number: /[0-9]/.test(secret),
    special: /[^A-Za-z0-9]/.test(secret),
  };
}

/** Minimal inline eye toggle to flip a password input to plain text. */
function EyeToggle({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={shown ? 'hide' : 'show'}
      title={shown ? 'hide' : 'show'}
      className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] transition hover:text-[var(--color-text)]"
    >
      {shown ? 'hide' : 'show'}
    </button>
  );
}

/**
 * Account "delete secret" management. The delete secret is a separate
 * credential (not the account password) the api confirms destructive
 * actions against. Two states:
 *  - no secret yet → a CREATE form with live rule checklist + match check.
 *  - secret set → a MASKED panel that can reveal/copy on demand (the
 *    plaintext is never fetched on load — only when the user asks).
 */
export function DeleteSecretSection({ hasDeleteSecret, deleteSecretSetAt, apiOrigin }: Props) {
  if (hasDeleteSecret) {
    return <MaskedPanel deleteSecretSetAt={deleteSecretSetAt} apiOrigin={apiOrigin} />;
  }
  return <CreateForm apiOrigin={apiOrigin} />;
}

function CreateForm({ apiOrigin }: { apiOrigin: string }) {
  const router = useRouter();
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rules = useMemo(() => checkRules(secret), [secret]);
  const allRulesPass = rules.length && rules.capital && rules.number && rules.special;
  const matches = confirm.length > 0 && secret === confirm;
  const canSubmit = allRulesPass && matches && !pending;

  function onSubmit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`${apiOrigin}/v1/me/delete-secret`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ secret }),
        });
        if (res.status === 201) {
          router.refresh();
          return;
        }
        if (res.status === 409) {
          setError('you already have a delete secret');
          return;
        }
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        if (res.status === 400) {
          setError(body?.message || 'that secret is not valid');
          return;
        }
        setError(body?.message || `request failed (${res.status})`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'request failed');
      }
    });
  }

  return (
    <div className="mt-4 flex max-w-md flex-col gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4">
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          delete secret
        </span>
        <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 focus-within:border-[var(--color-primary)]">
          <input
            type={showSecret ? 'text' : 'password'}
            autoComplete="new-password"
            value={secret}
            onChange={(e) => setSecret(e.currentTarget.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none"
          />
          <EyeToggle shown={showSecret} onClick={() => setShowSecret((s) => !s)} />
        </div>
      </label>

      <ul className="flex flex-col gap-1 font-mono text-[11px]">
        <RuleLine ok={rules.length} label="12+ characters" />
        <RuleLine ok={rules.capital} label="a capital letter" />
        <RuleLine ok={rules.number} label="a number" />
        <RuleLine ok={rules.special} label="a special character" />
      </ul>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          confirm
        </span>
        <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 focus-within:border-[var(--color-primary)]">
          <input
            type={showConfirm ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none"
          />
          <EyeToggle shown={showConfirm} onClick={() => setShowConfirm((s) => !s)} />
        </div>
        {confirm.length > 0 ? (
          matches ? (
            <span className="font-mono text-[11px] text-[var(--color-primary)]">match ✓</span>
          ) : (
            <span className="font-mono text-[11px] text-red-400">doesn&apos;t match yet</span>
          )
        ) : null}
      </label>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
        >
          {pending ? 'saving…' : 'save delete secret'}
        </button>
        {error ? (
          <span role="alert" className="text-xs text-red-400">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RuleLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li
      className={ok ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-subtle)]'}
    >
      <span aria-hidden="true">{ok ? '✓' : '✗'}</span> {label}
    </li>
  );
}

function MaskedPanel({
  deleteSecretSetAt,
  apiOrigin,
}: {
  deleteSecretSetAt: string | null;
  apiOrigin: string;
}) {
  const router = useRouter();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, startResetTransition] = useTransition();

  /** Fetch and cache the plaintext secret once; reused by reveal + copy. */
  async function fetchSecret(): Promise<string | null> {
    if (revealed !== null) return revealed;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${apiOrigin}/v1/me/delete-secret/reveal`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 404) {
        setError('no delete secret found');
        return null;
      }
      if (!res.ok) {
        setError(`reveal failed (${res.status})`);
        return null;
      }
      const body = (await res.json()) as { secret: string };
      setRevealed(body.secret);
      return body.secret;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'reveal failed');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onReveal() {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    await fetchSecret();
  }

  async function onCopy() {
    const value = await fetchSecret();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('could not copy to clipboard');
    }
  }

  function onReset() {
    if (!window.confirm('Remove your delete secret? You will need to set a new one.')) return;
    setError(null);
    startResetTransition(async () => {
      try {
        const res = await fetch(`${apiOrigin}/v1/me/delete-secret`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) {
          setError(`reset failed (${res.status})`);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'reset failed');
      }
    });
  }

  const setOn = deleteSecretSetAt ? deleteSecretSetAt.slice(0, 10) : null;

  return (
    <div className="mt-4 flex max-w-md flex-col gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4">
      <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
        <code className="min-w-0 flex-1 break-all font-mono text-sm text-[var(--color-text)]">
          {revealed ?? MASK}
        </code>
        <button
          type="button"
          onClick={onReveal}
          disabled={busy}
          aria-label={revealed ? 'hide' : 'reveal'}
          title={revealed ? 'hide' : 'reveal'}
          className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] transition hover:text-[var(--color-text)] disabled:opacity-40"
        >
          {busy && revealed === null ? '…' : revealed ? 'hide' : 'reveal'}
        </button>
        <button
          type="button"
          onClick={onCopy}
          disabled={busy}
          aria-label={copied ? 'copied' : 'copy'}
          title={copied ? 'copied!' : 'copy'}
          className="inline-flex shrink-0 items-center rounded-md p-1 text-[var(--color-text-subtle)] transition hover:text-[var(--color-text)] disabled:opacity-40"
        >
          {copied ? (
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-[var(--color-primary)]"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="8" y="8" width="14" height="14" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
          )}
        </button>
      </div>

      {setOn ? (
        <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">set on {setOn}</p>
      ) : null}

      {error ? (
        <span role="alert" className="text-xs text-red-400">
          {error}
        </span>
      ) : null}

      <button
        type="button"
        onClick={onReset}
        disabled={resetting}
        className="self-start font-mono text-[10px] text-[var(--color-text-subtle)] underline transition hover:text-[var(--color-text)] disabled:opacity-40"
      >
        {resetting ? 'resetting…' : 'reset'}
      </button>
    </div>
  );
}
