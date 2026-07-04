import { apiJson } from '../../../../../../lib/api';
import { apiOrigin } from '../../../../../../lib/env';
import { McpAccessPanel, type ProjectMcpStatus } from './mcp-access-panel';

export const metadata = { title: 'agent access' };
export const dynamic = 'force-dynamic';

const FALLBACK: ProjectMcpStatus = {
  globalEnabled: false,
  planTier: 'free',
  eligible: false,
  mcpEnabled: false,
  keys: [],
};

export default async function ProjectMcpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const status = await apiJson<ProjectMcpStatus>(`/v1/projects/${id}/mcp`).catch(() => FALLBACK);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-lg tracking-tight">agent access</h2>
        <p className="mt-1 max-w-prose font-mono text-xs text-[var(--color-text-muted)]">
          let AI agents and MCP clients reach this project through the briven MCP server. turn it
          on, then issue scoped keys for each agent. you can revoke a key any time.
        </p>
      </header>

      <McpAccessPanel apiOrigin={apiOrigin} projectId={id} initial={status} />
    </section>
  );
}
