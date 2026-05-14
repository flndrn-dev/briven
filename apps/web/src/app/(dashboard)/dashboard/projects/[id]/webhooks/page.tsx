import Link from 'next/link';
import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../../lib/api';
import { CreateSubscriberForm } from './create-subscriber-form';
import { CreateWebhookForm } from './create-form';
import { RotateSecretButton } from './rotate-secret-button';
import { RotateSubscriberSecretButton } from './rotate-subscriber-secret-button';
import { TestFireButton } from './test-fire-button';

interface Endpoint {
  id: string;
  name: string;
  functionName: string;
  enabled: boolean;
  lastDeliveryAt: string | null;
  lastDeliveryStatus:
    | 'ok'
    | 'rejected_signature'
    | 'rejected_replay'
    | 'invoke_error'
    | 'disabled'
    | null;
  createdAt: string;
  updatedAt: string;
}

interface Subscriber {
  id: string;
  name: string;
  targetUrl: string;
  eventTypes: string;
  enabled: boolean;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: 'pending' | 'ok' | 'failed' | 'cancelled' | null;
  createdAt: string;
  updatedAt: string;
}

interface FunctionNames {
  functions: string[];
}

export const dynamic = 'force-dynamic';

function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

export default async function WebhooksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [endpointsResult, fnNamesResult, subscribersResult] = await Promise.all([
    apiJson<{ endpoints: Endpoint[] }>(`/v1/projects/${id}/webhooks`).catch(() => ({
      endpoints: [] as Endpoint[],
    })),
    apiJson<FunctionNames>(`/v1/projects/${id}/function-names`).catch(() => ({
      functions: [] as string[],
    })),
    apiJson<{ subscribers: Subscriber[]; knownEventTypes: string[] }>(
      `/v1/projects/${id}/outbound-webhooks`,
    ).catch(() => ({ subscribers: [] as Subscriber[], knownEventTypes: [] as string[] })),
  ]);
  const endpoints = endpointsResult.endpoints;
  const functionNames = fnNamesResult.functions;
  const subscribers = subscribersResult.subscribers;
  const knownEventTypes = subscribersResult.knownEventTypes;

  async function toggle(formData: FormData) {
    'use server';
    const { id } = await params;
    const endpointId = String(formData.get('endpointId') ?? '');
    const enabled = String(formData.get('enabled') ?? '') === 'true';
    const res = await apiFetch(`/v1/projects/${id}/webhooks/${endpointId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `toggle failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/webhooks`);
  }

  async function remove(formData: FormData) {
    'use server';
    const { id } = await params;
    const endpointId = String(formData.get('endpointId') ?? '');
    const res = await apiFetch(`/v1/projects/${id}/webhooks/${endpointId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);
    revalidatePath(`/dashboard/projects/${id}/webhooks`);
  }

  async function toggleSubscriber(formData: FormData) {
    'use server';
    const { id } = await params;
    const subscriberId = String(formData.get('subscriberId') ?? '');
    const enabled = String(formData.get('enabled') ?? '') === 'true';
    const res = await apiFetch(`/v1/projects/${id}/outbound-webhooks/${subscriberId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `toggle failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/webhooks`);
  }

  async function removeSubscriber(formData: FormData) {
    'use server';
    const { id } = await params;
    const subscriberId = String(formData.get('subscriberId') ?? '');
    const res = await apiFetch(`/v1/projects/${id}/outbound-webhooks/${subscriberId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);
    revalidatePath(`/dashboard/projects/${id}/webhooks`);
  }

  const apiOrigin = publicApiOrigin();
  // Webhook URLs use the same origin as the api (since the public route
  // is mounted on the api app). We surface this so the dashboard can
  // build the full URL the customer needs to paste into the source.
  const webhookOrigin = apiOrigin;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">webhooks</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          inbound HTTP receivers. each endpoint dispatches a verified payload to one of your
          deployed functions. authentication is HMAC-SHA256 — briven verifies every request and
          rejects anything unsigned, replayed, or mis-keyed before your function runs.
        </p>
      </header>

      <CreateWebhookForm
        projectId={id}
        apiOrigin={apiOrigin}
        webhookOrigin={webhookOrigin}
        functionNames={functionNames}
      />

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          inbound endpoints ({endpoints.length})
        </h3>
        {endpoints.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
            no inbound endpoints yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {endpoints.map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-1 gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 sm:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-sm text-[var(--color-text)]">{e.name}</span>
                    <StatusPill enabled={e.enabled} lastStatus={e.lastDeliveryStatus} />
                  </div>
                  <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
                    calls <code>{e.functionName}</code>
                    {e.lastDeliveryAt ? (
                      <span className="ml-2 text-[var(--color-text-subtle)]">
                        · last fire {formatTimestamp(e.lastDeliveryAt)}
                      </span>
                    ) : (
                      <span className="ml-2 text-[var(--color-text-subtle)]">· never fired</span>
                    )}
                  </p>
                  <p className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-subtle)]">
                    POST {webhookOrigin}/webhooks/{id}/{e.id}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <TestFireButton projectId={id} endpointId={e.id} apiOrigin={apiOrigin} />
                  <Link
                    href={`/dashboard/projects/${id}/webhooks/${e.id}/deliveries`}
                    className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                  >
                    deliveries →
                  </Link>
                  <RotateSecretButton
                    projectId={id}
                    endpointId={e.id}
                    endpointName={e.name}
                    apiOrigin={apiOrigin}
                  />
                  <form action={toggle}>
                    <input type="hidden" name="endpointId" value={e.id} />
                    <input type="hidden" name="enabled" value={(!e.enabled).toString()} />
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                    >
                      {e.enabled ? 'pause' : 'resume'}
                    </button>
                  </form>
                  <form action={remove}>
                    <input type="hidden" name="endpointId" value={e.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
                    >
                      delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── Outbound webhooks ─────────────────────────────────────── */}
      <header className="border-t border-[var(--color-border-subtle)] pt-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">outbound webhooks</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          platform → your service. briven POSTs to subscribers when project events fire (deploy
          succeeded/failed, tier changed, project suspended/resumed). every request is signed —
          verify with X-Briven-Signature exactly like the inbound surface.
        </p>
      </header>

      <CreateSubscriberForm
        projectId={id}
        apiOrigin={apiOrigin}
        knownEventTypes={knownEventTypes}
      />

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          outbound subscribers ({subscribers.length})
        </h3>
        {subscribers.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
            no outbound subscribers yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {subscribers.map((s) => (
              <li
                key={s.id}
                className="grid grid-cols-1 gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 sm:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-sm text-[var(--color-text)]">{s.name}</span>
                    <OutboundStatusPill
                      enabled={s.enabled}
                      lastStatus={s.lastDeliveryStatus}
                    />
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-[var(--color-text-muted)]">
                    POST <code>{s.targetUrl}</code>
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-[var(--color-text-subtle)]">
                    listens for: <code>{s.eventTypes}</code>
                    {s.lastDeliveryAt ? (
                      <span className="ml-2">· last fire {formatTimestamp(s.lastDeliveryAt)}</span>
                    ) : (
                      <span className="ml-2">· never fired</span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/projects/${id}/webhooks/outbound/${s.id}/deliveries`}
                    className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                  >
                    deliveries →
                  </Link>
                  <RotateSubscriberSecretButton
                    projectId={id}
                    subscriberId={s.id}
                    subscriberName={s.name}
                    apiOrigin={apiOrigin}
                  />
                  <form action={toggleSubscriber}>
                    <input type="hidden" name="subscriberId" value={s.id} />
                    <input type="hidden" name="enabled" value={(!s.enabled).toString()} />
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                    >
                      {s.enabled ? 'pause' : 'resume'}
                    </button>
                  </form>
                  <form action={removeSubscriber}>
                    <input type="hidden" name="subscriberId" value={s.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
                    >
                      delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OutboundStatusPill({
  enabled,
  lastStatus,
}: {
  enabled: boolean;
  lastStatus: Subscriber['lastDeliveryStatus'];
}) {
  if (!enabled) {
    return (
      <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        paused
      </span>
    );
  }
  if (!lastStatus || lastStatus === 'pending') {
    return (
      <span className="rounded-full border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-primary)]">
        ready
      </span>
    );
  }
  if (lastStatus === 'ok') {
    return (
      <span className="rounded-full border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-primary)]">
        last ok
      </span>
    );
  }
  if (lastStatus === 'failed') {
    return (
      <span className="rounded-full border border-[var(--color-error)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-error)]">
        last failed
      </span>
    );
  }
  return (
    <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
      {lastStatus}
    </span>
  );
}

function StatusPill({
  enabled,
  lastStatus,
}: {
  enabled: boolean;
  lastStatus: Endpoint['lastDeliveryStatus'];
}) {
  if (!enabled) {
    return (
      <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        paused
      </span>
    );
  }
  if (!lastStatus) {
    return (
      <span className="rounded-full border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-primary)]">
        ready
      </span>
    );
  }
  if (lastStatus === 'ok') {
    return (
      <span className="rounded-full border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-primary)]">
        last ok
      </span>
    );
  }
  if (lastStatus === 'invoke_error') {
    return (
      <span className="rounded-full border border-[var(--color-error)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-error)]">
        last fn error
      </span>
    );
  }
  if (lastStatus === 'rejected_signature' || lastStatus === 'rejected_replay') {
    return (
      <span className="rounded-full border border-[var(--color-warning)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-warning)]">
        sig rejected
      </span>
    );
  }
  return (
    <span className="rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-text-subtle)]">
      {lastStatus}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' utc';
}
