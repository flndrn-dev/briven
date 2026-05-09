'use client';

import { useEffect, useState } from 'react';

import { PMS, type Pm, type PmBlock } from '../lib/pm';

const STORAGE_KEY = 'briven.docs.pm';
const PM_CHANGE_EVENT = 'briven:pm-change';

/**
 * Tabbed code block that shows the same command expressed in each supported
 * package manager (npm / pnpm / yarn / bun). The user's choice is persisted
 * in localStorage and broadcast to every other PmTabs on the page so the
 * whole doc switches together.
 */
export function PmTabs({ commands }: { commands: PmBlock }) {
  const [pm, setPm] = useState<Pm>('npm');

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isPm(saved)) setPm(saved);
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<Pm>).detail;
      if (isPm(next)) setPm(next);
    };
    window.addEventListener(PM_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(PM_CHANGE_EVENT, onChange);
  }, []);

  function select(next: Pm) {
    setPm(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent<Pm>(PM_CHANGE_EVENT, { detail: next }));
  }

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div
        role="tablist"
        aria-label="package manager"
        className="flex border-b border-[var(--color-border)]"
      >
        {PMS.map((p) => {
          const active = p === pm;
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => select(p)}
              className={`cursor-pointer px-3 py-1.5 font-mono text-xs transition-colors ${
                active
                  ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs text-[var(--color-text)]">
        {commands[pm]}
      </pre>
    </div>
  );
}

function isPm(v: unknown): v is Pm {
  return v === 'npm' || v === 'pnpm' || v === 'yarn' || v === 'bun';
}
