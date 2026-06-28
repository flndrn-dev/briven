import { apiJson } from '@/lib/api';
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
  const { incidents } = await apiJson<{ incidents: Incident[] }>('/v1/admin/incidents');
  const open = incidents.filter((i) => i.resolvedAt === null);
  const resolved = incidents.filter((i) => i.resolvedAt !== null);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">incidents</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          operator-published status events. open one when something customer-impacting starts,
          edit the narrative as it unfolds, mark resolved when restored. status page + RSS feed
          read from this list. mutations are step-up-gated per CLAUDE.md §5.4 — the freshness
          pill in the header is the universal re-attest path.
        </p>
      </header>

      <IncidentCreateForm apiOrigin={publicApiOrigin()} />

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          ongoing ({open.length})
        </h3>
        {open.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
            nothing ongoing. the platform looks healthy.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {open.map((i) => (
              <IncidentRow key={i.id} incident={i} apiOrigin={publicApiOrigin()} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          resolved ({resolved.length})
        </h3>
        {resolved.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
            no resolved incidents yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {resolved.slice(0, 20).map((i) => (
              <IncidentRow key={i.id} incident={i} apiOrigin={publicApiOrigin()} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
