import { PmTabs } from '../../components/pm-tabs';
import { DocsShell } from '../../components/shell';
import { pmDlx, pmExec, pmInstall } from '../../lib/pm';

export const metadata = {
  title: 'connect',
};

const INSTALL_CLIENT = pmInstall('@briven/client');
const ONE_SHOT = pmDlx('briven');
const SETUP = pmExec(
  'briven setup',
  'briven setup --name my-app',
  'briven setup --project p_01HZ...',
  'briven setup --name my-app --template todo-app --region eu-west',
);
const SETUP_THEN = pmExec('briven deploy', 'briven dev');
const CONNECT = pmExec('briven connect');
const CONNECT_STATUS = pmExec('briven connect status');
const PROJECTS_REMOTE = pmExec('briven projects list --remote');
const PROJECTS_CREATE = pmExec(
  'briven projects create --name my-app',
  'briven projects create --name my-app --region eu-west',
);
const PROJECTS_USE = pmExec(
  'briven projects use p_01HZ...',
  'briven projects use p_01HZ... --link',
);
const PROJECTS_UNLINK = pmExec('briven projects unlink p_01HZ...');
const INIT_LINK = pmExec('briven init', 'briven link --project p_01HZ...', 'briven deploy');
const LIFECYCLE = pmExec('briven setup', 'briven deploy');

