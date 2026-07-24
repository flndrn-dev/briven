import { ConsentClient } from './consent-client';

export const metadata = { title: 'Allow app · Briven Auth' };
export const dynamic = 'force-dynamic';

/**
 * Production OIDC consent — user allows (or denies) a registered app.
 * Linked from GET /v1/auth-core/oidc/authorize after login.
 */
export default async function OAuthConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ challenge?: string }>;
}) {
  const { projectId } = await params;
  const { challenge } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4 py-12">
      <ConsentClient projectId={projectId} challenge={challenge ?? ''} />
    </div>
  );
}
