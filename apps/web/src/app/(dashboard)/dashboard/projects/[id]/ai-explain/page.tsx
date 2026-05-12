import { AiExplainForm } from './ai-explain-form';
import { AiSubnav } from '../ai-subnav';

export const metadata = { title: 'ai explain' };
export const dynamic = 'force-dynamic';

export default async function AiExplainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <section className="flex flex-col gap-6">
      <AiSubnav projectId={id} />
      <header>
        <h1 className="font-mono text-xl tracking-tight">ai explain</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          paste any briven schema or function code and get a plain-english walkthrough framed in
          briven idioms — what the wrapper means, which db calls happen, where reactivity hooks
          in, and what would change if you flipped a query to a mutation.
        </p>
        <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
          your code is sent to a self-hosted Qwen 2.5-coder model on briven infrastructure — not
          to any third-party AI provider. snippets and explanations are not logged.
        </p>
      </header>

      <AiExplainForm projectId={id} />
    </section>
  );
}
