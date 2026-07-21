import type { CSSProperties, ReactNode } from 'react';

import { AuthSectionNav } from './auth-section-nav';

const AUTH_SHELL_VARS = {
  // Yellow product strip — “you are in Auth, not Project/DB”
  ['--auth-accent' as string]: '#e6b800',
  ['--auth-accent-soft' as string]: 'color-mix(in srgb, #e6b800 18%, transparent)',
  ['--auth-accent-border' as string]: 'color-mix(in srgb, #e6b800 45%, var(--color-border))',
} as CSSProperties;

/**
 * Briven Auth v2 shell — independent product area (yellow accent).
 * Not the project/DB workspace. User chose Option B: old Auth UI torn down;
 * this section is the only Auth home while the engine is rebuilt.
 */
export default function BrivenAuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-auth-shell="true"
      className="flex min-h-0 flex-1 flex-col gap-6"
      style={AUTH_SHELL_VARS}
    >
      <div
        className="rounded-lg border px-4 py-3 md:px-5"
        style={{
          borderColor: 'var(--auth-accent-border)',
          background:
            'linear-gradient(90deg, var(--auth-accent-soft), transparent 70%)',
          borderLeftWidth: 4,
          borderLeftColor: 'var(--auth-accent)',
        }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--auth-accent)]">
          Briven Auth
        </p>
        <h1 className="mt-1 font-mono text-lg tracking-tight text-[var(--color-text)]">
          authentication
        </h1>
        <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          independent login product for your projects — connected to Briven
          Doltgres. yellow means you left the project/database workspace.
        </p>
      </div>

      <AuthSectionNav />

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
