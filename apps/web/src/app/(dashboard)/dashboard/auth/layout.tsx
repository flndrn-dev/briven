import type { CSSProperties, ReactNode } from 'react';

import { AuthSectionNav } from './auth-section-nav';

/**
 * Auth product shell — yellow accent + section tabs (projects-style).
 */
const AUTH_SHELL_VARS = {
  ['--auth-accent' as string]: '#FFFD74',
  ['--auth-accent-soft' as string]: 'color-mix(in srgb, #FFFD74 18%, transparent)',
  ['--auth-accent-border' as string]: 'color-mix(in srgb, #FFFD74 45%, var(--color-border))',
} as CSSProperties;

export default function BrivenAuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-auth-shell="true"
      className="flex min-h-0 flex-1 flex-col gap-6"
      style={AUTH_SHELL_VARS}
    >
      <AuthSectionNav />
      {children}
    </div>
  );
}
