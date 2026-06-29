import { notFound } from 'next/navigation';

import { HostedFlow } from './hosted-flow';

const FORM_FLOWS = ['sign-in', 'sign-up', 'magic-link', 'otp'] as const;
type FormFlow = (typeof FORM_FLOWS)[number];

function isFormFlow(value: string): value is FormFlow {
  return (FORM_FLOWS as readonly string[]).includes(value);
}

export const dynamic = 'force-dynamic';

/**
 * Server-fetch the project's ENABLED OAuth/OIDC providers from the PUBLIC,
 * unauthenticated branding/config endpoint (same internal-origin pattern as the
 * hosted layout's primaryColor fetch). The hosted page has no admin session, so
 * the admin `/auth/config` is unreachable — this public list is how we render
 * only the buttons that are actually wired. Returns the ordered provider keys
 * plus display labels for the custom-OIDC ones (built-ins self-label).
 */
async function fetchEnabledProviders(
  projectId: string,
): Promise<{ providers: string[]; labels: Record<string, string> }> {
  const internalOrigin = process.env.BRIVEN_API_INTERNAL_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(
      `${internalOrigin}/v1/projects/${projectId}/auth/branding/config`,
      { cache: 'no-store' },
    );
    if (!res.ok) return { providers: [], labels: {} };
    const data = (await res.json()) as {
      socialProviders?: unknown;
      customOidc?: Array<{ id?: unknown; displayName?: unknown }>;
    };
    const providers = Array.isArray(data.socialProviders)
      ? data.socialProviders.filter((p): p is string => typeof p === 'string')
      : [];
    const labels: Record<string, string> = {};
    for (const o of data.customOidc ?? []) {
      if (typeof o.id === 'string' && typeof o.displayName === 'string') {
        labels[o.id] = o.displayName;
      }
    }
    return { providers, labels };
  } catch {
    return { providers: [], labels: {} };
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ flow: string }>;
}) {
  const { flow } = await params;
  if (!isFormFlow(flow)) return { title: 'auth' };
  return { title: `auth · ${flow}` };
}

export default async function HostedFlowPage({
  params,
}: {
  params: Promise<{ projectId: string; flow: string }>;
}) {
  const { projectId, flow } = await params;
  if (!isFormFlow(flow)) notFound();
  const { providers, labels } = await fetchEnabledProviders(projectId);
  return (
    <HostedFlow
      projectId={projectId}
      flow={flow}
      providers={providers}
      providerLabels={labels}
    />
  );
}
