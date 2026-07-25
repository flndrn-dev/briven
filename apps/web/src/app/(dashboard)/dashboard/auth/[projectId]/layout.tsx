import Link from 'next/link';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { loadAuthV2Workspace } from '../lib/load-workspace';
import { AuthProjectNav } from './auth-project-nav';

export const dynamic = 'force-dynamic';

/**
 * Per-project Auth shell — same header + tabs pattern as Projects:
 *   ← Auth
 *   {name}
 *   {slug} · Auth on|off
 *   [tabs…]                    [↗ developer mode]
 */
export default async function AuthProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const developerMode =
    (await cookies()).get('briven_auth_project_dev')?.value === '1';
  const projects = await loadAuthV2Workspace();
  const project = projects.find(
    (p) => p.id === projectId || p.id.toLowerCase() === projectId.toLowerCase(),
  );
  if (!project) {
    notFound();
  }

  // Trust workspace flag; layout badge only (page may re-check enable).
  const authOn = project.authEnabled === true;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          href="/dashboard/auth"
          className="font-mono text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]"
        >
          ← Auth
        </Link>
        <h1 className="mt-2 font-mono text-xl tracking-tight text-[var(--color-text)]">
          {project.name}
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          {project.slug}
          {' · '}
          {authOn ? (
            <span style={{ color: 'var(--auth-accent, #FFFD74)' }}>Auth on</span>
          ) : (
            <span>Auth off</span>
          )}
        </p>
      </header>
      <AuthProjectNav projectId={project.id} developerMode={developerMode} />
      <section>{children}</section>
    </div>
  );
}
