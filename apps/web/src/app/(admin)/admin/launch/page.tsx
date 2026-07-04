import { TriangleAlertIcon } from '@/components/ui/triangle-alert';
import { UsersIcon } from '@/components/ui/users';
import { ZapIcon } from '@/components/ui/zap';

import { apiJson } from '@/lib/api';
import { apiOrigin } from '@/lib/env';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { MaintenanceControl, OpenSignupsControl } from './launch-controls';

export const metadata = { title: 'launch controls · admin' };
export const dynamic = 'force-dynamic';

/** The maintenance object returned inside /v1/admin/launch-status. */
interface MaintenanceState {
  active: boolean;
  scheduled: boolean;
  upcoming: boolean;
  startsAt: string | null;
  endsAt: string | null;
  message: string | null;
  manualOverride: boolean;
}

/** The slice of /v1/admin/launch-status these two switches need. */
interface LaunchStatus {
  openSignups: boolean;
  openSignupsEnvDefault: boolean;
  maintenanceMode: boolean;
  maintenance: MaintenanceState;
}

/**
 * Launch controls — the two platform-wide switches that actually exist
 * today: maintenance mode and open signups. Both read from and write to
 * /v1/admin/launch-status/*; nothing here is decorative. Feature flags and
 * staged rollouts get added only when their apis land.
 */
export default async function AdminLaunchPage() {
  const launch = await apiJson<LaunchStatus>('/v1/admin/launch-status').catch(() => null);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <ZapIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">launch controls</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          the go-live switchboard. two switches live here today — the maintenance brake and the
          signup gate — because those are the only platform-wide controls the api actually has.
          more switches appear when their endpoints exist, not before.
        </p>
      </header>

      {launch === null ? (
        <EmptyState
          icon={<TriangleAlertIcon size={28} />}
          title="launch status unavailable"
          message="the api didn't answer /v1/admin/launch-status — it may be restarting or your session may have expired. reload the page to try again; the switches only render with real state, never a guess."
        />
      ) : (
        <>
          {/* ── maintenance brake ─────────────────────────────────────── */}
          <Section title="maintenance mode" icon={<TriangleAlertIcon size={16} />}>
            <MaintenanceControl
              initial={launch.maintenanceMode}
              schedule={launch.maintenance}
              apiOrigin={apiOrigin}
            />
          </Section>

          {/* ── signup gate ───────────────────────────────────────────── */}
          <Section title="signups" icon={<UsersIcon size={16} />}>
            <OpenSignupsControl
              initialOpen={launch.openSignups}
              envDefault={launch.openSignupsEnvDefault}
              apiOrigin={apiOrigin}
            />
          </Section>
        </>
      )}
    </div>
  );
}
