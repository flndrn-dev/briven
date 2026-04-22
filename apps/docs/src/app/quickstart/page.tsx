import { DocsShell } from '../../components/shell.js';

export const metadata = {
  title: 'quickstart',
};

export default function QuickstartPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">quickstart</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        from nothing to a live reactive query in five minutes.
      </p>

      <ol className="mt-8 flex flex-col gap-6 font-mono text-sm text-[var(--color-text-muted)]">
        <Step n={1} title="create a project in the dashboard">
          Sign in at <a href="https://briven.cloud">briven.cloud</a>, click <em>new project</em>,
          copy the resulting project id.
        </Step>
        <Step n={2} title="generate an api key">
          Open <em>api keys</em> on the new project and create one. The plaintext is shown once —
          store it in a secret manager immediately.
        </Step>
        <Step n={3} title="scaffold locally">
          <Code>{`$ mkdir my-app && cd my-app
$ pnpm add @briven/cli @briven/schema
$ npx briven init
$ npx briven login --project p_xxx --key brk_xxx`}</Code>
        </Step>
        <Step n={4} title="edit the schema + function">
          Open <code>briven/schema.ts</code>. Add a table. Open{' '}
          <code>briven/functions/notes.ts</code>. Make it return what you want.
        </Step>
        <Step n={5} title="deploy">
          <Code>{`$ npx briven deploy`}</Code>
          The CLI prints a diff, then creates the deployment. The dashboard shows the new row in
          <em> deployments</em>.
        </Step>
      </ol>
    </DocsShell>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-text-inverse)]">
        {n}
      </span>
      <div>
        <p className="font-mono text-[var(--color-text)]">{title}</p>
        <div className="mt-1 space-y-2">{children}</div>
      </div>
    </li>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-xs text-[var(--color-text)]">
      {children}
    </pre>
  );
}
