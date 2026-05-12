import { DocsShell } from '../../components/shell';

export const metadata = { title: 'operator runbook' };

export default function OperatorPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">operator runbook</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        wake-up-at-3am playbook for self-hosted briven. every section assumes you have shell
        access to the host running <code>docker compose</code> for the briven stack.
      </p>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        the first thing to run before any of the recipes below: <code>briven doctor</code>. it
        prints which sub-system is unhealthy in seconds and rules out half of the diagnostics
        below.
      </p>

      <Section title="api won't boot">
        <p>
          look at <code>docker compose logs api</code>. the api refuses to start with a clear
          error message when a required env var is missing or invalid:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <code>BRIVEN_ENCRYPTION_KEY must be 64 hex chars</code> — generate with{' '}
            <code>openssl rand -hex 32</code>, paste into <code>.env</code>, redeploy. if you
            already have project env vars stored encrypted with a different key, see{' '}
            <em>rotate encryption key</em> below before changing this value or every secret in
            the database becomes unreadable.
          </li>
          <li>
            <code>BRIVEN_BETTER_AUTH_SECRET must be set</code> — same fix; this one is safe to
            rotate without data loss but every active session is invalidated.
          </li>
          <li>
            <code>BRIVEN_DATABASE_URL: ECONNREFUSED</code> — postgres isn't up yet or isn't
            reachable on the docker network. <code>docker compose ps postgres</code> and{' '}
            <code>docker compose logs postgres</code>; usually a stale pid lock, fixed by{' '}
            <code>docker compose down postgres &amp;&amp; docker compose up -d postgres</code>.
          </li>
        </ul>
      </Section>

      <Section title="magic link doesn't arrive">
        <p>
          if <code>BRIVEN_MITTERA_API_URL</code> or <code>BRIVEN_MITTERA_API_KEY</code> is
          unset, briven prints the magic link to api stdout instead of sending email. that&rsquo;s
          intentional for self-host first boot. find it:
        </p>
        <Snippet>{`docker compose logs api 2>&1 | grep magic_link | tail -1`}</Snippet>
        <p>
          if mittera is configured but mail still isn&rsquo;t arriving, check the api log for{' '}
          <code>mittera_send_failed</code> entries — the API key may be wrong, the sender
          domain isn&rsquo;t verified on the mittera side, or mittera is rejecting the request
          for another reason (the response body is logged, truncated to 240 chars). The link
          itself is always valid for 10 minutes; re-requesting just sends a fresh one.
        </p>
      </Section>

      <Section title="promote yourself to platform admin">
        <p>
          <code>/admin</code> is gated by the <code>users.is_admin</code> column. The first user
          gets it via SQL; everyone after that gets it via the admin tab itself.
        </p>
        <Snippet>{`docker compose exec postgres psql -U postgres -d briven_control \\
  -c "UPDATE users SET is_admin = true WHERE email = '<your-email>'"`}</Snippet>
      </Section>

      <Section title="rotate encryption key (per-project env vars)">
        <p>
          <code>BRIVEN_ENCRYPTION_KEY</code> is the AES-256-GCM key for project env vars at rest.
          rotating it requires a re-encrypt pass before the new key takes effect. plan a brief
          maintenance window — the api refuses writes while the migration runs.
        </p>
        <ol className="list-decimal pl-5">
          <li>generate the new key: <code>openssl rand -hex 32</code></li>
          <li>
            stop the api: <code>docker compose stop api</code>
          </li>
          <li>
            run the rotation script with the OLD key in <code>OLD_KEY</code> and NEW key in{' '}
            <code>NEW_KEY</code>:{' '}
            <Snippet>{`docker compose run --rm \\
  -e BRIVEN_ENCRYPTION_KEY_OLD=<old> \\
  -e BRIVEN_ENCRYPTION_KEY=<new> \\
  api node packages/cli/dist/scripts/rotate-encryption-key.js`}</Snippet>
          </li>
          <li>
            update <code>.env</code> with the new key and start the api:{' '}
            <code>docker compose up -d api</code>
          </li>
        </ol>
      </Section>

      <Section title="restore from backup">
        <p>
          backups land in MinIO (or S3, B2 — whatever <code>BRIVEN_BACKUP_DESTINATION</code>{' '}
          points at). list them:
        </p>
        <Snippet>{`docker compose exec minio mc ls local/briven-backups/`}</Snippet>
        <p>restore a single dump (control plane shown — replace with `briven_data` for the data plane):</p>
        <Snippet>{`# 1. download the dump
docker compose exec minio mc cp local/briven-backups/2026-05-09.sql.gz /tmp/

# 2. stop the api so nothing writes during restore
docker compose stop api

# 3. drop + recreate the database
docker compose exec postgres psql -U postgres \\
  -c "DROP DATABASE briven_control" \\
  -c "CREATE DATABASE briven_control"

# 4. pipe the dump in
gunzip -c /tmp/2026-05-09.sql.gz | docker compose exec -T postgres psql -U postgres -d briven_control

# 5. start the api back up
docker compose up -d api`}</Snippet>
        <p>
          monthly restore drill is wired up in <code>infra/backups/restore-drill.sh</code> and
          runs against an ephemeral db so you don't need to take prod down to verify the dumps
          are valid.
        </p>
      </Section>

      <Section title="suspend a project (abuse, billing past-due, customer ask)">
        <Snippet>{`docker compose exec postgres psql -U postgres -d briven_control \\
  -c "UPDATE projects SET status = 'suspended', suspended_reason = '<reason>' WHERE id = '<p_...>'"`}</Snippet>
        <p>
          suspended projects refuse all api calls (404 from <code>/v1/projects/:id/*</code>) and
          their realtime subscriptions are forcibly closed within the next pump cycle. resume by
          flipping <code>status</code> back to <code>active</code>.
        </p>
      </Section>

      <Section title="invocations are slow / rate-limited">
        <p>
          first stop in Grafana: the <em>runtime invocations</em> dashboard. p95 over 500ms or a
          429 spike points to one of:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <strong>cold-start storm</strong> — runtime is killing isolates faster than it can
            warm them. raise <code>BRIVEN_RUNTIME_ISOLATE_TTL_SEC</code> from the default 600
            and bounce <code>runtime</code>.
          </li>
          <li>
            <strong>rate-limit at the gateway</strong> — a single project is hitting tier
            ceilings. confirm in the api log: <code>rate_limited project=p_...</code>. resolve
            with the customer (upgrade tier or reduce hot-loop traffic).
          </li>
          <li>
            <strong>postgres saturated</strong> — the <em>postgres health</em> dashboard will
            show connection pool exhaustion or lock waits. <code>pg_stat_activity</code> tells
            you which query.
          </li>
        </ul>
      </Section>

      <Section title="websocket subs flapping">
        <p>
          if many clients are reconnecting in a tight loop, the <em>realtime subs</em> dashboard
          shows a sawtooth open/close pattern. usual causes:
        </p>
        <ul className="list-disc pl-5">
          <li>
            traefik is timing out idle connections. set{' '}
            <code>traefik.http.middlewares.briven-ws.headers.customRequestHeaders.X-WS-Timeout=300</code>{' '}
            and confirm <code>ws_keepalive_ms</code> in the realtime env is &lt; the proxy
            timeout.
          </li>
          <li>
            postgres is closing the LISTEN connection because the api went idle. the realtime
            service auto-reconnects in 1s steps with backoff; if you see hundreds of these in
            seconds the postgres host needs investigation.
          </li>
        </ul>
      </Section>

      <Section title="backup off-site upload failed">
        <p>
          systemd journal: <code>journalctl -u briven-backup.service -n 200</code>. the most
          common failure is the b2 application key being revoked server-side. easy fix:
          re-issue at backblaze, update the env, then{' '}
          <code>systemctl start briven-backup.service</code> to retry without waiting for
          the timer.
        </p>
        <p className="mt-2">
          required env on the kvm running pg-dump.sh + restore-drill.sh:
        </p>
        <ul className="list-disc pl-5">
          <li><code>BRIVEN_BACKUP_B2_KEY_ID</code> — Backblaze B2 application key id.</li>
          <li><code>BRIVEN_BACKUP_B2_APP_KEY</code> — secret half of the application key. write-only scope is enough.</li>
          <li><code>BRIVEN_BACKUP_B2_BUCKET</code> — bucket name (e.g. <code>briven-prod-backups-eu-central</code>).</li>
          <li><code>BRIVEN_BACKUP_PREFIX</code> — key prefix inside the bucket. defaults to <code>prod</code>.</li>
          <li><code>BRIVEN_BACKUP_CONTROL_URL</code> + <code>BRIVEN_BACKUP_DATA_URL</code> — postgres dsns for the meta-db + the data plane.</li>
        </ul>
        <p className="mt-2">
          set a bucket lifecycle rule directly in the b2 UI: keep daily snapshots 30 days,
          monthly snapshots 12 months. the scripts don't manage retention — they assume
          the bucket does.
        </p>
      </Section>

      <Section title="incident disclosure">
        <p>
          incidents that touch customer data — get a short message out within 72h and post the
          full post-mortem at <code>docs.briven.tech/changelog</code> within 30 days. template:
        </p>
        <Snippet>{`Title: <one-line summary, no jargon>
Detected: <utc>
Resolved: <utc>
Customer impact: <which projects, what data, exposure window>
Root cause: <one paragraph>
Mitigation in place: <bullets>
Long-term fixes: <bullets>`}</Snippet>
      </Section>

      <Section title="when in doubt — collect a snapshot">
        <p>
          before opening an issue or paging support, run this on the host. attach the resulting
          tarball:
        </p>
        <Snippet>{`d=$(date -u +%Y%m%d-%H%M%S)
mkdir briven-snapshot-$d && cd briven-snapshot-$d
docker compose ps > ps.txt
docker compose logs --tail 500 api    > api.log    2>&1
docker compose logs --tail 500 runtime > runtime.log 2>&1
docker compose logs --tail 500 realtime > realtime.log 2>&1
docker compose logs --tail 500 postgres > postgres.log 2>&1
docker compose exec postgres psql -U postgres -d briven_control \\
  -c "SELECT count(*) FROM projects" \\
  -c "SELECT count(*) FROM users" \\
  -c "SELECT version()" > db.txt 2>&1
cd .. && tar czf briven-snapshot-$d.tar.gz briven-snapshot-$d/`}</Snippet>
        <p>
          everything in the snapshot is operator-side metadata — no customer secrets, no project
          env vars, no row data.
        </p>
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

function Snippet({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs">
      <code>{children}</code>
    </pre>
  );
}
