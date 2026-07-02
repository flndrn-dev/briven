import { ShieldCheckIcon } from '@/components/ui/shield-check';
import { TriangleAlertIcon } from '@/components/ui/triangle-alert';

import { apiJson } from '@/lib/api';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { IncidentCreateForm } from './create-form';
import { IncidentRow } from './incident-row';

type Severity = 'critical' | 'major' | 'minor' | 'maintenance';

interface Incident {
  id: string;
  startedAt: string;
  resolvedAt: string | null;
  severity: Severity;
  services: readonly string[];
  summary: string;
  postmortem: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const dynamic = 'force-dynamic';

function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

export default async function AdminIncidentsPage() {
  const { incidents } = await apiJson<{ incidents: Incident[] }>('/v1/admin/incidents').catch(() => ({ incidents: [] as Incident[] }));
  const open = incidents.filter((i) => i.resolvedAt === null);
  const resolved = incidents.filter((i) => i.resolvedAt !== null);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <TriangleAlertIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">incidents</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          operator-published status events. open one when something customer-impacting starts,
          edit the narrative as it unfolds, mark resolved when restored. status page + RSS feed
          read from this list. mutations are step-up-gated per CLAUDE.md §5.4 — the freshness
          pill in the header is the universal re-attest path.
        </p>
      </header>

      <IncidentCreateForm apiOrigin={publicApiOrigin()} />

      <Section title={`ongoing · ${open.length}`} icon={<TriangleAlertIcon size={16} />}>
        {open.length === 0 ? (
          <EmptyState
            icon={<ShieldCheckIcon size={28} />}
            title="nothing ongoing"
            message="the platform looks healthy."
          />
        ) : (
          <ul className="flex flex-col gap-6">
            {open.map((i) => (
              <IncidentRow key={i.id} incident={i} apiOrigin={publicApiOrigin()} />
            ))}
          </ul>
        )}
      </Section>

      <Section title={`resolved · ${resolved.length}`} icon={<ShieldCheckIcon size={16} />}>
        {resolved.length === 0 ? (
          <EmptyState
            icon={<ShieldCheckIcon size={28} />}
            title="no resolved incidents yet"
            message="resolved incidents stay here as the public record."
          />
        ) : (
          <ul className="flex flex-col gap-6">
            {resolved.slice(0, 20).map((i) => (
              <IncidentRow key={i.id} incident={i} apiOrigin={publicApiOrigin()} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
