import type { CSSProperties, ReactNode } from 'react';

import { AuthSectionNav } from './auth-section-nav';

const AUTH_SHELL_VARS = {
  ['--auth-accent' as string]: '#e6b800',
  ['--auth-accent-soft' as string]: 'color-mix(in srgb, #e6b800 18%, transparent)',
  ['--auth-accent-border' as string]: 'color-mix(in srgb, #e6b800 45%, var(--color-border))',
} as CSSProperties;

/**
 * Auth product shell — compact tabs (with developer mode), no internal
 * rebuild banners. Yellow accent stays for product identity.
 */
export default function BrivenAuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-auth-shell="true"
      className="flex min-h-0 flex-1 flex-col gap-6"
      style={AUTH_SHELL_VARS}
    >
      <AuthSectionNav />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
