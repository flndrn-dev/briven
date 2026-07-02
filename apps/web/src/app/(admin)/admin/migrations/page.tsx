import Link from 'next/link';

import { ArrowLeftRightIcon } from '@/components/ui/arrow-left-right';
import { DatabaseIcon } from '@/components/ui/database';

import { apiJson } from '@/lib/api';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { MigrationRequestRow } from './migration-request-row';

export const metadata = { title: 'admin · migrations' };
export const dynamic = 'force-dynamic';

interface AdminRequest {
  id: string;
  userId: string | null;
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
  ).catch(() => ({ requests: [] as AdminRequest[] }));

  const open = requests.filter(
    (r) => r.status !== 'completed' && r.status !== 'cancelled',
  );
  const closed = requests.filter(
    (r) => r.status === 'completed' || r.status === 'cancelled',
  );
  const apiOrigin = publicApiOrigin();

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <ArrowLeftRightIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">migration requests</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          customer-submitted import requests from /dashboard/projects/new/migrate. triage
          newest-first; bump status as you contact / schedule / complete each one.
          status + operator notes mutations require fresh step-up auth.
        </p>
      </header>

      <Section
        title={`open · ${open.length}`}
        icon={<ArrowLeftRightIcon size={16} />}
        right={
          <Link
            href="/admin/migrations/funnel"
            className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] transition hover:text-[var(--color-text-link)]"
          >
            funnel →
          </Link>
        }
      >
        {open.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRightIcon size={28} />}
            title="no open requests"
            message="the queue is clear."
          />
        ) : (
          <ul className="flex flex-col gap-6">
            {open.map((r) => (
              <MigrationRequestRow key={r.id} request={r} apiOrigin={apiOrigin} />
            ))}
          </ul>
        )}
      </Section>

      {closed.length > 0 ? (
        <Section title={`closed · ${closed.length}`} icon={<DatabaseIcon size={16} />}>
          <ul className="flex flex-col gap-6">
            {closed.map((r) => (
              <MigrationRequestRow key={r.id} request={r} apiOrigin={apiOrigin} />
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
