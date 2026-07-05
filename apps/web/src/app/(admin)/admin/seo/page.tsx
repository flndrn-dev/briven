import Link from 'next/link';

import { GlobeIcon } from '@/components/ui/globe';

import { apiJson } from '@/lib/api';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { StatCard } from '../_components/stat-card';

export const metadata = { title: 'admin · sign-ups · geo (SEO)' };
export const dynamic = 'force-dynamic';

interface CountryCount {
  country: string | null;
  count: number;
}
interface CityCount {
  country: string | null;
  city: string | null;
  count: number;
}
interface RecentSignup {
  id: string;
  projectId: string;
  userId: string | null;
  email: string | null;
  ip: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  createdAt: string;
}
interface SignupGeoSummary {
  total: number;
  byCountry: CountryCount[];
  byCity: CityCount[];
  recent: RecentSignup[];
  sinceDays: number;
  projectId: string | null;
  geoPending: boolean;
}

const EMPTY: SignupGeoSummary = {
  total: 0,
  byCountry: [],
  byCity: [],
  recent: [],
  sinceDays: 30,
  projectId: null,
  geoPending: false,
};

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}
function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function SignupGeoPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; projectId?: string }>;
}) {
  const params = await searchParams;
  const days = Math.max(1, Math.min(365, Number(params.days) || 30));
  const projectId = params.projectId?.trim() || '';

  const qs = new URLSearchParams({ days: String(days) });
  if (projectId) qs.set('projectId', projectId);
  const data = await apiJson<SignupGeoSummary>(
    `/v1/admin/auth/signups/geo?${qs.toString()}`,
  ).catch((): SignupGeoSummary => ({ ...EMPTY, sinceDays: days }));

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <GlobeIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">sign-ups · geo (SEO)</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          where end-user sign-ups come from, across every briven-auth project —
          raw ip + country / city / region, captured at sign-up in the control
          plane. this is the platform-wide SEO analytics feed (admin-only); the
          per-project customer users page never shows any of this. window: last{' '}
          {days} days.
        </p>
      </header>

      {data.geoPending ? (
        <div className="rounded-xl border border-[var(--color-warning)] bg-[var(--color-surface)] px-6 py-4">
          <p className="font-mono text-sm text-[var(--color-warning)]">
            geo pending — GeoLite2 database not yet installed on the server
          </p>
          <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
            sign-up ip addresses are being recorded, but country / city / region
            are all blank because the GeoLite2-City .mmdb file isn&apos;t on the
            server yet. once ops sets BRIVEN_GEOIP_DB_PATH and provisions the
            file, new sign-ups will resolve to a location.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={`total sign-ups · ${days}d`}
          value={data.total}
          icon={<GlobeIcon size={14} />}
        />
        <StatCard
          label="countries"
          value={data.byCountry.filter((r) => r.country).length}
        />
        <StatCard
          label="cities"
          value={data.byCity.filter((r) => r.city).length}
        />
      </div>

      <Section
        title={`by country · last ${days}d`}
        icon={<GlobeIcon size={16} />}
        right={
          <div className="flex gap-2">
            {[7, 30, 90].map((d) => (
              <Link
                key={d}
                href={projectId ? `?days=${d}&projectId=${projectId}` : `?days=${d}`}
                className={`rounded-full border px-3 py-1 font-mono text-[10px] transition-colors ${
                  d === days
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
                    : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]'
                }`}
              >
                {d}d
              </Link>
            ))}
          </div>
        }
      >
        {data.byCountry.length === 0 ? (
          <EmptyState
            icon={<GlobeIcon size={28} />}
            title="no sign-ups yet"
            message={`no end-user sign-ups recorded in the last ${days} days. rows appear here as people sign up through briven-auth on any project.`}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            <table className="w-full font-mono text-xs">
              <thead className="text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                <tr>
                  <th className="px-6 py-4 text-left font-medium">country</th>
                  <th className="px-6 py-4 text-right font-medium">sign-ups</th>
                  <th className="px-6 py-4 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {data.byCountry.map((row, i) => (
                  <tr
                    key={row.country ?? `unknown-${i}`}
                    className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"
                  >
                    <td className="px-6 py-4 text-[var(--color-text)]">
                      {row.country ?? 'unknown'}
                    </td>
                    <td className="px-6 py-4 text-right">{formatNum(row.count)}</td>
                    <td className="px-6 py-4 text-right text-[var(--color-text)]">
                      {formatPercent(row.count, data.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {data.byCity.length > 0 ? (
        <Section title={`by city · last ${days}d`} icon={<GlobeIcon size={16} />}>
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            <table className="w-full font-mono text-xs">
              <thead className="text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                <tr>
                  <th className="px-6 py-4 text-left font-medium">city</th>
                  <th className="px-6 py-4 text-left font-medium">country</th>
                  <th className="px-6 py-4 text-right font-medium">sign-ups</th>
                  <th className="px-6 py-4 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {data.byCity.map((row, i) => (
                  <tr
                    key={`${row.country ?? ''}-${row.city ?? ''}-${i}`}
                    className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"
                  >
                    <td className="px-6 py-4 text-[var(--color-text)]">
                      {row.city ?? 'unknown'}
                    </td>
                    <td className="px-6 py-4">{row.country ?? 'unknown'}</td>
                    <td className="px-6 py-4 text-right">{formatNum(row.count)}</td>
                    <td className="px-6 py-4 text-right text-[var(--color-text)]">
                      {formatPercent(row.count, data.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section title="recent sign-ups" icon={<GlobeIcon size={16} />}>
        {data.recent.length === 0 ? (
          <EmptyState
            icon={<GlobeIcon size={28} />}
            title="nothing recent"
            message="no sign-ups in the selected window."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            <table className="w-full font-mono text-xs">
              <thead className="text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                <tr>
                  <th className="px-6 py-4 text-left font-medium">when</th>
                  <th className="px-6 py-4 text-left font-medium">project</th>
                  <th className="px-6 py-4 text-left font-medium">country / city</th>
                  <th className="px-6 py-4 text-left font-medium">ip</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-[var(--color-text)]">
                      {formatWhen(row.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">{row.projectId}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-[var(--color-text)]">
                      {row.country ?? 'unknown'}
                      {row.city ? ` · ${row.city}` : ''}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">{row.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
        raw ip + geo are captured server-side at sign-up and stored in the
        control plane (auth_signup_geo). admin-only. self-hosted geo lookup via
        the GeoLite2-City database when BRIVEN_GEOIP_DB_PATH is set.
      </p>
    </div>
  );
}
