import { DocsShell } from '../../components/shell';

export const metadata = { title: 'self-host' };

export default function SelfHostPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">self-host</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        run briven on your own infrastructure. agpl-3.0 for the engine; the cli + client sdks are
        mit. recommended path is dokploy on hetzner or any vps that runs docker.
      </p>

      <div className="mt-6 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong>self-host status:</strong> the public dokploy + coolify templates ship alongside
        the public beta. until then this page documents the moving parts so you can plan your
        deploy; the step-by-step guide lands with the engine&apos;s self-host release.
      </div>

      <Section title="what you run">
        <p>three core services + the data plane:</p>
        <ul className="list-disc pl-5">
          <li>
            <code>apps/api</code> — control plane (hono on bun). owns accounts, projects, billing,
            cli sessions. talks to the meta-db.
          </li>
          <li>
            <code>apps/runtime</code> — function host (deno isolates). receives invokes from the
            api over a shared-secret-authenticated internal channel.
          </li>
          <li>
            <code>apps/realtime</code> — websocket service for reactive queries. holds a single
            postgres LISTEN connection and fans out NOTIFYs to subscribers.
          </li>
          <li>
            <code>apps/web</code> — dashboard (next.js 16). marketing + project management ui.
          </li>
        </ul>
      </Section>

      <Section title="data plane">
        <p>
          one or more postgres clusters host your customers&apos; per-project schemas. the
          control plane provisions a schema (<code>proj_&lt;projectId&gt;</code>) on deploy.
          schema-per-tenant gets you to ~100 tenants per cluster cheaply; graduate to dedicated
          clusters by tier from there.
        </p>
        <p>
          required postgres extensions: <code>pgvector</code>, <code>pg_cron</code>,{' '}
          <code>pgmq</code>. the migrations bundled with the api expect these to be available.
        </p>
      </Section>

      <Section title="env vars (control plane)">
        <p>
          the canonical set lives in <code>apps/api/src/env.ts</code>. every var is prefixed{' '}
          <code>BRIVEN_</code>. the highlights:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <code>BRIVEN_DATABASE_URL</code> — control-plane meta-db
          </li>
          <li>
            <code>BRIVEN_DATA_PLANE_URL</code> — superuser dsn the schema-apply path uses to{' '}
            <code>CREATE SCHEMA</code> per project
          </li>
          <li>
            <code>BRIVEN_REDIS_URL</code> — sessions + queues
          </li>
          <li>
            <code>BRIVEN_BETTER_AUTH_SECRET</code> — session signing
          </li>
          <li>
            <code>BRIVEN_RUNTIME_SHARED_SECRET</code> — the api ↔ runtime ↔ realtime auth token
          </li>
          <li>
            <code>BRIVEN_ENCRYPTION_KEY</code> — aes-256 KEK for customer env vars at rest. fails
            at boot when unset outside development.
          </li>
          <li>
            <code>BRIVEN_AUDIT_IP_PEPPER</code> — separate from the auth secret so a leaked
            audit-log column can&apos;t de-anonymise actor ips
          </li>
        </ul>
      </Section>

      <Section title="observability">
        <p>
          a turn-key grafana / loki / prometheus / promtail compose project ships under{' '}
          <code>infra/observability/</code>. wire your services to the same docker network and
          add the <code>briven_logs=true</code> label to ship structured logs. four starter
          dashboards cover api requests, runtime invocations, realtime subscriptions, and
          postgres health.
        </p>
      </Section>

      <Section title="licensing">
        <ul className="list-disc pl-5">
          <li>
            <strong>briven engine</strong> (<code>apps/api</code>, <code>apps/runtime</code>,{' '}
            <code>apps/realtime</code>, <code>apps/web</code>) — agpl-3.0. self-host freely; if
            you offer it as a service, your modifications need to be public.
          </li>
          <li>
            <strong><code>@briven/cli</code></strong> and the <code>@briven/client-*</code>{' '}
            packages — mit. embed in any project, no restrictions.
          </li>
          <li>
            commercial licence for the engine is available for cases where agpl is incompatible —
            contact the team.
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
