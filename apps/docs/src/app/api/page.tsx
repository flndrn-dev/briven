import { DocsShell } from '../../components/shell';

export const metadata = { title: 'http api' };

interface Endpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  path: string;
  summary: string;
}

interface Section {
  title: string;
  intro: string;
  endpoints: Endpoint[];
}

const SECTIONS: readonly Section[] = [
  {
    title: 'invoke',
    intro:
      'Call a deployed function. Auth: project API key (brk_…) in Authorization: Bearer header.',
    endpoints: [
      {
        method: 'POST',
        path: '/v1/projects/:id/invoke',
        summary:
          'Body: { function: string, args?: unknown }. Returns { result, durationMs } or { error }. Counts against your project\'s monthly invocation cap.',
      },
    ],
  },
  {
    title: 'realtime',
    intro:
      'Subscribe to reactive queries over WebSocket. SDK clients (@briven/react / svelte / vue) wrap this.',
    endpoints: [
      {
        method: 'GET',
        path: '/v1/projects/:id/realtime',
        summary:
          'WSS upgrade. Send { type: "subscribe", function, args }, receive frames as the underlying rows change. Auth: project API key.',
      },
    ],
  },
  {
    title: 'projects',
    intro: 'Project CRUD. Auth: dashboard session cookie.',
    endpoints: [
      { method: 'GET', path: '/v1/projects', summary: 'List every project the caller can see.' },
      {
        method: 'POST',
        path: '/v1/projects',
        summary:
          'Body: { name, slug?, region?, orgId? }. Creates a fresh schema + runtime under the named org (defaults to your personal org).',
      },
      { method: 'GET', path: '/v1/projects/:id', summary: 'Project details.' },
      {
        method: 'PATCH',
        path: '/v1/projects/:id',
        summary: 'Body: { name?, slug? }. Rename a project.',
      },
      {
        method: 'POST',
        path: '/v1/projects/:id/move',
        summary:
          'Body: { orgId }. Re-parent to a different org (you must be a member of both).',
      },
      {
        method: 'DELETE',
        path: '/v1/projects/:id',
        summary:
          'Soft-delete. The schema and data are retained for 30 days before hard deletion.',
      },
    ],
  },
  {
    title: 'deployments',
    intro: 'Bundle uploads + history. Auth: project API key (POST) or session (GET).',
    endpoints: [
      {
        method: 'POST',
        path: '/v1/projects/:id/deployments',
        summary:
          'Upload a schema + functions bundle. Body: multipart form with bundle.tar.gz. Server diffs against the live schema, generates a migration, applies transactionally.',
      },
      {
        method: 'GET',
        path: '/v1/projects/:id/deployments',
        summary: 'List recent deployments with their status + schema diff summary.',
      },
      {
        method: 'GET',
        path: '/v1/projects/:id/deployments/:deploymentId',
        summary: 'Deployment detail including error code/message if it failed.',
      },
      {
        method: 'POST',
        path: '/v1/projects/:id/deployments/:deploymentId/cancel',
        summary: 'Cancel a pending or running deployment.',
      },
    ],
  },
  {
    title: 'studio',
    intro:
      'Dashboard data browser + DDL surface. Auth: dashboard session, admin role on the project.',
    endpoints: [
      { method: 'GET', path: '/v1/projects/:id/studio/tables', summary: 'List user tables.' },
      {
        method: 'POST',
        path: '/v1/projects/:id/studio/tables',
        summary:
          'Body: { tableName, columns: [{ name, type, notNull?, primaryKey?, defaultExpr?, references? }] }. CREATE TABLE.',
      },
      {
        method: 'PATCH',
        path: '/v1/projects/:id/studio/tables/:table',
        summary: 'Body: { newName }. Rename a table.',
      },
      {
        method: 'POST',
        path: '/v1/projects/:id/studio/tables/:table/truncate',
        summary: 'Body: { cascade? }. TRUNCATE TABLE … RESTART IDENTITY.',
      },
      {
        method: 'DELETE',
        path: '/v1/projects/:id/studio/tables/:table',
        summary: 'DROP TABLE.',
      },
      {
        method: 'GET',
        path: '/v1/projects/:id/studio/tables/:table/columns',
        summary: 'Per-column metadata with PK + FK target.',
      },
      {
        method: 'POST',
        path: '/v1/projects/:id/studio/tables/:table/columns',
        summary: 'Body: { column: { name, type, notNull?, defaultExpr?, references? } }. ADD COLUMN.',
      },
      {
        method: 'PATCH',
        path: '/v1/projects/:id/studio/tables/:table/columns/:column',
        summary:
          'Two-mode: { newName } to rename, or { notNull?, defaultExpr? } to alter nullability / default.',
      },
      {
        method: 'DELETE',
        path: '/v1/projects/:id/studio/tables/:table/columns/:column',
        summary: 'DROP COLUMN.',
      },
      {
        method: 'GET',
        path: '/v1/projects/:id/studio/tables/:table/indexes',
        summary: 'List indexes on a table.',
      },
      {
        method: 'POST',
        path: '/v1/projects/:id/studio/tables/:table/indexes',
        summary: 'Body: { columns: string[], unique?, name? }. CREATE INDEX.',
      },
      {
        method: 'DELETE',
        path: '/v1/projects/:id/studio/tables/:table/indexes/:name',
        summary: 'DROP INDEX (refuses the primary-key index).',
      },
      {
        method: 'GET',
        path: '/v1/projects/:id/studio/tables/:table/rows',
        summary:
          'Paginated rows. Query: limit, offset, orderBy + dir, and per-column <col>__eq=value filters.',
      },
      {
        method: 'POST',
        path: '/v1/projects/:id/studio/tables/:table/rows',
        summary: 'Body: { values: { col: value, … } }. Insert a row.',
      },
      {
        method: 'PATCH',
        path: '/v1/projects/:id/studio/tables/:table/rows',
        summary:
          'Body: { primaryKeyColumn, primaryKeyValue, column, value }. Update a single cell.',
      },
      {
        method: 'DELETE',
        path: '/v1/projects/:id/studio/tables/:table/rows',
        summary: 'Body: { primaryKeyColumn, primaryKeyValue }. Delete a row.',
      },
      {
        method: 'POST',
        path: '/v1/projects/:id/studio/query',
        summary:
          'Body: { sql }. Run arbitrary SQL scoped to the project owner role. 5s statement_timeout. Audit-logged.',
      },
      {
        method: 'GET',
        path: '/v1/projects/:id/studio/schema',
        summary: 'One-shot read of every table + columns + FK edges.',
      },
      {
        method: 'GET',
        path: '/v1/projects/:id/studio/schema.ts',
        summary:
          'Generates the equivalent briven/schema.ts so a dashboard-built database can graduate to git + CLI.',
      },
      {
        method: 'GET',
        path: '/v1/projects/:id/studio/relationships',
        summary: 'Every FK edge in the schema (used by the studio overview).',
      },
    ],
  },
  {
    title: 'logs + stats',
    intro: 'Function invocation history. Auth: dashboard session.',
    endpoints: [
      {
        method: 'GET',
        path: '/v1/projects/:id/function-logs',
        summary: 'Query: function, status (ok|err), before (cursor), limit.',
      },
      {
        method: 'GET',
        path: '/v1/projects/:id/function-names',
        summary: 'Distinct function names actually called in this project.',
      },
      {
        method: 'GET',
        path: '/v1/projects/:id/function-stats',
        summary:
          'Query: function (required), hours (default 24). Returns count + errCount + p50Ms + p99Ms.',
      },
      {
        method: 'GET',
        path: '/v1/projects/:id/hourly-invocations',
        summary: '24-hour series of invocation counts per hour (used by the project sparkline).',
      },
      {
        method: 'GET',
        path: '/v1/projects/:id/logs/stream',
        summary: 'SSE stream of new invocations as they arrive.',
      },
    ],
  },
  {
    title: 'usage',
    intro: 'Metering. Auth: project API key or session.',
    endpoints: [
      {
        method: 'GET',
        path: '/v1/projects/:id/usage',
        summary: 'Current period: invocations.count + totalDurationMs, storage.bytes, limits.',
      },
    ],
  },
  {
    title: 'api keys',
    intro: 'Per-project deploy / invoke keys.',
    endpoints: [
      { method: 'GET', path: '/v1/projects/:id/api-keys', summary: 'List keys (hashes only).' },
      {
        method: 'POST',
        path: '/v1/projects/:id/api-keys',
        summary:
          'Body: { name, scope }. Returns the plaintext key once — record it then; never retrievable again.',
      },
      {
        method: 'PATCH',
        path: '/v1/projects/:id/api-keys/:keyId',
        summary: 'Rename a key.',
      },
      {
        method: 'DELETE',
        path: '/v1/projects/:id/api-keys/:keyId',
        summary: 'Revoke a key.',
      },
    ],
  },
  {
    title: 'project members + invitations',
    intro: 'Per-project access control (separate from org membership).',
    endpoints: [
      {
        method: 'GET',
        path: '/v1/projects/:id/members',
        summary: 'List members + roles.',
      },
      {
        method: 'POST',
        path: '/v1/projects/:id/invitations',
        summary: 'Body: { email, role, callbackURL }. Sends an email with a one-time accept link.',
      },
      {
        method: 'GET',
        path: '/v1/me/invitations',
        summary: 'Pending project invitations for the signed-in user.',
      },
      {
        method: 'POST',
        path: '/v1/me/invitations/accept',
        summary: 'Body: { token }. Accept by token from the email link.',
      },
    ],
  },
  {
    title: 'orgs (teams)',
    intro: 'Multi-org workspace. Personal org is auto-created on signup.',
    endpoints: [
      { method: 'GET', path: '/v1/me/orgs', summary: 'Every org the caller belongs to.' },
      {
        method: 'POST',
        path: '/v1/orgs',
        summary:
          'Body: { name, slug? }. Create a team org (paid tiers only — free tier caps at the personal org).',
      },
      {
        method: 'PATCH',
        path: '/v1/orgs/:id',
        summary: 'Body: { name }. Rename a team org.',
      },
      {
        method: 'DELETE',
        path: '/v1/orgs/:id',
        summary:
          'Soft-delete a team org. Refuses while live projects still belong to it; move or delete them first.',
      },
      {
        method: 'GET',
        path: '/v1/orgs/:id/members',
        summary: 'List org members with roles.',
      },
      {
        method: 'PATCH',
        path: '/v1/orgs/:id/members/:userId',
        summary: 'Body: { role }. Change role. Refuses to demote the last owner.',
      },
      {
        method: 'DELETE',
        path: '/v1/orgs/:id/members/:userId',
        summary: 'Remove a member.',
      },
      {
        method: 'GET',
        path: '/v1/orgs/:id/invitations',
        summary: 'Pending org invitations.',
      },
      {
        method: 'POST',
        path: '/v1/orgs/:id/invitations',
        summary: 'Body: { email, role, callbackURL }. Invite a collaborator.',
      },
      {
        method: 'POST',
        path: '/v1/org-invitations/accept',
        summary: 'Body: { token }.',
      },
    ],
  },
  {
    title: 'billing',
    intro: 'Polar.sh-backed subscription management.',
    endpoints: [
      {
        method: 'GET',
        path: '/v1/billing/subscription',
        summary: 'Current tier, status, period end, polar customer id.',
      },
      {
        method: 'GET',
        path: '/v1/billing/plans',
        summary: 'Public plan + price list (matches docs.briven.tech/pricing).',
      },
      {
        method: 'POST',
        path: '/v1/billing/checkout',
        summary:
          'Body: { tier, successURL }. Returns { url } — hosted Polar checkout URL.',
      },
      {
        method: 'POST',
        path: '/v1/billing/portal',
        summary: 'Returns { url } for the Polar customer portal (manage payment / cancel).',
      },
      {
        method: 'POST',
        path: '/v1/billing/webhook',
        summary:
          'Polar.sh webhook receiver. HMAC-validated. Server-side only — your app doesn\'t call this.',
      },
    ],
  },
];

