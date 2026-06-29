import type { ReactNode } from 'react';

import { TenantLogo } from './layout-branding';

/**
 * Logo is served by the public branding endpoint — no auth required.
 * Constructed here so the browser fetches it directly through the Next.js
 * rewrite proxy (/api/* → api origin).
 */
function brandingLogoUrl(projectId: string): string {
  return `/api/v1/projects/${projectId}/auth/branding/logo`;
}

/**
 * Load the tenant's primaryColor from the PUBLIC branding-config endpoint
 * (`GET /v1/projects/:id/auth/branding/config`). That route is unauthenticated
 * and returns only non-sensitive presentation fields ({primaryColor, senderName}),
 * so this server-render — which has no admin session — can read the accent
 * colour without hitting the 401-gated admin `/auth/config` endpoint.
 */
async function fetchPrimaryColor(projectId: string): Promise<string | null> {
  const internalOrigin =
    process.env.BRIVEN_API_INTERNAL_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(
      `${internalOrigin}/v1/projects/${projectId}/auth/branding/config`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null; // fall back to the briven default on any error
    const data = (await res.json()) as { primaryColor?: string };
    return data.primaryColor ?? null;
  } catch {
    return null;
  }
}

/**
 * Layout shared by every hosted-pages flow for a single tenant. Pulled
 * out of the dashboard's app-router group so the chrome is minimal —
 * dark theme, brand mark, no nav, single centred card. Live at
 * `<tenant>.auth.briven.tech/<flow>` (or `briven.tech/auth/<projectId>/<flow>`
 * before the subdomain routing lands).
 *
 * Branding: tenant logo is fetched from the public logo endpoint and rendered
 * via TenantLogo (client component, falls back to "briven" text on 404).
 * primaryColor is injected as --color-primary CSS override when available.
 */
export default async function HostedAuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  // Branding: logo URL is always constructable (public endpoint).
  // primaryColor: try the config API; falls back to default on 401/error.
  const [primaryColor] = await Promise.all([fetchPrimaryColor(projectId)]);
  const logoUrl = brandingLogoUrl(projectId);

  // Inject tenant primary colour as a CSS custom property override so
  // buttons, focus rings, and link hovers all pick it up automatically.
  // Falls back gracefully to the root --color-primary when null.
  const colorOverride = primaryColor
    ? ({ '--color-primary': primaryColor } as React.CSSProperties)
    : undefined;

  return (
    <main
      className="flex min-h-screen w-full items-center justify-center bg-[var(--color-bg)] px-4 py-12"
      style={colorOverride}
    >
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex items-center justify-center">
          <TenantLogo logoUrl={logoUrl} />
        </header>
        {children}
        <footer className="text-center font-mono text-[10px] text-[var(--color-text-subtle)]">
          built with{' '}
          <span className="text-[var(--color-primary)]">♥</span> in flanders
        </footer>
      </div>
    </main>
  );
}
