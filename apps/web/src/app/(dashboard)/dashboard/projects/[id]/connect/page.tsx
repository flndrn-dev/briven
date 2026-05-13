import { apiOrigin } from '../../../../../../lib/env';
import { ShellTokenPanel } from './shell-token-panel';

export const metadata = { title: 'connect' };
export const dynamic = 'force-dynamic';

export default async function ConnectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <section className="flex flex-col gap-8">
      <header>
        <h2 className="font-mono text-lg tracking-tight">connect</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          everything you need to reach this project from outside — psql, the briven CLI,
          the SDK clients, or a custom HTTP integration.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-sm text-[var(--color-text)]">project id</h3>
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-xs">
          <code>{id}</code>
        </div>
        <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          everything below is keyed by this id. share it with collaborators — it&apos;s
          not a secret on its own.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-sm text-[var(--color-text)]">api endpoints</h3>
        <dl className="grid grid-cols-1 gap-x-3 sm:grid-cols-[160px_1fr] gap-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs">
          <dt className="text-[var(--color-text-subtle)]">control plane</dt>
          <dd>
            <code>{apiOrigin}</code>
          </dd>

          <dt className="text-[var(--color-text-subtle)]">invoke a function</dt>
          <dd>
            <code>POST {apiOrigin}/v1/projects/{id}/invoke</code>
          </dd>

          <dt className="text-[var(--color-text-subtle)]">realtime subscribe</dt>
          <dd>
            <code>WSS {apiOrigin.replace(/^http/, 'ws')}/v1/projects/{id}/realtime</code>
          </dd>
        </dl>
        <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          authenticate with a project API key (<code>brk_</code> prefix) — issue one in
          the api keys tab. SDK clients (<code>@briven/react</code>, <code>@briven/svelte</code>,{' '}
          <code>@briven/vue</code>) take the key on construction.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-sm text-[var(--color-text)]">postgres shell DSN</h3>
        <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
          short-lived (15 min) read/write DSN scoped to this project&apos;s schema. use it with
          psql, pgcli, datagrip, or any tool that speaks postgres. logged in audit_logs;
          the DSN itself is never persisted.
        </p>
        <ShellTokenPanel projectId={id} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-sm text-[var(--color-text)]">cli usage</h3>
        <pre className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] p-4 font-mono text-xs text-[var(--color-code-text)]">
          <code>{`# point the cli at this project
briven login --project ${id} --key <brk_…>
briven link

# deploy a schema.ts + functions
briven deploy

# call a function
briven invoke listTodos`}</code>
        </pre>
      </section>
    </section>
  );
}
