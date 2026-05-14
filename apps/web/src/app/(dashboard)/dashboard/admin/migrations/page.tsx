import { apiJson } from '../../../../../lib/api';
import { MigrationRequestRow } from './migration-request-row';

export const metadata = { title: 'admin · migrations' };
export const dynamic = 'force-dynamic';

interface AdminRequest {
  id: string;
  userId: string;
  orgId: string | null;
  source: string;
  sourceUrl: string | null;
  sourceNotes: string;
  estimatedTables: number | null;
  estimatedRows: string | null;
  estimatedFunctions: number | null;
  urgency: string;
  status: string;
  contactEmail: string;
  assignedTo: string | null;
  operatorNotes: string;
  createdAt: string;
  updatedAt: string;
}

function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

export default async function AdminMigrationsPage() {
  const { requests } = await apiJson<{ requests: AdminRequest[] }>(
    '/v1/admin/migration-requests?limit=200',
  );

  const open = requests.filter(
    (r) => r.status !== 'completed' && r.status !== 'cancelled',
  );
  const closed = requests.filter(
    (r) => r.status === 'completed' || r.status === 'cancelled',
  );
  const apiOrigin = publicApiOrigin();

  return (
    <section className="flex flex-col gap-8">
      <header>
        <h2 className="font-mono text-lg tracking-tight">migration requests</h2>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          customer-submitted import requests from /dashboard/projects/new/migrate. triage
          newest-first; bump status as you contact / schedule / complete each one.
          status + operator notes mutations require fresh step-up auth.
        </p>
      </header>

      <div>
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          open · {open.length}
        </h3>
        {open.length === 0 ? (
          <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
            no open requests. the queue is clear.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {open.map((r) => (
              <MigrationRequestRow key={r.id} request={r} apiOrigin={apiOrigin} />
            ))}
          </ul>
        )}
      </div>

      {closed.length > 0 ? (
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
            closed · {closed.length}
          </h3>
          <ul className="mt-3 flex flex-col gap-3">
            {closed.map((r) => (
              <MigrationRequestRow key={r.id} request={r} apiOrigin={apiOrigin} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
