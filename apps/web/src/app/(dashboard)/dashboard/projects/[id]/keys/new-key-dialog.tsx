'use client';

import { useState, type FormEvent } from 'react';

interface Props {
  action: (formData: FormData) => Promise<{ plaintext: string }>;
}

export function NewKeyDialog({ action }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await action(new FormData(e.currentTarget));
      setPlaintext(result.plaintext);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setPending(false);
    }
  }

  function close() {
    setOpen(false);
    setPlaintext(null);
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-[var(--color-primary)] px-3 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
      >
        new key
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {plaintext ? (
              <div>
                <h3 className="font-mono text-sm">copy this key now</h3>
                <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
                  this is the only time the plaintext will be shown. store it in a secret manager.
                </p>
                <pre className="mt-4 break-all rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-xs">
                  {plaintext}
                </pre>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(plaintext)}
                    className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    copy
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs font-medium text-[var(--color-text-inverse)]"
                  >
                    done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-busy={pending}>
                <h3 className="font-mono text-sm">new api key</h3>
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-xs text-[var(--color-text-muted)]">name</span>
                  <input
                    name="name"
                    required
                    maxLength={80}
                    placeholder="ci/cd"
                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-xs text-[var(--color-text-muted)]">expires</span>
                  <select
                    name="expiresInDays"
                    defaultValue="never"
                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
                  >
                    <option value="never">never</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                  </select>
                </label>

                {error ? (
                  <p role="alert" className="font-mono text-xs text-red-400">
                    {error}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)]"
                  >
                    cancel
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs font-medium text-[var(--color-text-inverse)] disabled:opacity-50"
                  >
                    {pending ? 'creating...' : 'create'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
