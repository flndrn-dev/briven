import { revalidatePath } from 'next/cache';

import { ProfileBillingForm } from '../../../../../../components/profile-billing-form';
import { apiFetch, apiJson } from '../../../../../../lib/api';
import { requireUser } from '../../../../../../lib/session';
import { DeleteProjectButton } from './delete-project-button';
import { ProjectGeneralForm } from './project-general-form';

interface Project {
  id: string;
  name: string;
  slug: string;
  orgId: string;
}

interface Org {
  id: string;
  name: string;
  personal: boolean;
}

type SaveResult = { ok: true } | { ok: false; error: string };

export const dynamic = 'force-dynamic';

function readApiMessage(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) return parsed.message;
  } catch {
    // body wasn't JSON — fall through to raw text
  }
  return body || fallback;
}

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, { project }, { orgs }] = await Promise.all([
    requireUser(),
    apiJson<{ project: Project }>(`/v1/projects/${id}`),
    apiJson<{ orgs: Org[] }>('/v1/me/orgs').catch(() => ({ orgs: [] as Org[] })),
  ]);
  const otherOrgs = orgs.filter((o) => o.id !== project.orgId);

  async function update(patch: { name?: string; slug?: string }): Promise<SaveResult> {
    'use server';
    const { id } = await params;
    const res = await apiFetch(`/v1/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: readApiMessage(body, `update failed: ${res.status}`) };
    }
    revalidatePath(`/dashboard/projects/${id}`);
    return { ok: true };
  }

  async function moveProject(orgId: string): Promise<SaveResult> {
    'use server';
    const { id } = await params;
    if (!orgId) return { ok: false, error: 'orgId is required' };
    const res = await apiFetch(`/v1/projects/${id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: readApiMessage(body, `move failed: ${res.status}`) };
    }
    revalidatePath(`/dashboard/projects/${id}`);
    return { ok: true };
  }

  async function saveProfile(
    patch: Record<string, string | null>,
  ): Promise<SaveResult> {
    'use server';
    const res = await apiFetch('/v1/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: readApiMessage(body, `update failed: ${res.status}`) };
    }
    revalidatePath(`/dashboard/projects/${id}/settings`);
    return { ok: true };
  }

  return (
    <div className="flex flex-col gap-8">
      <ProjectGeneralForm
        initial={{ name: project.name, slug: project.slug }}
        update={update}
        moveProject={moveProject}
        otherOrgs={otherOrgs}
      />

      <section>
        <ProfileBillingForm
          initial={{
            name: user.name ?? '',
            legalName: user.legalName ?? '',
            companyName: user.companyName ?? '',
            companyRegistrationNumber: user.companyRegistrationNumber ?? '',
            vatId: user.vatId ?? '',
            addressLine1: user.addressLine1 ?? '',
            addressLine2: user.addressLine2 ?? '',
            addressCity: user.addressCity ?? '',
            addressPostalCode: user.addressPostalCode ?? '',
            addressRegion: user.addressRegion ?? '',
            addressCountry: user.addressCountry ?? '',
            dateOfBirth: user.dateOfBirth ?? '',
            countryOfBirth: user.countryOfBirth ?? '',
            timezone: user.timezone ?? '',
          }}
          currentImage={user.image}
          displayName={user.legalName ?? user.name ?? user.email}
          vatLocked={Boolean(user.vatVerifiedAt && user.vatId)}
          save={saveProfile}
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-red-400">Danger zone</h3>
        <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-red-400/30 bg-red-400/5 p-5">
          <div>
            <p className="text-sm text-[var(--color-text)]">Delete this project</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Soft-deletes the project. The schema and data are retained for 30 days before hard
              deletion, per <code className="text-[var(--color-text)]">CLAUDE.md §5.5</code>.
            </p>
          </div>
          <DeleteProjectButton
            projectId={id}
            projectName={project.name}
            apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
            hasDeleteSecret={user.hasDeleteSecret}
          />
        </div>
      </section>
    </div>
  );
}
