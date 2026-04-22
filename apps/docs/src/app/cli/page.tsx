import { DocsShell } from '../../components/shell';

export const metadata = {
  title: 'cli',
};

export default function CliPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">cli</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        <code>@briven/cli</code> — install with <code>pnpm add -D @briven/cli</code> or use via{' '}
        <code>npx briven</code>.
      </p>

      <Section title="init">
        <p>Scaffold <code>briven.json</code>, <code>briven/schema.ts</code>, and an example function.</p>
        <Code>{`$ briven init`}</Code>
        <p>
          Creates the project layout in the current directory. Pass <code>--name</code> to override
          the default (the directory name). Pass <code>--force</code> to overwrite an existing{' '}
          <code>briven.json</code>.
        </p>
      </Section>

      <Section title="login">
        <p>Store an API key so subsequent commands can authenticate against a specific project.</p>
        <Code>{`$ briven login --project p_xxx --key brk_xxx`}</Code>
        <p>
          Credentials land at <code>~/.config/briven/credentials.json</code> with mode 0600. Get a
          key from the dashboard under <em>api keys</em>.
        </p>
      </Section>

      <Section title="whoami">
        <p>Verify the stored key is still valid and which project it belongs to.</p>
        <Code>{`$ briven whoami`}</Code>
      </Section>

      <Section title="deploy">
        <p>
          Loads <code>briven/schema.ts</code>, compares it to the currently deployed schema, and
          creates a new deployment. Destructive changes (drop table, drop column) are refused
          unless <code>--confirm-destructive</code> is passed, per{' '}
          <code>CLAUDE.md §8.3</code>.
        </p>
        <Code>{`$ briven deploy
$ briven deploy --dry-run
$ briven deploy --confirm-destructive`}</Code>
      </Section>

      <Section title="logout">
        <Code>{`$ briven logout
$ briven logout --project p_xxx`}</Code>
      </Section>

      <Section title="environment">
        <ul className="list-disc pl-5">
          <li>
            <code>BRIVEN_API_ORIGIN</code> — override the control-plane origin for a self-hosted
            deployment. Default: <code>https://api.briven.cloud</code>.
          </li>
          <li>
            <code>XDG_CONFIG_HOME</code> — where credentials are stored, following the XDG spec.
          </li>
        </ul>
      </Section>
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

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text)]">
      {children}
    </pre>
  );
}
