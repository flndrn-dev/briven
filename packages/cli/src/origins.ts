/**
 * Shared control-plane + dashboard origins for the CLI.
 * Override with BRIVEN_API_ORIGIN / BRIVEN_DASHBOARD_ORIGIN for self-host.
 */

export const DEFAULT_API_ORIGIN = 'https://api.briven.tech';
export const DEFAULT_DASHBOARD_ORIGIN = 'https://app.briven.tech';

export interface Origins {
  apiOrigin: string;
  dashboardOrigin: string;
}

export function resolveOrigins(overrides?: {
  apiOrigin?: string;
  dashboardOrigin?: string;
}): Origins {
  return {
    apiOrigin:
      overrides?.apiOrigin ??
      process.env.BRIVEN_API_ORIGIN ??
      DEFAULT_API_ORIGIN,
    dashboardOrigin:
      overrides?.dashboardOrigin ??
      process.env.BRIVEN_DASHBOARD_ORIGIN ??
      DEFAULT_DASHBOARD_ORIGIN,
  };
}
