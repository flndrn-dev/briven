import { ActivityIcon } from '@/components/ui/activity';
import { DatabaseIcon } from '@/components/ui/database';
import { FoldersIcon } from '@/components/ui/folders';
import { GlobeIcon } from '@/components/ui/globe';
import { LayoutGridIcon } from '@/components/ui/layout-grid';
import { ShieldCheckIcon } from '@/components/ui/shield-check';
import { TriangleAlertIcon } from '@/components/ui/triangle-alert';
import { UsersIcon } from '@/components/ui/users';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { UserActions } from '../user-actions';

import { EmptyState } from '../../_components/empty-state';
import { Section } from '../../_components/section';
import { StatCard } from '../../_components/stat-card';

interface UserDetail {
  user: {
    id: string;
    email: string;
    name: string | null;
    legalName: string | null;
    isAdmin: boolean;
    emailVerified: boolean;
    suspendedAt: string | null;
    createdAt: string;
    timezone: string | null;
    dateOfBirth: string | null;
    countryOfBirth: string | null;
    company: { name: string | null; vatId: string | null; country: string | null } | null;
    lastSignIn: {
      at: string;
      ipAddress: string | null;
      userAgent: string | null;
      nearBy: { city: string | null; region: string | null; country: string | null } | null;
    } | null;
  };
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    tier: string;
    region: string;
    createdAt: string;
    rows: number;
    tables: number;
    rowLimit: number;
    tableLimit: number;
  }>;
  totals: { projectCount: number; totalRows: number; totalTables: number };
  activity: Array<{ at: string; action: string; detail: string | null }>;
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'user · admin' };

/** Honest placeholder — anything null/empty renders "—", never a fake value. */
function dash(v: string | null | undefined): string {
  return v && v.length > 0 ? v : '—';
}

/** A date-ish value as a local date string, or "—" when missing/unparseable. */
function dashDate(v: string | null | undefined): string {
  const d = toValidDate(v);
  return d ? d.toLocaleDateString() : '—';
}

