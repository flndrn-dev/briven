import { Suspense } from 'react';

import { fetchAuthCoreInfo } from '../../lib/auth-api';
import { loadAuthV2Workspace } from '../../lib/load-workspace';
import { AuthProvidersClient } from '../../providers/providers-client';

export const metadata = { title: 'Auth · providers' };
export const dynamic = 'force-dynamic';

export default async function AuthProjectProvidersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [projects, info] = await Promise.all([
    loadAuthV2Workspace(),
    fetchAuthCoreInfo(),
  ]);
  const project = projects.find((p) => p.id === projectId);
  const list = project ? [project] : [];

  return (
    <section>
      <header className="mb-6">
        <h2 className="font-mono text-lg tracking-tight text-[var(--color-text)]">
          providers
        </h2>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          methods, SMS (Twilio), and OAuth — this project only
        </p>
      </header>
      <Suspense
        fallback={
          <p className="font-mono text-xs text-[var(--color-text-muted)]">
            loading…
          </p>
        }
      >
        <AuthProvidersClient
          projects={list.length ? list : projects}
          platformMethods={info?.loginMethods ?? []}
          lockProjectId={projectId}
        />
      </Suspense>
    </section>
  );
}
