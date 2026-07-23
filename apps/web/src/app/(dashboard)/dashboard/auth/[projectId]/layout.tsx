import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { loadAuthV2Workspace } from '../lib/load-workspace';
import { AuthProjectNav } from './auth-project-nav';

export const dynamic = 'force-dynamic';

/**
 * Per-project Auth shell: title + tabs (users, sessions, keys, …).
 */
export default async function AuthProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
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
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
          <Link href="/dashboard/auth" className="hover:underline">
            Auth
          </Link>
          {' · '}
          project
        </p>
        <h1 className="mt-1 font-mono text-xl tracking-tight text-[var(--color-text)]">
          {project.name}
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          {project.slug}
          {authOn ? (
            <span style={{ color: 'var(--auth-accent, #FFFD74)' }}>
              {' · '}
              Auth on
            </span>
          ) : (
            <span>
              {' · '}
              Auth off
            </span>
          )}
          {project.tenantId ? (
            <span className="text-[var(--color-text-subtle)]">
              {' · '}
              {project.tenantId}
            </span>
          ) : null}
        </p>
      </header>
      <AuthProjectNav projectId={project.id} />
      {children}
    </div>
  );
}