/** pct + UsageBar copied verbatim from the storage page. */
function pct(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

/**
 * Compact usage bar. Fills proportionally to used/max and flips to the
 * error colour once `over` is true, so an operator scanning the card
 * spots a project at/over its cap without reading the numbers.
 */
function UsageBar({ used, max, over }: { used: number; max: number; over: boolean }) {
  const filled = pct(used, max);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${filled}%`,
            backgroundColor: over ? 'var(--color-error)' : 'var(--color-primary)',
          }}
        />
      </div>
      <span
        className={
          over
            ? 'font-mono text-[10px] text-[var(--color-error)]'
            : 'font-mono text-[10px] text-[var(--color-text-subtle)]'
        }
      >
        {filled}%
      </span>
    </div>
  );
}

/** A genuine used-count, incl. a real 0 — only "—" when the number is negative. */
function usedNum(n: number): string {
  return n >= 0 ? n.toLocaleString() : '—';
}

/** A limit — "—" when it's 0/unknown (there's no cap to honestly show). */
function limitNum(n: number): string {
  return n > 0 ? n.toLocaleString() : '—';
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await apiJson<UserDetail>(`/v1/admin/users/${id}`).catch(() => null);

  if (data === null) {
    return (
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-primary)]">
              <UsersIcon size={20} />
            </span>
            <h1 className="font-mono text-xl tracking-tight">user</h1>
          </div>
          <a
            href="/admin/users"
            className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] transition-colors hover:text-[var(--color-text-link)]"
          >
            ← all users
          </a>
        </header>
        <EmptyState
          icon={<TriangleAlertIcon size={24} />}
          title="user not found"
          message="either the api didn't answer or no user exists with this id — head back and pick one from the list."
        />
      </div>
    );
  }

  const { user, projects, totals, activity } = data;
  const nearBy = user.lastSignIn?.nearBy ?? null;

  return (
    <div className="flex flex-col gap-10">
      {/* ── header ───────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-3">
        <a
          href="/admin/users"
          className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] transition-colors hover:text-[var(--color-text-link)]"
        >
          ← all users
        </a>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[var(--color-primary)]">
            <UsersIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">{user.email}</h1>
          {user.isAdmin ? (
            <span className="rounded-full bg-[var(--color-primary-subtle)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]">
              admin
            </span>
          ) : null}
          {user.suspendedAt ? (
            <span className="rounded-full bg-red-400/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-red-400">
              suspended
            </span>
          ) : null}
          {user.emailVerified ? (
            <span className="flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-success)]">
              <ShieldCheckIcon size={12} />
              verified
            </span>
          ) : (
            <span className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
              unverified
            </span>
          )}
        </div>
        <p className="font-mono text-sm text-[var(--color-text-muted)]">
          account detail — identity, geo-location, owned projects, and activity.
        </p>
        <p className="font-mono text-xs text-[var(--color-text-subtle)]">{user.id}</p>
        <div className="pt-1">
          <UserActions
            user={{ id: user.id, isAdmin: user.isAdmin, suspendedAt: user.suspendedAt }}
            apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
          />
        </div>
      </header>

      {/* ── the numbers ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <StatCard
          label="projects owned"
          value={totals.projectCount}
          icon={<FoldersIcon size={14} />}
          hint="projects they own"
        />
        <StatCard
          label="total rows"
          value={totals.totalRows}
          icon={<DatabaseIcon size={14} />}
          tone="primary"
          hint="across their projects"
        />
        <StatCard
          label="total tables"
          value={totals.totalTables}
          icon={<LayoutGridIcon size={14} />}
          hint="across their projects"
        />
      </div>

      {/* ── identity ─────────────────────────────────────────────────── */}
      <Section title="identity" icon={<LayoutGridIcon size={16} />}>
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 font-mono text-sm sm:grid-cols-2">
            <Field label="name" value={dash(user.name)} />
            <Field label="legal name" value={dash(user.legalName)} />
            <Field label="company name" value={dash(user.company?.name)} />
            <Field label="company vat" value={dash(user.company?.vatId)} />
            <Field label="company country" value={dash(user.company?.country)} />
            <Field label="timezone" value={dash(user.timezone)} />
            <Field label="date of birth" value={dashDate(user.dateOfBirth)} />
            <Field label="country of birth" value={dash(user.countryOfBirth)} />
            <Field label="joined" value={dashDate(user.createdAt)} />
          </dl>
        </div>
      </Section>

      {/* ── geo · last sign-in ───────────────────────────────────────── */}
      <Section title="geo · last sign-in" icon={<GlobeIcon size={16} />}>
        {user.lastSignIn === null ? (
          <EmptyState
            icon={<GlobeIcon size={24} />}
            title="no sign-in recorded yet"
            message="geo-ip and device details appear here after this user next signs in."
          />
        ) : (
          <div className="flex flex-col gap-6 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
            <div className="flex items-center gap-3">
              <span className="text-[var(--color-primary)]">
                <GlobeIcon size={20} />
              </span>
              <p className="font-mono text-lg text-[var(--color-text)]">
                {nearBy === null
                  ? 'location unknown'
                  : [dash(nearBy.city), dash(nearBy.region), dash(nearBy.country)].join(' · ')}
              </p>
            </div>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 font-mono text-sm sm:grid-cols-2">
              <Field label="ip address" value={dash(user.lastSignIn.ipAddress)} />
              <Field label="city" value={dash(nearBy?.city)} />
              <Field label="region" value={dash(nearBy?.region)} />
              <Field label="country" value={dash(nearBy?.country)} />
              <Field
                label="signed in at"
                value={new Date(user.lastSignIn.at).toLocaleString()}
              />
              <div className="flex flex-col gap-1 sm:col-span-2">
                <dt className="text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                  user agent
                </dt>
                <dd className="break-all text-[var(--color-text)]">
                  {dash(user.lastSignIn.userAgent)}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </Section>

      {/* ── projects ─────────────────────────────────────────────────── */}
      <Section title={`projects · ${projects.length}`} icon={<FoldersIcon size={16} />}>
        {projects.length === 0 ? (
          <EmptyState
            icon={<FoldersIcon size={24} />}
            title="no projects owned"
            message="this user doesn't own any projects yet."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {projects.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-[var(--color-text)]">{p.name}</span>
                    <span className="rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-primary)]">
                      {p.tier}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                    {p.region} · {dashDate(p.createdAt)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-[var(--color-text-subtle)]">
                  {p.slug} · {p.id}
                </p>
                <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <p className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                      <span>rows</span>
                      <span className="text-[var(--color-text-muted)]">
                        {usedNum(p.rows)} / {limitNum(p.rowLimit)}
                      </span>
                    </p>
                    <UsageBar
                      used={p.rows}
                      max={p.rowLimit}
                      over={p.rows >= p.rowLimit && p.rowLimit > 0}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <p className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                      <span>tables</span>
                      <span className="text-[var(--color-text-muted)]">
                        {usedNum(p.tables)} / {limitNum(p.tableLimit)}
                      </span>
                    </p>
                    <UsageBar
                      used={p.tables}
                      max={p.tableLimit}
                      over={p.tables >= p.tableLimit && p.tableLimit > 0}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── activity ─────────────────────────────────────────────────── */}
      <Section title="activity" icon={<ActivityIcon size={16} />}>
        {activity.length === 0 ? (
          <EmptyState
            icon={<ActivityIcon size={24} />}
            title="no activity recorded yet"
            message="actions on this account appear here over time."
          />
        ) : (
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 sm:p-8">
            <ol className="relative ml-1 flex flex-col gap-7 border-l border-[var(--color-border-subtle)] pl-7">
              {activity.map((a, i) => (
                <li key={`${a.at}-${i}`} className="relative flex flex-col gap-1">
                  <span
                    aria-hidden
                    className="absolute -left-[33px] top-[3px] size-2.5 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-primary)]"
                  />
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs">
                    <span className="text-[var(--color-text)]">{a.action}</span>
                    {a.detail ? (
                      <span className="text-[var(--color-text-muted)]">{a.detail}</span>
                    ) : null}
                  </div>
                  <time
                    className="font-mono text-[10px] text-[var(--color-text-subtle)]"
                    dateTime={a.at}
                  >
                    {new Date(a.at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Section>
    </div>
  );
}

/** One identity/geo definition-list field: uppercase mono label + value. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {label}
      </dt>
      <dd className="text-[var(--color-text)]">{value}</dd>
    </div>
  );
}
