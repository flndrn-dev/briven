import Link from 'next/link';

import { DocsShell } from '../../components/shell';

export const metadata = { title: 'ai schema generator' };

export default function AiPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">ai schema generator</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        describe your app in plain english, get a draft <code>schema.ts</code> back. powered
        by a self-hosted Qwen 2.5-coder 32B running on briven infrastructure — your prompt
        never leaves briven&apos;s network.
      </p>

      <Section title="how to use it">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            open the <em>ai schema</em> tab on any project at{' '}
            <code>/dashboard/projects/&lt;p_id&gt;/ai-schema</code>
          </li>
          <li>type a description of your data model in the textarea (up to 4000 chars)</li>
          <li>
            click <strong>generate schema</strong>. expect 5-15 seconds for a typical
            response — Qwen runs on a single DGX so larger prompts take longer
          </li>
          <li>
            click <strong>copy</strong> on the result, paste into your project&apos;s{' '}
            <code>briven/schema.ts</code>, and review every column before committing
          </li>
          <li>
            run <code>briven deploy</code> as usual — the AI output goes through the same
            schema-diff + migration path as a hand-written change
          </li>
        </ol>
      </Section>

      <Section title="what makes a good prompt">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>be specific about relationships</strong>: &quot;users have many posts, posts
            have many comments, comments can reply to other comments&quot; ports cleanly. &quot;a blog&quot;
            doesn&apos;t.
          </li>
          <li>
            <strong>name your domain entities</strong>: &quot;projects, tasks, time-tracking
            entries&quot; > &quot;a productivity app&quot;
          </li>
          <li>
            <strong>call out denormalised fields</strong>: &quot;each post stores its current
            comment count alongside the comment rows&quot; saves a follow-up query
          </li>
          <li>
            <strong>mention indexes you know you&apos;ll need</strong>: &quot;most queries are by
            user_id and created_at descending&quot; signals the right index
          </li>
        </ul>
      </Section>

      <Section title="what the AI knows about briven">
        <p>
          the model is primed with a system prompt that:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            pins the available column helpers: <code>text()</code>, <code>bigint()</code>,{' '}
            <code>boolean()</code>, <code>timestamp()</code>, <code>jsonb&lt;T&gt;()</code>,{' '}
            <code>uuid()</code>
          </li>
          <li>
            pins the modifiers: <code>.primaryKey()</code>, <code>.notNull()</code>,{' '}
            <code>.default(...)</code>, <code>.nullable()</code>,{' '}
            <code>.references(table, column)</code>, <code>.unique()</code>
          </li>
          <li>
            insists on a primary-key column per table; prefers <code>text()</code> for
            ULIDs; uses <code>bigint()</code> only for counters
          </li>
          <li>adds indexes only where a non-trivial query would scan — no over-indexing</li>
          <li>
            returns only the code (no markdown fences, no explanation) so it pastes cleanly
            into your editor
          </li>
        </ul>
      </Section>

      <Section title="what it can't do">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>write your functions</strong> — schema only. function bodies are too app-
            specific to template
          </li>
          <li>
            <strong>guess your auth model</strong> — every table that needs per-user scoping
            still needs an explicit <code>user_id</code> column and the function-level guard
          </li>
          <li>
            <strong>refactor an existing schema</strong> — the prompt assumes you&apos;re
            generating from scratch. for incremental changes, edit the schema by hand and let{' '}
            <code>briven deploy</code> compute the diff
          </li>
          <li>
            <strong>understand your data privacy constraints</strong> — review the output for
            anything you wouldn&apos;t store; the AI doesn&apos;t know your jurisdiction
          </li>
        </ul>
      </Section>

      <Section title="privacy">
        <p>
          your prompt and the generated schema are <strong>not</strong> logged. only the
          prompt length, response length, model name, and elapsed milliseconds are recorded
          for operational monitoring. the request never leaves briven&apos;s infrastructure
          — the Ollama instance runs on a dedicated DGX VPS in EU-Central.
        </p>
        <p>
          we do not train or fine-tune the model on your prompts. there is no &quot;telemetry to
          improve the service&quot; pipeline.
        </p>
      </Section>

      <Section title="when it's offline">
        <p>
          if the dashboard shows &quot;AI assistant offline&quot;, the operator has not configured
          the Ollama endpoint (BRIVEN_OLLAMA_URL is unset on the api container). this is the
          default state on self-hosted briven — the feature is opt-in. self-hosters who want
          it should:
        </p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            run Ollama on a machine with at least 24GB GPU VRAM (qwen2.5-coder:32b
            quantized fits in ~22GB)
          </li>
          <li>
            <code>ollama pull qwen2.5-coder:32b</code>
          </li>
          <li>
            set <code>BRIVEN_OLLAMA_URL=http://your-ollama-host:11434</code> on the api
            container
          </li>
          <li>restart the api</li>
        </ol>
      </Section>

      <p className="mt-12 font-mono text-xs text-[var(--color-text-subtle)]">
        more AI features (function bodies, query suggestions, performance review) are{' '}
        <Link href="/roadmap" className="underline hover:text-[var(--color-text)]">
          on the roadmap
        </Link>{' '}
        for year-two.
      </p>
    </DocsShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-mono text-lg">{title}</h2>
      <div className="mt-2 space-y-3 font-mono text-sm text-[var(--color-text-muted)]">
        {children}
      </div>
    </section>
  );
}
