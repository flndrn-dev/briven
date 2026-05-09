import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError, apiJson } from '../../../../../lib/api';
import { ProjectTabs } from './project-tabs';

interface Project {
  id: string;
  slug: string;
  name: string;
  region: string;
  tier: 'free' | 'pro' | 'team';
}

export const dynamic = 'force-dynamic';

export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;

  let project: Project;
  try {
    const data = await apiJson<{ project: Project }>(`/v1/projects/${id}`);
    project = data.project;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          href="/dashboard/projects"
          className="font-mono text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]"
        >
          ← projects
        </Link>
        <h1 className="mt-2 font-mono text-xl tracking-tight">{project.name}</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          {project.slug} · {project.region} · {project.tier}
        </p>
      </header>
      <ProjectTabs projectId={project.id} />
      <section>{children}</section>
    </div>
  );
}
