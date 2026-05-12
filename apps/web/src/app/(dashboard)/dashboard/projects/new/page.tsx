import { redirect } from 'next/navigation';

import { apiFetch, apiJson } from '../../../../../lib/api';

export const metadata = {
  title: 'new project',
};

interface Org {
  id: string;
  slug: string;
  name: string;
  personal: boolean;
}

async function createProject(formData: FormData) {
  'use server';
  const name = String(formData.get('name') ?? '').trim();
  const slug = String(formData.get('slug') ?? '').trim() || undefined;
  const region = String(formData.get('region') ?? '').trim() || undefined;
  const orgId = String(formData.get('orgId') ?? '').trim() || undefined;

  const res = await apiFetch('/v1/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, slug, region, orgId }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`project create failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { project: { id: string } };
  redirect(`/dashboard/projects/${data.project.id}`);
}

export default async function NewProjectPage() {
  // Load every org the user belongs to so they can pick where the
  // project lives. Personal first; teams sorted after.
  const { orgs } = await apiJson<{ orgs: Org[] }>('/v1/me/orgs');
  const sorted = [
    ...orgs.filter((o) => o.personal),
    ...orgs.filter((o) => !o.personal),
  ];

  return (
    <section className="max-w-lg">
      <header className="mb-8">
        <h1 className="font-mono text-xl tracking-tight">new project · new database</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          one project = one postgres schema (your database) + one function runtime. name it
          here, then fill it with tables from the dashboard (studio) or via{' '}
          <code>briven deploy</code> from the CLI.
        </p>
      </header>

      <form action={createProject} className="flex flex-col gap-5">
        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">org</span>
          <select
            name="orgId"
            defaultValue={sorted[0]?.id}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          >
            {sorted.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} {o.personal ? '· personal' : '· team'}
              </option>
            ))}
          </select>
          <span className="font-mono text-[11px] text-[var(--color-text-subtle)]">
            projects belong to an org. members of the org can collaborate; billing rolls up to
            the org. create a team at <em>/dashboard/teams</em> if you need a separate
            workspace from your personal one.
          </span>
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">name</span>
          <input
            name="name"
            type="text"
            required
            maxLength={80}
            placeholder="my app"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            slug{' '}
            <span className="text-[var(--color-text-subtle)]">(optional — generated if blank)</span>
          </span>
          <input
            name="slug"
            type="text"
            pattern="[a-z0-9](?:[a-z0-9\-]{0,30}[a-z0-9])?"
            maxLength={32}
            placeholder="my-app"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">region</span>
          <select
            name="region"
            defaultValue="eu-west-1"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          >
            <option value="eu-west-1">eu-west-1 · frankfurt</option>
            <option value="us-east-1">us-east-1 · virginia</option>
          </select>
        </label>

        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
          >
            create
          </button>
        </div>
      </form>
    </section>
  );
}
