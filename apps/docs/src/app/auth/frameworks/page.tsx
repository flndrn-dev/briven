import { DocsShell } from '../../../components/shell';

export const metadata = { title: 'auth · framework packs' };

/**
 * SuperTokens-class framework integration pack (first cut).
 * Copy-paste patterns for wiring Briven Auth into common stacks.
 */
export default function AuthFrameworksPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">auth framework packs</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        drop-in patterns for Briven Auth (briven-engine). Prefer a{' '}
        <strong className="text-[var(--color-text)]">first-party proxy</strong> on your
        domain so session cookies stay first-party.
      </p>

      <h2 className="mt-10 font-mono text-lg">1. Next.js (App Router)</h2>
      <pre className="mt-3 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-[11px] text-[var(--color-text-muted)]">{`// apps/web/src/app/api/auth/[...path]/route.ts
export async function POST(req: Request, ctx: { params: { path: string[] } }) {
  const path = ctx.params.path.join('/');
  const url = \`\${process.env.BRIVEN_API_ORIGIN}/v1/auth-core/fdi/\${path}\`;
  const body = await req.text();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': req.headers.get('content-type') ?? 'application/json',
      cookie: req.headers.get('cookie') ?? '',
    },
    body,
  });
  // forward Set-Cookie to first-party host
  return new Response(await res.text(), {
    status: res.status,
    headers: res.headers,
  });
}`}</pre>

      <h2 className="mt-10 font-mono text-lg">2. Express / Node</h2>
      <pre className="mt-3 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-[11px] text-[var(--color-text-muted)]">{`app.use('/api/auth', async (req, res) => {
  const target = process.env.BRIVEN_API_ORIGIN + '/v1/auth-core/fdi' + req.url;
  const r = await fetch(target, {
    method: req.method,
    headers: { 'content-type': 'application/json', cookie: req.headers.cookie ?? '' },
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
  });
  res.status(r.status).send(await r.text());
});`}</pre>

      <h2 className="mt-10 font-mono text-lg">3. OIDC “Sign in with Briven” (any stack)</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 font-mono text-sm text-[var(--color-text-muted)]">
        <li>
          Create a client under dashboard → Auth → <strong className="text-[var(--color-text)]">IdP</strong>
        </li>
        <li>
          Discovery:{' '}
          <code className="text-[var(--color-text)]">
            GET https://api.briven.tech/v1/auth-core/oidc/.well-known/openid-configuration
          </code>
        </li>
        <li>Use any OIDC library (Auth.js, passport-openidconnect, appauth) with those endpoints</li>
      </ol>

      <h2 className="mt-10 font-mono text-lg">4. M2M / server jobs</h2>
      <pre className="mt-3 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-[11px] text-[var(--color-text-muted)]">{`const tok = await fetch('https://api.briven.tech/v1/auth-core/oauth/token', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'client_credentials',
    client_id: process.env.M2M_CLIENT_ID,
    client_secret: process.env.M2M_CLIENT_SECRET,
  }),
}).then((r) => r.json());
// Authorization: Bearer \${tok.access_token}`}</pre>

      <h2 className="mt-10 font-mono text-lg">5. AI agents</h2>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        Mint under Auth → <strong className="text-[var(--color-text)]">AI</strong>, then{' '}
        <code className="text-[var(--color-text)]">GET /v1/auth-core/ai/me</code> with{' '}
        <code className="text-[var(--color-text)]">Bearer brai_…</code>.
      </p>

      <p className="mt-10 font-mono text-xs text-[var(--color-text-muted)]">
        More: <a className="underline" href="/auth">auth overview</a> ·{' '}
        <a className="underline" href="/auth/parity">SuperTokens parity walk</a>
      </p>
    </DocsShell>
  );
}
