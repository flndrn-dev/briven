import { DocsShell } from '../../components/shell';
import { AskForm } from './ask-form';

export const metadata = { title: 'ask docs' };
export const dynamic = 'force-dynamic';

export default function AskPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">ask the docs</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        a natural-language interface over every published docs page. ask anything — the
        assistant retrieves the most relevant pages, answers your question grounded in those
        pages, and cites the slugs so you can dig deeper.
      </p>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        runs on the same self-hosted Qwen 2.5-coder model the dashboard ai surfaces use — no
        third-party AI provider. questions and answers are not logged.
      </p>

      <div className="mt-8">
        <AskForm />
      </div>
    </DocsShell>
  );
}
