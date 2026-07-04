import { ArrowLeftRightIcon } from '@/components/ui/arrow-left-right';
import { BotIcon } from '@/components/ui/bot';
import { ZapIcon } from '@/components/ui/zap';

import { apiJson } from '@/lib/api';
import { apiOrigin } from '@/lib/env';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
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
  const { globalEnabled, projects, audit } = await apiJson<McpStatus>('/v1/admin/mcp').catch(
    (): McpStatus => ({ globalEnabled: false, projects: [], audit: [] }),
  );

  const enabled = projects.filter((p) => p.mcpEnabled);
  const eligible = projects.filter((p) => !p.mcpEnabled && p.eligible);
  const free = projects.filter((p) => !p.mcpEnabled && !p.eligible);
  // Actionable projects first (enabled, then enable-able), then the muted
  // free-tier ones — the operator's eye lands on what they can act on.
  const ordered = [...enabled, ...eligible, ...free];

  return (
    <div className="flex flex-col gap-10">
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
      <Section title="global kill-switch" icon={<ZapIcon size={16} />}>
        <McpGlobalToggle apiOrigin={apiOrigin} enabled={globalEnabled} />
      </Section>

      {/* ── per-project access ───────────────────────────────────────── */}
      <Section title="per-project access" icon={<ArrowLeftRightIcon size={16} />}>
        {projects.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRightIcon size={24} />}
            title="no projects yet"
            message="once a customer creates one on a Pro/Team plan, you'll be able to turn MCP access on for it here."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {ordered.map((p) => (
              <McpProjectControls key={p.projectId} apiOrigin={apiOrigin} project={p} />
            ))}
          </div>
        )}
      </Section>

      {/* ── audit trail ──────────────────────────────────────────────── */}
      <Section title="agent-access audit trail" icon={<BotIcon size={16} />}>
        {audit.length === 0 ? (
          <EmptyState
            icon={<BotIcon size={24} />}
            title="no MCP activity recorded yet"
            message="every toggle, enable/disable, key issue and revoke shows up here."
          />
        ) : (
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 sm:p-8">
            <ol className="relative ml-1 flex flex-col gap-7 border-l border-[var(--color-border-subtle)] pl-7">
              {audit.map((row) => (
                <li key={row.id} className="relative flex flex-col gap-1">
                  <span
                    aria-hidden
                    className="absolute -left-[33px] top-[3px] size-2.5 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-primary)]"
                  />
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs">
                    <span className="text-[var(--color-text)]">{row.action}</span>
                    {auditProjectId(row) ? (
                      <span className="text-[var(--color-text-muted)]">
                        project {auditProjectId(row)}
                      </span>
                    ) : null}
                    {row.actorId ? (
                      <span className="text-[var(--color-text-subtle)]">by {row.actorId}</span>
                    ) : null}
                  </div>
                  <time
                    className="font-mono text-[10px] text-[var(--color-text-subtle)]"
                    dateTime={row.createdAt}
                  >
                    {new Date(row.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Section>
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
