'use client';

import { useState } from 'react';

interface Props {
  /** Absolute URL for the tenant's logo image, or null if none is set. */
  logoUrl: string | null;
  /** Display name used as aria-label and alt text. */
  tenantName?: string;
}

/**
 * Renders the tenant's logo in the hosted auth header, falling back to
 * the "briven" wordmark if the img fails to load or no logoUrl is set.
 *
 * Client component because `onError` is a browser event handler.
 */
export function TenantLogo({ logoUrl, tenantName = 'briven' }: Props) {
  const [failed, setFailed] = useState(false);

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={tenantName}
        onError={() => setFailed(true)}
        className="max-h-8 max-w-[140px] object-contain"
      />
    );
  }

  // Fallback: wordmark matching the original layout style
  return (
    <span className="font-mono text-lg tracking-tight text-[var(--color-text)]">
      {tenantName}
    </span>
  );
}
