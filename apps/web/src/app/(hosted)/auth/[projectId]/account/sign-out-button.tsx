'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  projectId: string;
}

export function SignOutButton({ projectId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut(): Promise<void> {
    setPending(true);
    try {
      await fetch(`/api/v1/auth-tenant/sign-out`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-briven-project-id': projectId },
      });
    } finally {
      router.replace(`/auth/${projectId}/sign-in`);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={pending}
      className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)] disabled:opacity-50"
    >
      {pending ? 'signing out…' : 'sign out'}
    </button>
  );
}
