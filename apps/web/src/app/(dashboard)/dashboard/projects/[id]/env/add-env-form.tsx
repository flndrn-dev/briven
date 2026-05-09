'use client';

import { useState, type FormEvent } from 'react';

interface Props {
  action: (formData: FormData) => Promise<void>;
}

export function AddEnvForm({ action }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = e.currentTarget;
    try {
      await action(new FormData(form));
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'add failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4"
    >
      <div className="flex gap-2">
        <input
          name="key"
          required
          placeholder="KEY_NAME"
          pattern="[A-Z_][A-Z0-9_]{0,63}"
          className="w-1/3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-sm uppercase outline-none focus:border-[var(--color-primary)]"
        />
        <input
          name="value"
          required
          type="password"
          autoComplete="new-password"
          placeholder="value (never shown again)"
          className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-4 font-mono text-sm font-medium text-[var(--color-text-inverse)] disabled:opacity-50"
        >
          {pending ? 'saving...' : 'save'}
        </button>
      </div>
      <p className="font-mono text-xs text-[var(--color-text-subtle)]">
        uppercase letters, digits, underscores. existing key = update in place.
      </p>
      {error ? (
        <p role="alert" className="font-mono text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
