import Link from 'next/link';

import { apiJson, ApiError } from '../../../../../../../lib/api';

import { CreateAuthWebhookForm } from './create-auth-webhook-form';

interface Subscriber {
  id: string;
  projectId: string;
  name: string;
  targetUrl: string;
  /** Comma-separated event types or `*`. */
  eventTypes: string;
  enabled: boolean;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
  createdAt: string;
}

interface SubscribersResponse {
  subscribers: Subscriber[];
  knownEventTypes: readonly string[];
}

interface AuthStateResponse {
  enabled: boolean;
}

/**
 * Auth event types the panel exposes as toggles. Keep in sync with
 * `apps/api/src/services/outbound-webhooks.ts:AUTH_EVENT_TYPES`.
 */
const AUTH_EVENT_TYPES = [
  'auth.signup',
  'auth.signin',
  'auth.signout',
  'auth.session.revoked',
  'auth.account.linked',
  'auth.account.unlinked',
  'auth.user.deleted',
  'auth.user.banned',
  'auth.user.unbanned',
  'auth.user.suspended',
  'auth.user.unsuspended',
  'auth.waitlist.approved',
  'auth.waitlist.rejected',
] as const;

export const metadata = { title: 'auth · webhooks' };
export const dynamic = 'force-dynamic';

export default async function AuthWebhooksPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const state = await apiJson<AuthStateResponse>(`/v1/projects/${id}/auth/config`).catch(
    () => null,
  );

  if (!state || !state.enabled) {
    return (
      <section className="flex flex-col gap-6">
        <header>
          <h2 className="font-mono text-lg tracking-tight">auth · webhooks</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            enable auth on this project first.
          </p>
        </header>
        <Link
          href={`/dashboard/projects/${id}/auth`}
          className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          ← back to auth overview
        </Link>
      </section>
    );
  }

  // Match the general project webhooks page: never throw the segment error
  // boundary if the list call fails (missing table, 403, transient 5xx).
  let loadError: string | null = null;
  let data: SubscribersResponse = { subscribers: [], knownEventTypes: [] };
  try {
    data = await apiJson<SubscribersResponse>(`/v1/projects/${id}/outbound-webhooks`);
  } catch (err) {
    if (err instanceof ApiError) {
      loadError =
        err.status === 403
          ? 'you need at least viewer access to list webhooks'
          : `could not load webhooks (${err.status}). try again, or open the project webhooks panel.`;
    } else {
      loadError = 'could not load webhooks. try again in a moment.';
    }
  }

  const authRelevant = (data.subscribers ?? []).filter((s) => {
    const raw = typeof s.eventTypes === 'string' ? s.eventTypes : '';
    if (!raw || raw === '*') return raw === '*';
    const set = new Set(raw.split(',').map((e) => e.trim()).filter(Boolean));
    return AUTH_EVENT_TYPES.some((e) => set.has(e));
  });

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-lg tracking-tight">auth · webhooks</h2>
        <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          briven posts a signed event to your endpoint when an authentication
          action happens (sign-up, sign-in, session revoked, …). payloads are
          signed with HMAC-SHA256 — the same scheme as inbound webhooks.
          customer verifies via the <code>X-Briven-Signature</code> header.
          subscribers configured here may also be visible in the general
          project webhooks panel.
        </p>
      </header>

      {loadError ? (
        <div className="rounded-md border border-[var(--color-error)]/40 bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
          <p className="text-[var(--color-error)]">{loadError}</p>
          <p className="mt-2">
            you can still manage outbound subscribers in the{' '}
            <Link
              href={`/dashboard/projects/${id}/webhooks`}
              className="underline hover:text-[var(--color-primary)]"
            >
              project webhooks panel
            </Link>
            .
          </p>
        </div>
      ) : null}

      <CreateAuthWebhookForm projectId={id} authEventTypes={AUTH_EVENT_TYPES} />

      {authRelevant.length === 0 && !loadError ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-xs text-[var(--color-text-muted)]">
          no auth webhooks yet. configure one above to receive auth events.
        </div>
      ) : null}

      {authRelevant.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full min-w-max font-mono text-xs">
            <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-normal">name</th>
                <th className="px-3 py-2 font-normal">target</th>
                <th className="px-3 py-2 font-normal">events</th>
                <th className="px-3 py-2 font-normal">enabled</th>
                <th className="px-3 py-2 font-normal">last delivery</th>
                <th className="px-3 py-2 font-normal">created</th>
              </tr>
            </thead>
            <tbody>
              {authRelevant.map((s) => (
                <tr
                  key={s.id}
                  className={`border-t border-[var(--color-border-subtle)] ${
                    s.enabled ? '' : 'opacity-50'
                  }`}
                >
                  <td className="px-3 py-2 text-[var(--color-text)]">{s.name}</td>
                  <td className="max-w-[24rem] truncate px-3 py-2 text-[var(--color-text-muted)]">
                    <code className="text-[10px]" title={s.targetUrl}>
                      {s.targetUrl}
                    </code>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {s.eventTypes === '*' ? (
                      <span className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[10px]">
                        all events
                      </span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {(typeof s.eventTypes === 'string' ? s.eventTypes : '')
                          .split(',')
                          .map((e) => e.trim())
                          .filter((e) =>
                            (AUTH_EVENT_TYPES as readonly string[]).includes(e),
                          )
                          .map((e) => (
                            <span
                              key={e}
                              className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[10px]"
                            >
                              {e.replace('auth.', '')}
                            </span>
                          ))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {s.enabled ? (
                      <span className="text-[var(--color-primary)]">on</span>
                    ) : (
                      <span className="text-[var(--color-text-subtle)]">off</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {s.lastDeliveryAt ? (
                      <span>
                        {relative(s.lastDeliveryAt)}
                        {s.lastDeliveryStatus ? (
                          <span className="ml-1 text-[10px]">
                            ({s.lastDeliveryStatus})
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      'never'
                    )}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {relative(s.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">
        edit / rotate secret / disable lives in the general{' '}
        <Link
          href={`/dashboard/projects/${id}/webhooks`}
          className="underline hover:text-[var(--color-primary)]"
        >
          project webhooks panel
        </Link>{' '}
        — those actions apply to every subscriber, not just the auth ones.
      </p>
    </section>
  );
}

function relative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return String(iso).slice(0, 10);
  const deltaMs = Date.now() - then;
  if (deltaMs < 0) return String(iso).slice(0, 10);
  if (deltaMs < 60_000) return 'just now';
  if (deltaMs < 60 * 60_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs < 24 * 60 * 60_000) return `${Math.floor(deltaMs / (60 * 60_000))}h ago`;
  if (deltaMs < 30 * 24 * 60 * 60_000)
    return `${Math.floor(deltaMs / (24 * 60 * 60_000))}d ago`;
  return String(iso).slice(0, 10);
}
