'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { RowDeleteProjectButton } from './row-delete-project-button';

interface Project {
  id: string;
  slug: string;
  name: string;
  region: string;
  tier: 'free' | 'pro' | 'team';
  createdAt: string;
  orgName: string | null;
  orgPersonal: boolean | null;
}

/**
 * Client-side filterable projects list. Server fetches every project the
 * user can see; this component lets them narrow by name/slug or by org.
 * Kept client-side because the dataset is already capped at "everything
 * the user can access" — no point paginating server-side.
 */
export function ProjectsList({
  projects,
  apiOrigin,
}: {
  projects: Project[];
  apiOrigin: string;
}) {
  const [q, setQ] = useState('');
  const [orgFilter, setOrgFilter] = useState<string>('');

  const orgs = useMemo(() => {
    const set = new Map<string, { name: string; personal: boolean }>();
    for (const p of projects) {
      if (p.orgName && !set.has(p.orgName)) {
        set.set(p.orgName, { name: p.orgName, personal: p.orgPersonal ?? false });
      }
    }
    return Array.from(set.values()).sort((a, b) => {
      if (a.personal !== b.personal) return a.personal ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [projects]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects.filter((p) => {
      if (orgFilter && p.orgName !== orgFilter) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle)
        || p.slug.toLowerCase().includes(needle)
        || p.id.toLowerCase().includes(needle)
      );
    });
  }, [projects, q, orgFilter]);

  return (
    <div className="flex flex-col gap-3">
      {projects.length > 5 || orgs.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter by name / slug / id"
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[var(--color-primary)]"
          />
          {orgs.length > 1 ? (
            <select
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[var(--color-primary)]"
            >
              <option value="">all orgs</option>
              {orgs.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.name} {o.personal ? '· personal' : '· team'}
                </option>
              ))}
            </select>
          ) : null}
          {q || orgFilter ? (
            <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              {filtered.length} of {projects.length}
            </span>
          ) : null}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center font-mono text-xs text-[var(--color-text-muted)]">
          no projects match that filter.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((p) => (
            <li
              key={p.id}
              className="group flex items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] pr-2 transition hover:border-[var(--color-border)]"
            >
              <Link
                href={`/dashboard/projects/${p.id}`}
                className="flex flex-1 items-center justify-between px-4 py-3"
              >
                <div>
                  <p className="font-mono text-sm">{p.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                    {p.slug} · {p.region} · {p.tier}
                    {p.orgName ? (
                      <span>
                        {' · '}
                        <span className="text-[var(--color-text-muted)]">
                          {p.orgName}
                          {p.orgPersonal ? '' : ' (team)'}
                        </span>
                      </span>
                    ) : null}
                  </p>
                </div>
                <span className="font-mono text-xs text-[var(--color-text-subtle)]">
                  {new Date(p.createdAt).toISOString().slice(0, 10)}
                </span>
              </Link>
              <RowDeleteProjectButton
                projectId={p.id}
                projectName={p.name}
                apiOrigin={apiOrigin}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
