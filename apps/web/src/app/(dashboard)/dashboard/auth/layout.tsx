import type { CSSProperties, ReactNode } from 'react';

/**
 * Auth product shell — Butter Yellow accent only (#FFFD74).
 * Tabs live under /dashboard/auth/[projectId] (per project), not on the home grid.
 */
const AUTH_BUTTER = '#FFFD74';

const AUTH_SHELL_VARS = {
  ['--auth-accent' as string]: AUTH_BUTTER,
  ['--auth-accent-soft' as string]: `color-mix(in srgb, ${AUTH_BUTTER} 18%, transparent)`,
  // Full butter yellow — same as buttons / Auth brand (not a muted mix)
  ['--auth-accent-border' as string]: AUTH_BUTTER,
} as CSSProperties;

export default function BrivenAuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-auth-shell="true"
      className="flex min-h-0 flex-1 flex-col gap-6"
      style={AUTH_SHELL_VARS}
    >
      {/*
        Every Auth input/select/textarea uses Butter Yellow borders —
        including focus — so the platform green ring never appears here.
      */}
      <style>{`
        [data-auth-shell] input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]),
        [data-auth-shell] select,
        [data-auth-shell] textarea {
          border-color: ${AUTH_BUTTER} !important;
          outline: none !important;
          box-shadow: none !important;
        }
        [data-auth-shell] input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):focus,
        [data-auth-shell] input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):focus-visible,
        [data-auth-shell] select:focus,
        [data-auth-shell] select:focus-visible,
        [data-auth-shell] textarea:focus,
        [data-auth-shell] textarea:focus-visible {
          border-color: ${AUTH_BUTTER} !important;
          outline: none !important;
          box-shadow: 0 0 0 1px ${AUTH_BUTTER} !important;
        }
      `}</style>
      {children}
    </div>
  );
}
