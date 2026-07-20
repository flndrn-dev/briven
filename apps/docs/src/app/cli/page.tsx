import { PmTabs } from '../../components/pm-tabs';
import { DocsShell } from '../../components/shell';
import { pmDlx, pmExec, pmInstall } from '../../lib/pm';

export const metadata = {
  title: 'cli',
};

const INSTALL = pmInstall('@briven/cli', { dev: true });
const ONE_SHOT = pmDlx('briven');
const SETUP = pmExec(
  'briven setup',
  'briven setup --name my-app',
  'briven setup my-app',
  'briven setup --name my-app --template todo-app --region eu-west',
);
const INIT = pmExec('briven init');
const CONNECT = pmExec(
  'briven connect',
  'briven connect p_xxx',
  'briven connect --project p_xxx',
  'briven connect status',
  'briven connect logout',
  'briven connect --force',
);
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
const PROJECTS = pmExec(
  'briven projects list',
  'briven projects list --remote',
  'briven projects create --name my-app',
  'briven projects use p_xxx',
  'briven projects use p_xxx --link',
  'briven projects unlink p_xxx',
  'briven projects set-default p_xxx',
);
const EXPORT = pmExec(
  'briven export',
  'briven export --out backup.json',
  'briven export --with-data',
);
const IMPORT = pmExec(
  'briven import backup.json',
  'briven import backup.json --restore-data',
);
const DOCTOR = pmExec('briven doctor', 'briven doctor --origin https://api.example.com');

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

      <Section title="setup · new project">
        <p>
          Create a <em>new</em> cloud project only: browser sign-in, scaffold folder, mint CLI + S3
          keys. To attach an <em>existing</em> project use <code>briven connect</code> (section
          below). Full walkthrough on the{' '}
          <a className="underline" href="/connect">
            connect
          </a>{' '}
          page. Bare <code>briven</code> with no linked project also starts setup.
        </p>
        <PmTabs commands={SETUP} />
      </Section>

      <Section title="init">
        <p>
          Scaffold local files only (<code>briven.json</code>, schema, example function) — no cloud.
          Prefer <code>briven setup</code> when you want the full connect + project flow.
        </p>
        <PmTabs commands={INIT} />
        <p>
          Pass <code>--name</code> to override the directory name. Pass <code>--force</code> to
          overwrite an existing <code>briven.json</code>.
        </p>
      </Section>

      <Section title="connect">
        <p>
          Sign this machine into the <em>platform</em> only (browser OAuth) without scaffolding.
          Usually you want <code>briven setup</code> instead.
        </p>
        <PmTabs commands={CONNECT} />
        <p>
          Stores a user session in <code>~/.config/briven/credentials.json</code>.{' '}
          <code>connect logout</code> clears only that session; project <code>brk_…</code> keys stay
          until <code>briven logout</code>.
        </p>
      </Section>

      <Section title="login (manual key)">
        <p>
          Store a dashboard-issued API key for a project — the manual alternative to{' '}
          <code>briven projects use</code> after <code>connect</code>.
        </p>
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

      <Section title="projects">
        <p>
          Full project lifecycle from the shell. Local commands read{' '}
          <code>~/.config/briven/credentials.json</code>; remote / create / use need{' '}
          <code>briven connect</code> first.
        </p>
        <PmTabs commands={PROJECTS} />
        <ul className="list-disc pl-5">
          <li>
            <code>list</code> — keys on this machine; <code>list --remote</code> — account projects
          </li>
          <li>
            <code>create --name …</code> — create on the platform, mint a CLI key, set default
          </li>
          <li>
            <code>use &lt;id&gt;</code> — mint/store key for an existing project;{' '}
            <code>--link</code> writes <code>projectId</code> into <code>briven.json</code>
          </li>
          <li>
            <code>unlink</code> — drop the local key only; <code>set-default</code> — pick which
            project other commands fall back to
          </li>
        </ul>
      </Section>

      <Section title="export / import">
        <p>
          Move a project&apos;s schema + functions (and optionally its data) between
          projects or to disk. <code>--with-data</code> shells out to{' '}
          <code>pg_dump --format=custom --compress=6</code> against a short-lived dsn;{' '}
          <code>--restore-data</code> on the import side looks for the sibling data dump
          and pipes it into <code>pg_restore</code>. No new cli deps, but assumes{' '}
          <code>pg_dump</code> + <code>pg_restore</code> on your PATH.
        </p>
        <PmTabs commands={EXPORT} />
        <PmTabs commands={IMPORT} />
      </Section>

      <Section title="doctor">
        <p>
          End-to-end health check against the linked api. Prints pass/fail for: api
          reachable, session valid, project reachable, runtime ready, an example function
          invoke (if any). Useful first-line triage when something feels off.
        </p>
        <PmTabs commands={DOCTOR} />
      </Section>

      <Section title="environment">
        <ul className="list-disc pl-5">
          <li>
            <code>BRIVEN_API_ORIGIN</code> — override the control-plane origin for a self-hosted
            deployment. Default: <code>https://api.briven.tech</code>.
          </li>
          <li>
            <code>BRIVEN_DASHBOARD_ORIGIN</code> — where browser OAuth opens (
            <code>briven connect</code>). Default: <code>https://app.briven.tech</code>.
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
