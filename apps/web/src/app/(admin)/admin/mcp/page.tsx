import { ArrowLeftRightIcon } from '@/components/ui/arrow-left-right';
import { BotIcon } from '@/components/ui/bot';
import { ZapIcon } from '@/components/ui/zap';

import { apiJson } from '@/lib/api';
import { apiOrigin } from '@/lib/env';

import { McpGlobalToggle, McpProjectControls, type ProjectAccess } from './mcp-key-form';

export const metadata = { title: 'mcp / agent access · admin' };
export const dynamic = 'force-dynamic';

interface AuditRow {
  id: string;
  action: string;
  actorId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface McpStatus {
  globalEnabled: boolean;
  projects: ProjectAccess[];
  audit: AuditRow[];
}

export default async function AdminMcpPage() {
  const { globalEnabled, projects, audit } = await apiJson<McpStatus>('/v1/admin/mcp').catch((): McpStatus => ({ globalEnabled: false, projects: [], audit: [] }));

  const enabled = projects.filter((p) => p.mcpEnabled);
  const eligible = projects.filter((p) => !p.mcpEnabled && p.eligible);
  const free = projects.filter((p) => !p.mcpEnabled && !p.eligible);
  // Actionable projects first (enabled, then enable-able), then the muted
  // free-tier ones — the operator's eye lands on what they can act on.
  const ordered = [...enabled, ...eligible, ...free];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <BotIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">mcp / agent access</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          control which agents and mcp clients can reach the platform — the global switch,
          per-project access (Pro/Team only), issued keys, and the agent-activity audit trail. the
          mcp server itself ships separately; this is the operator surface that gates it.
        </p>
      </header>

      {/* ── global kill-switch ───────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHeading icon={<ZapIcon size={16} />} label="global kill-switch" />
        <McpGlobalToggle apiOrigin={apiOrigin} enabled={globalEnabled} />
      </section>

      {/* ── per-project access ───────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHeading icon={<ArrowLeftRightIcon size={16} />} label="per-project access" />
        {projects.length === 0 ? (
          <EmptyNote>
            no projects yet. once a customer creates one on a Pro/Team plan, you&apos;ll be able to
            turn MCP access on for it here.
          </EmptyNote>
        ) : (
          <div className="flex flex-col gap-3">
            {ordered.map((p) => (
              <McpProjectControls key={p.projectId} apiOrigin={apiOrigin} project={p} />
            ))}
          </div>
        )}
      </section>

      {/* ── audit trail ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <SectionHeading icon={<BotIcon size={16} />} label="agent-access audit trail" />
        {audit.length === 0 ? (
          <EmptyNote>
            no MCP activity recorded yet. every toggle, enable/disable, key issue and revoke shows
            up here.
          </EmptyNote>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border-subtle)]">
            <table className="w-full border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] text-left text-[var(--color-text-subtle)]">
                  <th className="px-3 py-2 font-normal uppercase tracking-wider">action</th>
                  <th className="px-3 py-2 font-normal uppercase tracking-wider">project</th>
                  <th className="px-3 py-2 font-normal uppercase tracking-wider">actor</th>
                  <th className="px-3 py-2 font-normal uppercase tracking-wider">when</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--color-border-subtle)] text-[var(--color-text-muted)] last:border-0"
                  >
                    <td className="px-3 py-2 text-[var(--color-text)]">{row.action}</td>
                    <td className="px-3 py-2">{auditProjectId(row) ?? '—'}</td>
                    <td className="px-3 py-2">{row.actorId ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** The project a row touched — from the audit metadata, when present. */
function auditProjectId(row: AuditRow): string | null {
  const meta = row.metadata;
  if (meta && typeof meta === 'object') {
    const pid = (meta as Record<string, unknown>).projectId;
    if (typeof pid === 'string') return pid;
  }
  return null;
}

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
      <span className="text-[var(--color-text-muted)]">{icon}</span>
      {label}
    </h2>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-6 font-mono text-xs text-[var(--color-text-subtle)]">
      {children}
    </div>
  );
}
