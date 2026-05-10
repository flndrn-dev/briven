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
const LINK = pmExec('briven link --project p_xxx');
const DEPLOY = pmExec(
  'briven deploy',
  'briven deploy --dry-run',
  'briven deploy --confirm-destructive',
);
const INVOKE = pmExec(
  'briven invoke poolStats',
  'briven invoke createNote --body \'{"body":"hello"}\'',
  'briven invoke getNotes --raw',
);
const ENV = pmExec('briven env list', 'briven env put STRIPE_KEY sk_...', 'briven env rm STRIPE_KEY');
const DB = pmExec('briven db shell');
const DEV = pmExec('briven dev');
const LOGS = pmExec('briven logs', 'briven logs --follow');
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

      <Section title="link">
        <p>
          Associate the current directory with an existing briven project — writes the project id
          into <code>briven.json</code> so subsequent commands don&apos;t need <code>--project</code>.
        </p>
        <PmTabs commands={LINK} />
      </Section>

      <Section title="deploy">
        <p>
          Loads <code>briven/schema.ts</code>, compares it to the currently deployed schema, and
          creates a new deployment. Destructive changes (drop table, drop column) are refused unless{' '}
          <code>--confirm-destructive</code> is passed.
        </p>
        <PmTabs commands={DEPLOY} />
      </Section>

      <Section title="invoke">
        <p>
          Call a deployed function and print the response. Reads the project id from{' '}
          <code>briven.json</code>; pass <code>--body</code> for an inline JSON body or{' '}
          <code>--body-file path</code> to read from disk. <code>--raw</code> prints just the
          unwrapped function value, jq-pipeable.
        </p>
        <PmTabs commands={INVOKE} />
      </Section>

      <Section title="env">
        <p>
          Manage per-project environment variables. Values are encrypted at rest with the platform
          key and only decrypted into the function runtime at cold start; <code>env list</code>{' '}
          surfaces metadata only.
        </p>
        <PmTabs commands={ENV} />
      </Section>

      <Section title="db">
        <p>
          Open a psql shell against the project&apos;s data-plane schema. Issues a short-lived dsn
          via the api — the cli never sees the long-lived superuser credentials. Admin-tier; rate
          limited.
        </p>
        <PmTabs commands={DB} />
      </Section>

      <Section title="dev">
        <p>
          Watch <code>briven/schema.ts</code> + <code>briven/functions/*</code> and push on
          change. Drives the inner-loop dev experience — same effect as running{' '}
          <code>briven deploy</code> after every save.
        </p>
        <PmTabs commands={DEV} />
      </Section>

      <Section title="logs">
        <p>
          Stream function-invocation logs for the linked project. Shows the structured envelope
          per invocation: <code>requestId</code>, <code>functionName</code>, <code>durationMs</code>,
          status, and any logs the function wrote via <code>ctx.log</code>.
        </p>
        <PmTabs commands={LOGS} />
      </Section>

      <Section title="logout">
        <PmTabs commands={LOGOUT} />
      </Section>

      <Section title="environment">
        <ul className="list-disc pl-5">
          <li>
            <code>BRIVEN_API_ORIGIN</code> — override the control-plane origin for a self-hosted
            deployment. Default: <code>https://api.briven.tech</code>.
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
