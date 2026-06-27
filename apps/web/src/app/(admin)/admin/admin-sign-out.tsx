'use client';

import { useState } from 'react';

/**
 * Reuses the existing Better Auth sign-out endpoint via the same-origin
 * /api/* rewrite (identical mechanism to the dashboard SignOutButton).
 * Lands the operator back on the cockpit login.
 */
export function AdminSignOut() {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      await fetch('/api/v1/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      window.location.href = '/admin/login';
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] disabled:opacity-50"
    >
      {pending ? 'signing out...' : 'sign out'}
    </button>
  );
}
