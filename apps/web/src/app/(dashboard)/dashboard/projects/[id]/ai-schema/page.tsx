import { AiSchemaForm } from './ai-schema-form';
import { AiSubnav } from '../ai-subnav';

export const metadata = { title: 'ai schema' };
export const dynamic = 'force-dynamic';

export default async function AiSchemaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <section className="flex flex-col gap-6">
      <AiSubnav projectId={id} />
      <header>
        <h1 className="font-mono text-xl tracking-tight">ai schema</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          describe your data model in plain english. briven&apos;s AI assistant returns a draft{' '}
          <code>schema.ts</code> you can paste into your project and refine.
        </p>
        <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
          your prompt is sent to a self-hosted Qwen 2.5-coder model on briven infrastructure — not
          to any third-party AI provider. prompts and responses are not logged.
        </p>
      </header>

      <AiSchemaForm projectId={id} />
    </section>
  );
}
