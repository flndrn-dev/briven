import { notFound } from 'next/navigation';

import { HostedFlow } from './hosted-flow';

const FORM_FLOWS = [
  'sign-in',
  'sign-up',
  'magic-link',
  'otp',
  'new-password',
  'two-factor',
] as const;
type FormFlow = (typeof FORM_FLOWS)[number];

function isFormFlow(value: string): value is FormFlow {
  return (FORM_FLOWS as readonly string[]).includes(value);
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ flow: string }>;
}) {
  const { flow } = await params;
  if (!isFormFlow(flow)) return { title: 'auth' };
  return { title: `auth · ${flow}` };
}

interface PublicConfig {
  primaryColor: string;
  senderName: string;
  socialProviders: string[];
  customOidc: Array<{ id: string; displayName: string }>;
  turnstile: { enabled: boolean; siteKey: string | null };
}

async function fetchPublicConfig(projectId: string): Promise<PublicConfig | null> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? ''}/v1/projects/${projectId}/auth/branding/config`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    return (await res.json()) as PublicConfig;
  } catch {
    return null;
  }
}

export default async function HostedFlowPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; flow: string }>;
  searchParams: Promise<{ callbackURL?: string; token?: string }>;
}) {
  const { projectId, flow } = await params;
  if (!isFormFlow(flow)) notFound();
  const { callbackURL, token } = await searchParams;
  // Default to the hosted account page when no callback is provided.
  const redirectTo = callbackURL || `/auth/${projectId}/account`;
  const publicConfig = await fetchPublicConfig(projectId);
  return (
    <HostedFlow
      projectId={projectId}
      flow={flow}
      callbackURL={redirectTo}
      token={token}
      turnstileSiteKey={publicConfig?.turnstile.enabled ? publicConfig.turnstile.siteKey : null}
    />
  );
}