export default function ConnectPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">connect</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        how to connect to briven — from the shell (platform login + project lifecycle), from your
        app (SDK / HTTP), or from an AI agent (MCP). pick the path that matches what you&apos;re
        doing.
      </p>

      <div className="mt-6 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong className="text-[var(--color-text)]">beta.</strong> briven runs on DoltGres,
        which is still pre-1.0 (see{' '}
        <a className="underline" href="/doltgres/limitations">
          beta + limitations
        </a>
        ). the shell + SDK + HTTP paths below are live today. the MCP path is a Pro/Team beta
        that is still rolling out — treat its details as subject to change.
      </div>

      {/* ─── path 0: shell lifecycle ─────────────────────────────────────── */}
      <h2 className="mt-12 font-mono text-lg">path 0 · from the shell (recommended)</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        convex-style: one command signs you in, creates a <em>new</em> cloud project or attaches an{' '}
        <em>existing</em> one, and wires this folder. templates are optional starters — not the
        product model.
      </p>

      <h3 className="mt-6 font-mono text-sm">install the cli (or run one-off)</h3>
      <div className="mt-2">
        <PmTabs commands={ONE_SHOT} />
      </div>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        or install as a dev dependency — full install options on the{' '}
        <a className="underline" href="/cli">
          cli
        </a>{' '}
        page. running bare <code>briven</code> with no linked folder also starts setup.
      </p>

      <h3 className="mt-6 font-mono text-sm">one command · briven setup</h3>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        opens the browser to sign in, asks new vs existing (or takes flags), mints a CLI key, writes{' '}
        <code>briven.json</code> + scaffold files, and leaves you ready to deploy.
      </p>
      <PmTabs commands={SETUP} />
      <ul className="mt-3 list-disc pl-5 font-mono text-xs text-[var(--color-text-muted)]">
        <li>
          <code>briven setup</code> — interactive: (N)ew or (E)xisting, name, region, optional
          template
        </li>
        <li>
          <code>--name my-app</code> — create a new cloud project (no prompts if you also pass{' '}
          <code>--yes</code>)
        </li>
        <li>
          <code>--project p_…</code> — attach an existing project by id or slug
        </li>
        <li>
          <code>--template todo-app</code> — optional starter files only
        </li>
      </ul>
      <PmTabs commands={SETUP_THEN} />

      <h3 className="mt-6 font-mono text-sm">full lifecycle (copy-paste)</h3>
      <PmTabs commands={LIFECYCLE} />

      <h3 className="mt-6 font-mono text-sm">step-by-step (when you want the pieces)</h3>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        same job, split into smaller commands — useful for scripts or power users.
      </p>
      <PmTabs commands={CONNECT} />
      <PmTabs commands={CONNECT_STATUS} />
      <PmTabs commands={PROJECTS_REMOTE} />
      <PmTabs commands={PROJECTS_CREATE} />
      <PmTabs commands={PROJECTS_USE} />
      <PmTabs commands={PROJECTS_UNLINK} />
      <PmTabs commands={INIT_LINK} />

      <div className="mt-6 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong className="text-[var(--color-text)]">two kinds of credentials.</strong>{' '}
        <code>setup</code> / <code>connect</code> store a <em>user</em> session (who you are).{' '}
        setup also mints a <em>project</em> API key (what this machine can do inside one project).{' '}
        <code>briven logout</code> clears everything; <code>briven connect logout</code> clears only
        the platform session.
      </div>

      <p className="mt-4 font-mono text-sm text-[var(--color-text-muted)]">
        self-host? set <code>BRIVEN_API_ORIGIN</code> and <code>BRIVEN_DASHBOARD_ORIGIN</code>{' '}
        before <code>setup</code>. details on the{' '}
        <a className="underline" href="/cli">
          cli
        </a>{' '}
        page.
      </p>

      <h2 className="mt-12 font-mono text-lg">the three things you need (app / agent paths)</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        open your project in the{' '}
        <a className="underline" href="https://briven.tech">
          dashboard
        </a>{' '}
        and grab these from the project&apos;s overview / connect tab:
      </p>
      <ul className="mt-4 flex flex-col gap-3 font-mono text-sm text-[var(--color-text-muted)]">
        <li className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
          <p className="text-[var(--color-text)]">1 · the API endpoint</p>
          <p className="mt-1 text-xs">
            the base url your client talks to. for the hosted platform it is{' '}
            <code>https://api.briven.tech</code>. this is the <code>apiOrigin</code> the SDK
            takes. reactive subscriptions use the matching websocket origin{' '}
            <code>wss://ws.briven.tech</code> (<code>wsOrigin</code>).
          </p>
        </li>
        <li className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
          <p className="text-[var(--color-text)]">2 · your project id</p>
          <p className="mt-1 text-xs">
            looks like <code>p_01HZ…</code>. it scopes every call to your project&apos;s data and
            functions.
          </p>
        </li>
        <li className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
          <p className="text-[var(--color-text)]">3 · an API key</p>
          <p className="mt-1 text-xs">
            looks like <code>brk_…</code>. sent on every request as{' '}
            <code>Authorization: Bearer brk_…</code>. create one on the project&apos;s{' '}
            <a className="underline" href="/api-keys">
              api keys
            </a>{' '}
            page — the plaintext is shown once, so save it immediately.
          </p>
        </li>
      </ul>

      {/* ─── path A: the SDK ─────────────────────────────────────────────── */}
      <h2 className="mt-12 font-mono text-lg">path a · the @briven/client SDK (your app)</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        <code>@briven/client</code> is the framework-agnostic JavaScript client. it works in node,
        the browser, and any framework. (for react/svelte/vue with ready-made hooks, use the{' '}
        <a className="underline" href="/sdks">
          framework clients
        </a>{' '}
        instead — same idea, less wiring.)
      </p>

      <h3 className="mt-6 font-mono text-sm">install</h3>
      <div className="mt-2">
        <PmTabs commands={INSTALL_CLIENT} />
      </div>

      <h3 className="mt-6 font-mono text-sm">create a client</h3>
      <Snippet>{`import { createBrivenClient } from '@briven/client';

const briven = createBrivenClient({
  apiOrigin: 'https://api.briven.tech',     // thing 1 — the endpoint
  wsOrigin: 'wss://ws.briven.tech',         // optional, only needed for subscribe()
  projectId: 'p_01HZ...',                   // thing 2 — your project id
  token: process.env.BRIVEN_KEY,            // thing 3 — your brk_ api key
});`}</Snippet>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        <span className="text-[var(--color-text)]">note: </span>
        <code>token</code> can also be a function returning a string (or a promise of one) — handy
        when you mint short-lived tokens. in the browser, use a <code>viewer</code>-scope key; keep{' '}
        <code>developer</code>/<code>admin</code> keys server-side only.
      </p>

      <h3 className="mt-6 font-mono text-sm">call a function (node / one-shot)</h3>
      <Snippet>{`// invoke runs a deployed function once over HTTP and returns a frame.
const frame = await briven.invoke('listNotes', { limit: 20 });

if (frame.ok) {
  console.log(frame.value);       // the function's return value
  console.log(frame.durationMs);  // server-side execution time
} else {
  console.error(frame.code, frame.message);
}`}</Snippet>

      <h3 className="mt-6 font-mono text-sm">subscribe to live updates (react)</h3>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        <code>subscribe</code> calls your handler once with the initial value, then again every
        time the rows the function touched change. it needs <code>wsOrigin</code> set.
      </p>
      <Snippet>{`'use client';
import { useEffect, useState } from 'react';
import { createBrivenClient, type InvokeFrame } from '@briven/client';

const briven = createBrivenClient({
  apiOrigin: 'https://api.briven.tech',
  wsOrigin: 'wss://ws.briven.tech',
  projectId: 'p_01HZ...',
  token: process.env.NEXT_PUBLIC_BRIVEN_PUBLIC_KEY, // viewer-scope brk_ key
});

export function Notes() {
  const [notes, setNotes] = useState<{ id: string; body: string }[]>([]);

  useEffect(() => {
    const sub = briven.subscribe('listNotes', {}, (frame: InvokeFrame) => {
      if (frame.ok) setNotes(frame.value as { id: string; body: string }[]);
    });
    return () => sub.close(); // unsubscribe on unmount
  }, []);

  return <ul>{notes.map((n) => <li key={n.id}>{n.body}</li>)}</ul>;
}`}</Snippet>

      <h3 className="mt-6 font-mono text-sm">or skip the SDK — call the HTTP endpoint directly</h3>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        the SDK&apos;s <code>invoke</code> is a thin wrapper over one endpoint. you can call it
        from anything that speaks HTTP:
      </p>
      <Snippet>{`curl -X POST \\
  https://api.briven.tech/v1/projects/p_01HZ.../functions/listNotes \\
  -H "Authorization: Bearer brk_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "limit": 20 }'

# the request body IS the function's args object.
# response: { "ok": true, "value": ..., "durationMs": 12 }
#       or: { "ok": false, "code": "...", "message": "...", "durationMs": 3 }`}</Snippet>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        the full HTTP surface — deployments, studio, usage, and more — is documented on the{' '}
        <a className="underline" href="/api">
          http api
        </a>{' '}
        page.
      </p>

      {/* ─── path B: MCP ─────────────────────────────────────────────────── */}
      <h2 className="mt-12 font-mono text-lg">path b · the MCP endpoint (AI agents)</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        MCP (Model Context Protocol) lets an AI coding agent — Claude Code, Cursor, Codex, Gemini
        CLI, and others — talk to your project directly: read your schema, query data, manage
        functions. briven exposes a streamable-HTTP MCP server at the <code>/mcp</code> path on
        your API endpoint.
      </p>

      <div className="mt-4 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning)]/10 p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong className="text-[var(--color-warning)]">beta + plan-gated.</strong> MCP access is a{' '}
        <strong className="text-[var(--color-text)]">Pro / Team</strong> feature, off by default,
        and still rolling out. you enable it per project in the dashboard; the platform owner can
        also gate it globally. if you don&apos;t see the MCP panel, your plan or the platform flag
        is the reason.
      </div>

      <ol className="mt-6 flex flex-col gap-3 font-mono text-sm text-[var(--color-text-muted)]">
        <li>
          <span className="text-[var(--color-text)]">1.</span> in the dashboard, open your
          project, go to the <em>MCP</em> / connect panel, and turn MCP access on (Pro/Team only).
        </li>
        <li>
          <span className="text-[var(--color-text)]">2.</span> issue an MCP key. like API keys, the
          plaintext is shown once — it looks like <code>pk_briven_mcp_…</code> (a different prefix
          from the <code>brk_</code> SDK keys). save it immediately.
        </li>
        <li>
          <span className="text-[var(--color-text)]">3.</span> the panel builds a ready-to-paste
          config for your agent. you can scope it read-only and pick which feature groups (docs,
          database, functions, storage, branching…) the agent may use.
        </li>
      </ol>

      <h3 className="mt-6 font-mono text-sm">add it to your agent</h3>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        the connection is just a URL plus a bearer header. for example, with Claude Code:
      </p>
      <Snippet>{`claude mcp add --scope project --transport http briven \\
  "https://api.briven.tech/mcp?project_ref=p_01HZ...&read_only=true"`}</Snippet>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        or as a raw MCP client config, with the key in the <code>Authorization</code> header:
      </p>
      <Snippet>{`{
  "mcpServers": {
    "briven": {
      "url": "https://api.briven.tech/mcp?project_ref=p_01HZ...",
      "headers": {
        "Authorization": "Bearer pk_briven_mcp_..."
      }
    }
  }
}`}</Snippet>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        <span className="text-[var(--color-text)]">note: </span>
        the <code>read_only=true</code> query flag restricts the agent to reads; drop it to allow
        writes. <code>features=database,functions</code> narrows what the agent can touch.
      </p>

      {/* ─── next ────────────────────────────────────────────────────────── */}
      <h2 className="mt-12 font-mono text-lg">what to read next</h2>
      <ul className="mt-3 flex flex-col gap-2 font-mono text-sm">
        <NextLink
          href="/cli"
          title="cli reference"
          body="every briven command — connect, projects, deploy, dev, env, db, doctor"
        />
        <NextLink
          href="/quickstart"
          title="quickstart"
          body="from nothing to a live reactive query in a few minutes"
        />
        <NextLink
          href="/api-keys"
          title="api keys"
          body="create, scope, and rotate the brk_ keys the app and manual login paths use"
        />
        <NextLink
          href="/sdks"
          title="client sdks"
          body="react, svelte, and vue clients with useQuery/useMutation hooks"
        />
        <NextLink
          href="/api"
          title="http api"
          body="every endpoint behind the SDK — deployments, studio, usage, members, billing"
        />
        <NextLink
          href="/functions"
          title="functions"
          body="how the query/mutation/action functions you invoke are written and deployed"
        />
      </ul>
    </DocsShell>
  );
}

function Snippet({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] p-3 font-mono text-xs text-[var(--color-code-text)]">
      <code>{children}</code>
    </pre>
  );
}

function NextLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <li>
      <a
        href={href}
        className="block rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-border)]"
      >
        <p className="font-mono text-[var(--color-text)]">{title}</p>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">{body}</p>
      </a>
    </li>
  );
}