export default function ApiPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">http api</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        every dashboard surface is built on these endpoints; you can build your own client
        on top of them too. base url <code>https://api.briven.tech</code>. all responses are
        JSON unless otherwise noted. auth is either a dashboard session cookie (Better Auth)
        or a project API key in <code>Authorization: Bearer brk_…</code>; each section calls
        out which.
      </p>

      <p className="mt-4 font-mono text-sm text-[var(--color-text-muted)]">
        admin-only routes under <code>/v1/admin/*</code> aren&apos;t listed here — they need
        platform-admin and are documented in the operator runbook.
      </p>

      {SECTIONS.map((sec) => (
        <section key={sec.title} className="mt-10">
          <h2 className="font-mono text-lg tracking-tight">{sec.title}</h2>
          <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">{sec.intro}</p>
          <ul className="mt-4 flex flex-col gap-2">
            {sec.endpoints.map((e, i) => (
              <li
                key={i}
                className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-xs"
              >
                <p>
                  <span
                    className={`mr-2 inline-block w-12 rounded-sm px-1.5 py-0.5 text-center text-[10px] ${methodColour(e.method)}`}
                  >
                    {e.method}
                  </span>
                  <code className="text-[var(--color-text)]">{e.path}</code>
                </p>
                <p className="mt-1 text-[var(--color-text-muted)]">{e.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </DocsShell>
  );
}

function methodColour(m: Endpoint['method']): string {
  switch (m) {
    case 'GET':
      return 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)]';
    case 'POST':
      return 'bg-emerald-400/15 text-emerald-400';
    case 'PATCH':
    case 'PUT':
      return 'bg-amber-400/15 text-amber-400';
    case 'DELETE':
      return 'bg-red-400/15 text-red-400';
  }
}
