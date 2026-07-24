import { AuthAiAgentsClient } from '../../ai/ai-agents-client';

export const metadata = { title: 'Auth · AI agents' };
export const dynamic = 'force-dynamic';

export default async function AuthProjectAiPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <section>
      <header className="mb-6">
        <h2 className="font-mono text-lg tracking-tight text-[var(--color-text)]">
          AI agents
        </h2>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          short-lived tokens so tools and agents can act for this project
        </p>
      </header>
      <AuthAiAgentsClient projectId={projectId} />
    </section>
  );
}
