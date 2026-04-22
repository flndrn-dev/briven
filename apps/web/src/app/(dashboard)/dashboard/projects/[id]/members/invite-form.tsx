'use client';

import { useState, type FormEvent } from 'react';

interface Props {
  action: (formData: FormData) => Promise<void>;
}

export function InviteForm({ action }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSent(false);
    const form = e.currentTarget;
    try {
      await action(new FormData(form));
      form.reset();
      setSent(true);
      setTimeout(() => setSent(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'invite failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="email"
          className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
        />
        <select
          name="role"
          defaultValue="developer"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-sm"
        >
          <option value="admin">admin</option>
          <option value="developer">developer</option>
          <option value="viewer">viewer</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-4 font-mono text-sm font-medium text-[var(--color-text-inverse)] disabled:opacity-50"
        >
          {pending ? 'sending...' : 'send invite'}
        </button>
      </div>
      {sent ? (
        <p className="font-mono text-xs text-[var(--color-primary)]">invite sent ✓</p>
      ) : null}
      {error ? (
        <p role="alert" className="font-mono text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
