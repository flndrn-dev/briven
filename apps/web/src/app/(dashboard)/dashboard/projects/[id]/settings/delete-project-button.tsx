'use client';

import { useState, useTransition } from 'react';

interface Props {
  projectName: string;
  onDelete: () => Promise<void>;
}

export function DeleteProjectButton({ projectName, onDelete }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState('');

  const matches = confirm === projectName;

  return (
    <details className="font-mono text-xs">
      <summary className="cursor-pointer rounded-md border border-red-400 px-3 py-2 text-red-400">
        delete
      </summary>
      <div className="mt-3 flex flex-col gap-2">
        <p className="text-[var(--color-text-muted)]">
          type <span className="text-[var(--color-text)]">{projectName}</span> to confirm:
        </p>
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.currentTarget.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs"
        />
        <button
          type="button"
          disabled={!matches || pending}
          onClick={() => startTransition(() => onDelete())}
          className="rounded-md bg-red-400 px-3 py-2 font-mono text-xs font-medium text-[var(--color-bg)] disabled:opacity-30"
        >
          {pending ? 'deleting...' : 'permanently delete'}
        </button>
      </div>
    </details>
  );
}
