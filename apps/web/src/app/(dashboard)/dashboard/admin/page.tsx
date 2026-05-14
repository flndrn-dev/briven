import Link from 'next/link';

import { apiJson } from '../../../../lib/api';
import { MaintenanceToggle } from './maintenance-toggle';
import { OpenSignupsToggle } from './open-signups-toggle';

interface Stats {
  users: number;
  projects: number;
  deployments: number;
  signups24h: number;
  openMigrations: number;
  openAbuseReports: number;
  suppressions: number;
}

interface LaunchStatus {
  openSignups: boolean;
  openSignupsEnvDefault: boolean;
  maintenanceMode: boolean;
  discordInviteUrl: string | null;
  domain: string;
  polarConfigured: boolean;
  mitteraConfigured: boolean;
  minioConfigured: boolean;
}

function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

export const dynamic = 'force-dynamic';

export default async function AdminStatsPage() {
  const [stats, launch] = await Promise.all([
    apiJson<Stats>('/v1/admin/stats'),
    apiJson<LaunchStatus>('/v1/admin/launch-status').catch(() => null),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="users" value={stats.users} />
        <StatCard label="projects" value={stats.projects} />
        <StatCard label="deployments" value={stats.deployments} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          operator queue
        </h2>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          what needs your attention right now. each number links into the relevant
          triage view; tone-coded so a non-zero count of red/amber things stands out
          at a glance.
        </p>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <QueueCard
            label="signups · 24h"
            value={stats.signups24h}
            tone="muted"
            href="/dashboard/admin/users"
            hint="new accounts since this time yesterday"
          />
          <QueueCard
            label="open migrations"
            value={stats.openMigrations}
            tone={stats.openMigrations > 0 ? 'primary' : 'muted'}
            href="/dashboard/admin/migrations"
            hint="status not in (completed, cancelled)"
          />
          <QueueCard
            label="open abuse reports"
            value={stats.openAbuseReports}
            tone={stats.openAbuseReports > 0 ? 'warning' : 'muted'}
            href="/dashboard/admin/abuse-reports"
            hint="status in (open, investigating)"
          />
          <QueueCard
            label="email suppressions"
            value={stats.suppressions}
            tone="muted"
            href="/dashboard/admin/email-suppressions"
            hint="bounce + complaint + manual entries"
          />
        </ul>
      </section>

      {launch ? <LaunchPanel launch={launch} /> : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
      <p className="font-mono text-xs text-[var(--color-text-subtle)]">{label}</p>
      <p className="mt-2 font-mono text-3xl">{value.toLocaleString()}</p>
    </div>
  );
}

type QueueHref =
  | '/dashboard/admin/users'
  | '/dashboard/admin/migrations'
  | '/dashboard/admin/abuse-reports'
  | '/dashboard/admin/email-suppressions';

interface QueueCardProps {
  label: string;
  value: number;
  tone: 'primary' | 'warning' | 'muted';
  href: QueueHref;
  hint?: string;
}

function QueueCard({ label, value, tone, href, hint }: QueueCardProps) {
  const valueClass =
    tone === 'primary'
      ? 'text-[var(--color-primary)]'
      : tone === 'warning'
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-text)]';
  return (
    <li>
      <Link
        href={href}
        className="flex h-full flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-border-strong)]"
      >
        <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
          {label}
        </p>
        <p className={`font-mono text-2xl ${valueClass}`}>{value.toLocaleString()}</p>
        {hint ? (
          <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">{hint}</p>
        ) : null}
      </Link>
    </li>
  );
}

function LaunchPanel({ launch }: { launch: LaunchStatus }) {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">launch status</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          flags the platform admin watches during the invite-only → public-beta transition.
          read-only for now; a dashboard-controllable settings table lands in a follow-up.
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <OpenSignupsToggle
          initialOpen={launch.openSignups}
          envDefault={launch.openSignupsEnvDefault}
          apiOrigin={publicApiOrigin()}
        />
        <MaintenanceToggle initial={launch.maintenanceMode} apiOrigin={publicApiOrigin()} />
        <FlagRow
          label="discord invite"
          state={launch.discordInviteUrl ? 'configured' : 'not set'}
          tone={launch.discordInviteUrl ? 'primary' : 'warning'}
          hint={
            launch.discordInviteUrl ??
            'set BRIVEN_DISCORD_INVITE_URL once the beta server is created (see runbooks/discord-setup.md)'
          }
        />
        <FlagRow
          label="polar billing"
          state={launch.polarConfigured ? 'configured' : 'not configured'}
          tone={launch.polarConfigured ? 'primary' : 'warning'}
          hint={
            launch.polarConfigured
              ? 'BRIVEN_POLAR_ACCESS_TOKEN set; webhook secret + product IDs assumed alongside'
              : 'BRIVEN_POLAR_ACCESS_TOKEN missing — tier upgrades + metering disabled'
          }
        />
        <FlagRow
          label="mittera email"
          state={launch.mitteraConfigured ? 'configured' : 'not configured'}
          tone={launch.mitteraConfigured ? 'primary' : 'warning'}
          hint={
            launch.mitteraConfigured
              ? 'transactional email enabled'
              : 'BRIVEN_MITTERA_API_KEY missing — magic-link emails print to stdout'
          }
        />
        <FlagRow
          label="minio storage"
          state={launch.minioConfigured ? 'configured' : 'not configured'}
          tone={launch.minioConfigured ? 'primary' : 'warning'}
          hint={
            launch.minioConfigured
              ? 'object storage online; presigned uploads ready'
              : 'BRIVEN_MINIO_* missing — storage feature returns 503'
          }
        />
        <FlagRow label="domain" state={launch.domain} tone="muted" />
      </ul>
    </section>
  );
}

function FlagRow({
  label,
  state,
  tone,
  hint,
}: {
  label: string;
  state: string;
  tone: 'primary' | 'warning' | 'muted';
  hint?: string;
}) {
  const stateClass =
    tone === 'primary'
      ? 'border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
      : tone === 'warning'
        ? 'border-[var(--color-warning)] text-[var(--color-warning)]'
        : 'border-[var(--color-border-subtle)] text-[var(--color-text-subtle)]';
  return (
    <li className="flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">{label}</span>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${stateClass}`}
        >
          {state}
        </span>
      </div>
      {hint ? <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">{hint}</p> : null}
    </li>
  );
}
