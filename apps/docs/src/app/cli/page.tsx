import { PmTabs } from '../../components/pm-tabs';
import { DocsShell } from '../../components/shell';
import { pmDlx, pmExec, pmInstall } from '../../lib/pm';

export const metadata = {
  title: 'cli',
};

const INSTALL = pmInstall('@briven/cli', { dev: true });
const ONE_SHOT = pmDlx('briven');
const INIT = pmExec('briven init');
const LOGIN = pmExec('briven login --project p_xxx --key brk_xxx');
const WHOAMI = pmExec('briven whoami');
const DEPLOY = pmExec(
  'briven deploy',
  'briven deploy --dry-run',
  'briven deploy --confirm-destructive',
);
const LOGOUT = pmExec('briven logout', 'briven logout --project p_xxx');

export default function CliPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">cli</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        <code>@briven/cli</code> — install as a dev dependency, or run one-off via each PM&apos;s
        remote-exec shim.
      </p>

      <Section title="install">
        <PmTabs commands={INSTALL} />
        <p>…or skip the install and invoke directly:</p>
        <PmTabs commands={ONE_SHOT} />
      </Section>

      <Section title="init">
        <p>
          Scaffold <code>briven.json</code>, <code>briven/schema.ts</code>, and an example function.
        </p>
        <PmTabs commands={INIT} />
        <p>
          Creates the project layout in the current directory. Pass <code>--name</code> to override
          the default (the directory name). Pass <code>--force</code> to overwrite an existing{' '}
          <code>briven.json</code>.
        </p>
      </Section>

      <Section title="login">
        <p>Store an API key so subsequent commands can authenticate against a specific project.</p>
        <PmTabs commands={LOGIN} />
        <p>
          Credentials land at <code>~/.config/briven/credentials.json</code> with mode 0600. Get a
          key from the dashboard under <em>api keys</em>.
        </p>
      </Section>

      <Section title="whoami">
        <p>Verify the stored key is still valid and which project it belongs to.</p>
        <PmTabs commands={WHOAMI} />
      </Section>

      <Section title="deploy">
        <p>
          Loads <code>briven/schema.ts</code>, compares it to the currently deployed schema, and
          creates a new deployment. Destructive changes (drop table, drop column) are refused unless{' '}
          <code>--confirm-destructive</code> is passed, per <code>CLAUDE.md §8.3</code>.
        </p>
        <PmTabs commands={DEPLOY} />
      </Section>

      <Section title="logout">
        <PmTabs commands={LOGOUT} />
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
