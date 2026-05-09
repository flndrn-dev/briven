'use client';

import { useState } from 'react';

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      await fetch('/api/v1/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      window.location.href = '/signin';
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:opacity-50"
    >
      {pending ? 'signing out...' : 'sign out'}
    </button>
  );
}
