import { DocsShell } from '../../components/shell';

export const metadata = {
  title: 'api keys',
};

interface Role {
  name: string;
  plain: string;
  can: string;
}

const ROLES: readonly Role[] = [
  {
    name: 'viewer',
    plain: 'read-only',
    can: 'read data and run read-only functions. safe to ship in a browser bundle. cannot write, deploy, or change settings.',
  },
  {
    name: 'developer',
    plain: 'read + write',
    can: 'everything viewer can, plus invoke write functions and deploy. this is the day-to-day key for your server / CI. keep it server-side.',
  },
  {
    name: 'admin',
    plain: 'full project control',
    can: 'everything developer can, plus manage the project, its members, and its keys. use sparingly.',
  },
];

export default function ApiKeysPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">api keys</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        an API key (<code>brk_…</code>) is how your code proves which project it&apos;s allowed to
        touch. every SDK and HTTP call sends one as <code>Authorization: Bearer brk_…</code>. keys
        are per-project, so a key for one project can never reach another.
      </p>

      <h2 className="mt-12 font-mono text-lg">create one in the dashboard</h2>
      <ol className="mt-4 flex flex-col gap-4 font-mono text-sm text-[var(--color-text-muted)]">
        <Step n={1} title="open your project's api keys page">
          sign in at{' '}
          <a className="underline" href="https://briven.tech">
            briven.tech
          </a>
          , open the project, and click <em>api keys</em>. you need the <code>admin</code> role on
          the project to create or revoke keys.
        </Step>
        <Step n={2} title="click new key, name it, pick a role">
          give it a name you&apos;ll recognise later (e.g. <code>prod-server</code> or{' '}
          <code>vercel-preview</code>) and choose a role (see below). you can also set an optional
          expiry in days — after which the key stops working on its own.
        </Step>
        <Step n={3} title="copy the key now — it is shown only once">
          the full key (<code>brk_…</code>) is revealed a single time, right after you create it.
          briven only stores a hashed fingerprint, so it can never show you the key again. copy it
          straight into your secret manager or <code>.env</code> file before you close the dialog.
        </Step>
      </ol>

      <h2 className="mt-12 font-mono text-lg">roles (what a key is allowed to do)</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        each key is scoped to a role. pick the least powerful one that gets the job done — that way
        a leaked key does the least damage. you can only issue a key at or below your own role, and{' '}
        <code>owner</code> is never assignable to a key.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {ROLES.map((r) => (
          <div
            key={r.name}
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-text-muted)]"
          >
            <p>
              <code className="text-[var(--color-text)]">{r.name}</code>{' '}
              <span className="text-[var(--color-text-subtle)]">· {r.plain}</span>
            </p>
            <p className="mt-1">{r.can}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 font-mono text-lg">one-time reveal</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        when you create a key, the API returns the plaintext exactly once and never again — only a
        hash is kept. if you lose a key, you can&apos;t recover it; create a fresh one and revoke
        the old. there is no &ldquo;show key&rdquo; button anywhere by design.
      </p>

      <h2 className="mt-12 font-mono text-lg">keep keys secret</h2>
      <ul className="mt-3 list-inside list-disc font-mono text-sm text-[var(--color-text-muted)]">
        <li>
          never commit a key to git. put it in <code>.env</code> (git-ignored) or a secret manager.
        </li>
        <li>
          only a <code>viewer</code> (read-only) key may live in browser / client code — and even
          then it&apos;s public, so scope it tightly. <code>developer</code> and <code>admin</code>{' '}
          keys are server-side only.
        </li>
        <li>
          rotate on a schedule and whenever someone leaves the team. give each
          environment/service its own named key so you can revoke just one without downtime
          elsewhere.
        </li>
        <li>
          revoking a key takes effect immediately — the next request with it is rejected.
        </li>
      </ul>

      <h2 className="mt-12 font-mono text-lg">managing keys over the API</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        the dashboard is built on these endpoints (all require a dashboard session with the{' '}
        <code>admin</code> role on the project):
      </p>
      <ul className="mt-4 flex flex-col gap-2 font-mono text-xs">
        <ApiLine method="GET" path="/v1/projects/:id/api-keys" note="list keys (fingerprints only — never the plaintext)" />
        <ApiLine
          method="POST"
          path="/v1/projects/:id/api-keys"
          note="body { name, role?, expiresInDays? }. returns the plaintext once, then 201"
        />
        <ApiLine method="PATCH" path="/v1/projects/:id/api-keys/:keyId" note="rename a key" />
        <ApiLine method="DELETE" path="/v1/projects/:id/api-keys/:keyId" note="revoke a key (effective immediately)" />
      </ul>

      <h2 className="mt-12 font-mono text-lg">what to read next</h2>
      <ul className="mt-3 flex flex-col gap-2 font-mono text-sm">
        <NextLink
          href="/connect"
          title="connect"
          body="use your new key with the SDK, raw HTTP, or an MCP agent"
        />
        <NextLink
          href="/sdks"
          title="client sdks"
          body="where the key goes in the react / svelte / vue clients"
        />
        <NextLink
          href="/api"
          title="http api"
          body="the full endpoint reference, including auth details"
        />
      </ul>
    </DocsShell>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-text-inverse)]">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[var(--color-text)]">{title}</p>
        <div className="mt-1 space-y-2">{children}</div>
      </div>
    </li>
  );
}

function ApiLine({
  method,
  path,
  note,
}: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  note: string;
}) {
  return (
    <li className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
      <p>
        <span
          className={`mr-2 inline-block w-12 rounded-sm px-1.5 py-0.5 text-center text-[10px] ${methodColour(method)}`}
        >
          {method}
        </span>
        <code className="text-[var(--color-text)]">{path}</code>
      </p>
      <p className="mt-1 text-[var(--color-text-muted)]">{note}</p>
    </li>
  );
}

function methodColour(m: 'GET' | 'POST' | 'PATCH' | 'DELETE'): string {
  switch (m) {
    case 'GET':
      return 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)]';
    case 'POST':
      return 'bg-emerald-400/15 text-emerald-400';
    case 'PATCH':
      return 'bg-amber-400/15 text-amber-400';
    case 'DELETE':
      return 'bg-red-400/15 text-red-400';
  }
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
