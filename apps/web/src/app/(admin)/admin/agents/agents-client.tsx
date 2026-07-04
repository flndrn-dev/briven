'use client';

import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';

import { StepUpPrompt } from '@/components/step-up-prompt';
import { BotIcon } from '@/components/ui/bot';
import { TriangleAlertIcon } from '@/components/ui/triangle-alert';
import { ZapIcon } from '@/components/ui/zap';

import { EmptyState, EmptyStateButton } from '../_components/empty-state';
import { Section } from '../_components/section';

/* ─── payload types (mirror /v1/admin/agents) ────────────────────────────── */

export type AgentScope = 'read' | 'read-write' | 'admin';
export type AgentProvider =
  | 'anthropic'
  | 'openai'
  | 'xai'
  | 'zai'
  | 'deepseek'
  | 'ollama'
  | 'flndrnai'
  | 'custom';

export interface MaskedAgent {
  id: string;
  name: string;
  provider: string;
  endpoint: string | null;
  model: string;
  scope: AgentScope;
  enabled: boolean;
  hasKey: boolean;
  keyPrefix: string | null;
  keySuffix: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentsPayload {
  agents: MaskedAgent[];
}

interface TestResult {
  agentId: string;
  ok: boolean;
  status: number;
  message: string;
}

/* ─── small fetch helper with step-up + validation detection ─────────────── */

type SendResult =
  | { kind: 'ok'; data: unknown }
  | { kind: 'step_up' }
  | { kind: 'error'; message: string };

interface ApiErrorBody {
  code?: string;
  message?: string;
  issues?: Array<{ path?: Array<string | number>; message?: string }>;
}

async function send(
  apiOrigin: string,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<SendResult> {
  try {
    const res = await fetch(`${apiOrigin}${path}`, {
      method,
      credentials: 'include',
      headers:
        body === undefined
          ? { accept: 'application/json' }
          : { 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return { kind: 'ok', data: await res.json().catch(() => ({})) };

    const parsed = (await res.json().catch(() => null)) as ApiErrorBody | null;
    if (res.status === 403 && parsed?.code === 'step_up_required') return { kind: 'step_up' };
    if (parsed?.code === 'validation_failed' && Array.isArray(parsed.issues)) {
      const details = parsed.issues
        .map((i) =>
          [Array.isArray(i.path) ? i.path.join('.') : '', i.message ?? '']
            .filter((s) => s.length > 0)
            .join(': '),
        )
        .filter((s) => s.length > 0)
        .join(' · ');
      return { kind: 'error', message: details || parsed.message || 'validation failed' };
    }
    return { kind: 'error', message: parsed?.message || `request failed: ${res.status}` };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'request failed' };
  }
}

/* ─── board ──────────────────────────────────────────────────────────────── */

export function AgentsBoard({
  apiOrigin,
  initial,
}: {
  apiOrigin: string;
  initial: AgentsPayload | null;
}) {
  const [agents, setAgents] = useState<MaskedAgent[] | null>(initial?.agents ?? null);
  const [failed, setFailed] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiOrigin}/v1/admin/agents`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`agents failed: ${res.status}`);
      const json = (await res.json()) as AgentsPayload;
      setAgents(json.agents);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [apiOrigin]);

  useEffect(() => {
    void load();
  }, [load]);

  if (agents === null) {
    if (failed) {
      return (
        <EmptyState
          icon={<TriangleAlertIcon size={28} />}
          title="agent list unavailable"
          message="the api didn't answer — it may be restarting or your session may have expired."
          action={<EmptyStateButton onClick={() => void load()}>retry now</EmptyStateButton>}
        />
      );
    }
    return (
      <EmptyState
        icon={<BotIcon size={28} />}
        title="loading agents…"
        message="fetching the registered agents and their masked credentials."
      />
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-primary)]">
              <BotIcon size={20} />
            </span>
            <h1 className="font-mono text-xl tracking-tight">ai agents</h1>
          </div>
          <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
            the control room for provider credentials — register an agent, store its api key
            encrypted, and it never appears in full again. only the prefix…suffix hint remains.
          </p>
        </div>
        {!showAdd ? (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
          >
            + add agent
          </button>
        ) : null}
      </header>

      {showAdd ? (
        <Section title="register a new agent" icon={<BotIcon size={16} />}>
          <AgentCreatePanel
            apiOrigin={apiOrigin}
            onDone={() => {
              setShowAdd(false);
              void load();
            }}
            onCancel={() => setShowAdd(false)}
          />
        </Section>
      ) : null}

      <Section
        title={`registered agents · ${agents.length}`}
        icon={<ZapIcon size={16} />}
      >
        {agents.length === 0 ? (
          <EmptyState
            icon={<BotIcon size={28} />}
            title="no agents registered yet"
            message="add your first agent to give the platform a brain — its api key is stored encrypted and shown never again."
            action={
              !showAdd ? (
                <EmptyStateButton onClick={() => setShowAdd(true)}>
                  add your first agent
                </EmptyStateButton>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                apiOrigin={apiOrigin}
                agent={agent}
                onChanged={() => void load()}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ─── shared form (create + edit) ────────────────────────────────────────── */

interface AgentFormValues {
  name: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  scope: AgentScope;
  enabled: boolean;
}

const PROVIDERS: readonly AgentProvider[] = [
  'anthropic',
  'openai',
  'xai',
  'zai',
  'deepseek',
  'ollama',
  'flndrnai',
  'custom',
];
const SCOPES: readonly AgentScope[] = ['read', 'read-write', 'admin'];

// Default endpoint per provider. Auto-filled when a provider is picked, but
// only if the endpoint is empty or still equals a known preset — never
// clobbering a value the operator hand-typed. 'custom' stays blank.
const PROVIDER_ENDPOINTS: Record<AgentProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',
  zai: 'https://api.z.ai/api/paas/v4',
  deepseek: 'https://api.deepseek.com',
  ollama: 'http://localhost:11434/v1',
  flndrnai: 'https://ai.flndrn.com/v1',
  custom: '',
};

// Every known preset value — used to decide whether an endpoint is still a
// preset (safe to overwrite) versus a hand-typed value (must be preserved).
const KNOWN_ENDPOINTS: ReadonlySet<string> = new Set(
  Object.values(PROVIDER_ENDPOINTS).filter((v) => v.length > 0),
);

// A helpful model-id hint per provider, shown as the input placeholder.
const PROVIDER_MODEL_HINTS: Record<AgentProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  xai: 'grok-2',
  zai: 'glm-4',
  deepseek: 'deepseek-chat',
  ollama: 'llama3.1',
  flndrnai: 'llama3.1',
  custom: 'e.g. claude-sonnet-4-6',
};

const INPUT_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]';
const LABEL_CLASS =
  'font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]';

function AgentForm({
  mode,
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial?: MaskedAgent;
  busy: boolean;
  onSubmit: (values: AgentFormValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [provider, setProvider] = useState(initial?.provider ?? 'anthropic');
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? '');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(initial?.model ?? '');
  const [scope, setScope] = useState<AgentScope>(initial?.scope ?? 'read');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [localError, setLocalError] = useState<string | null>(null);

  const endpointish = provider === 'custom' || provider === 'ollama';

  // Switching provider auto-fills the endpoint from the preset — but only when
  // the field is empty or still holds a known preset, so a hand-typed url is
  // never overwritten. 'custom' has a blank preset, so it leaves things alone.
  function handleProviderChange(next: string) {
    setProvider(next);
    const preset = PROVIDER_ENDPOINTS[next as AgentProvider] ?? '';
    if (preset.length === 0) return;
    const current = endpoint.trim();
    if (current.length === 0 || KNOWN_ENDPOINTS.has(current)) {
      setEndpoint(preset);
    }
  }

  const modelHint = PROVIDER_MODEL_HINTS[provider as AgentProvider] ?? 'e.g. claude-sonnet-4-6';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (name.trim().length === 0) {
      setLocalError('name the agent first.');
      return;
    }
    if (model.trim().length === 0) {
      setLocalError('a model id is required — e.g. claude-sonnet-4-6.');
      return;
    }
    if (apiKey.length > 0 && apiKey.length < 12) {
      setLocalError('api key looks too short — real provider keys are at least 12 characters.');
      return;
    }
    onSubmit({
      name: name.trim(),
      provider,
      endpoint: endpoint.trim(),
      apiKey,
      model: model.trim(),
      scope,
      enabled,
    });
    // Never keep the plaintext around after submit.
    setApiKey('');
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>name</span>
          <input
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="e.g. support-triage-bot"
            maxLength={120}
            disabled={busy}
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>provider</span>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.currentTarget.value)}
            disabled={busy}
            className={INPUT_CLASS}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={LABEL_CLASS}>endpoint url · optional</span>
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.currentTarget.value)}
            placeholder="https://…"
            type="url"
            disabled={busy}
            className={INPUT_CLASS}
          />
          {endpointish && endpoint.trim().length === 0 ? (
            <span className="font-mono text-[10px] text-[var(--color-warning)]">
              {provider} agents usually need an endpoint url — where should requests go?
            </span>
          ) : (
            <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              auto-filled from the provider — edit if yours differs.
            </span>
          )}
          {provider === 'flndrnai' ? (
            <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              points at ai.flndrn.com — the operator&apos;s own ollama gateway.
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={LABEL_CLASS}>api key</span>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.currentTarget.value)}
            type="password"
            autoComplete="off"
            placeholder={mode === 'edit' ? '••••••••' : 'sk-…'}
            disabled={busy}
            className={INPUT_CLASS}
          />
          <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
            {mode === 'edit'
              ? 'leave empty to keep the current key — filling it rotates the key.'
              : 'stored encrypted — shown never again.'}
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>model</span>
          <input
            value={model}
            onChange={(e) => setModel(e.currentTarget.value)}
            placeholder={`e.g. ${modelHint}`}
            maxLength={120}
            disabled={busy}
            className={INPUT_CLASS}
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>scope</span>
          <div className="flex overflow-hidden rounded-md border border-[var(--color-border)]">
            {SCOPES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                disabled={busy}
                className={
                  scope === s
                    ? 'flex-1 bg-[var(--color-primary-subtle)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]'
                    : 'flex-1 bg-[var(--color-surface-raised)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] transition hover:text-[var(--color-text)]'
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          disabled={busy}
          className={
            enabled
              ? 'inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary-subtle)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]'
              : 'inline-flex items-center gap-1.5 rounded-md bg-[var(--color-surface-raised)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]'
          }
        >
          <span
            className={`size-1.5 rounded-full ${
              enabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-text-subtle)]'
            }`}
          />
          {enabled ? 'enabled' : 'disabled'}
        </button>
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          disabled agents keep their credentials but can&apos;t be used.
        </span>
      </div>

      {localError ? (
        <p className="font-mono text-[10px] text-[var(--color-error)]">{localError}</p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {busy ? 'saving…' : mode === 'create' ? 'register agent' : 'save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          cancel
        </button>
      </div>
    </form>
  );
}

/* ─── create panel ───────────────────────────────────────────────────────── */

function AgentCreatePanel({
  apiOrigin,
  onDone,
  onCancel,
}: {
  apiOrigin: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | { run: () => Promise<void>; reason: string }>(null);

  async function create(values: AgentFormValues) {
    const body: Record<string, unknown> = {
      name: values.name,
      provider: values.provider,
      model: values.model,
      scope: values.scope,
      enabled: values.enabled,
    };
    if (values.endpoint.length > 0) body.endpoint = values.endpoint;
    if (values.apiKey.length > 0) body.apiKey = values.apiKey;

    const run = async () => {
      setBusy(true);
      setError(null);
      const result = await send(apiOrigin, '/v1/admin/agents', 'POST', body);
      setBusy(false);
      if (result.kind === 'step_up') {
        setPending({ run, reason: `registering agent ${values.name}.` });
        return;
      }
      if (result.kind === 'error') {
        setError(result.message);
        return;
      }
      onDone();
    };
    await run();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6"
    >
      <AgentForm mode="create" busy={busy} onSubmit={(v) => void create(v)} onCancel={onCancel} />
      {error ? <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p> : null}
      {pending != null ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason={pending.reason}
          onSuccess={async () => {
            const job = pending;
            setPending(null);
            if (job) await job.run();
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </motion.div>
  );
}

/* ─── agent card ─────────────────────────────────────────────────────────── */

function AgentCard({
  apiOrigin,
  agent,
  onChanged,
}: {
  apiOrigin: string;
  agent: MaskedAgent;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | { run: () => Promise<void>; reason: string }>(null);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  async function mutate(
    reason: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown | undefined,
    after?: () => void,
  ) {
    const run = async () => {
      setBusy(true);
      setError(null);
      const result = await send(apiOrigin, path, method, body);
      setBusy(false);
      if (result.kind === 'step_up') {
        setPending({ run, reason });
        return;
      }
      if (result.kind === 'error') {
        setError(result.message);
        return;
      }
      if (after) after();
      onChanged();
    };
    await run();
  }

  async function toggleEnabled() {
    await mutate(
      `${agent.enabled ? 'disabling' : 'enabling'} agent ${agent.name}.`,
      'PATCH',
      `/v1/admin/agents/${agent.id}`,
      { enabled: !agent.enabled },
    );
  }

  async function saveEdit(values: AgentFormValues) {
    const body: Record<string, unknown> = {
      name: values.name,
      provider: values.provider,
      model: values.model,
      scope: values.scope,
      enabled: values.enabled,
      endpoint: values.endpoint.length > 0 ? values.endpoint : null,
    };
    if (values.apiKey.length > 0) body.apiKey = values.apiKey;
    await mutate(
      `updating agent ${agent.name}.`,
      'PATCH',
      `/v1/admin/agents/${agent.id}`,
      body,
      () => setEditing(false),
    );
  }

  async function remove() {
    await mutate(
      `deleting agent ${agent.name} and its stored credentials.`,
      'DELETE',
      `/v1/admin/agents/${agent.id}`,
      undefined,
      () => setConfirmingDelete(false),
    );
  }

  async function test() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    const result = await send(apiOrigin, `/v1/admin/agents/${agent.id}/test`, 'POST', {});
    setTesting(false);
    if (result.kind === 'step_up') {
      setPending({
        run: async () => {
          await test();
        },
        reason: `testing agent ${agent.name}.`,
      });
      return;
    }
    if (result.kind === 'error') {
      setError(result.message);
      return;
    }
    setTestResult(result.data as TestResult);
  }

  const maskedKey = agent.hasKey
    ? `${agent.keyPrefix ?? ''}…${agent.keySuffix ?? ''}`
    : 'no key';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex flex-col gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-sm text-[var(--color-text)]">{agent.name}</span>
          <span className="rounded-md bg-[var(--color-surface-raised)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
            {agent.provider}
          </span>
          <ScopeBadge scope={agent.scope} />
          <span
            className={
              agent.enabled
                ? 'inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary-subtle)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]'
                : 'inline-flex items-center gap-1.5 rounded-md bg-[var(--color-surface-raised)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]'
            }
          >
            <span
              className={`size-1.5 rounded-full ${
                agent.enabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-text-subtle)]'
              }`}
            />
            {agent.enabled ? 'enabled' : 'disabled'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void test()}
            disabled={busy || testing}
            className="rounded-md border border-[var(--color-border)] px-2.5 py-1 font-mono text-[10px] text-[var(--color-text-muted)] transition hover:text-[var(--color-primary)] disabled:opacity-50"
          >
            {testing ? 'testing…' : 'test'}
          </button>
          <button
            type="button"
            onClick={() => void toggleEnabled()}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] px-2.5 py-1 font-mono text-[10px] text-[var(--color-text-muted)] transition hover:text-[var(--color-text)] disabled:opacity-50"
          >
            {agent.enabled ? 'disable' : 'enable'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v);
              setConfirmingDelete(false);
            }}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] px-2.5 py-1 font-mono text-[10px] text-[var(--color-text-muted)] transition hover:text-[var(--color-text)] disabled:opacity-50"
          >
            {editing ? 'close' : 'edit'}
          </button>
          {confirmingDelete ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="rounded-md bg-[var(--color-error)] px-2.5 py-1 font-mono text-[10px] text-[var(--color-text-inverse)] disabled:opacity-50"
              >
                {busy ? 'deleting…' : 'yes, delete'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
                className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="rounded-md border border-[var(--color-border)] px-2.5 py-1 font-mono text-[10px] text-[var(--color-text-muted)] transition hover:text-[var(--color-error)] disabled:opacity-50"
            >
              delete
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 font-mono text-[11px] text-[var(--color-text-muted)]">
        <span>
          <span className="text-[var(--color-text-subtle)]">model </span>
          {agent.model}
        </span>
        <span>
          <span className="text-[var(--color-text-subtle)]">key </span>
          {agent.hasKey ? (
            maskedKey
          ) : (
            <span className="text-[var(--color-text-subtle)]">no key</span>
          )}
        </span>
        {agent.endpoint ? (
          <span className="break-all">
            <span className="text-[var(--color-text-subtle)]">endpoint </span>
            {agent.endpoint}
          </span>
        ) : null}
        <span>
          <span className="text-[var(--color-text-subtle)]">added </span>
          {formatDate(agent.createdAt)}
        </span>
      </div>

      {testResult ? (
        <p
          className={`font-mono text-[10px] ${
            testResult.ok ? 'text-[var(--color-primary)]' : 'text-[var(--color-error)]'
          }`}
        >
          {testResult.ok ? 'ok' : 'fail'} · status {testResult.status} · {testResult.message}
        </p>
      ) : null}

      {error ? <p className="font-mono text-[10px] text-[var(--color-error)]">{error}</p> : null}

      {editing ? (
        <div className="border-t border-[var(--color-border-subtle)] pt-4">
          <AgentForm
            mode="edit"
            initial={agent}
            busy={busy}
            onSubmit={(v) => void saveEdit(v)}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : null}

      {pending != null ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason={pending.reason}
          onSuccess={async () => {
            const job = pending;
            setPending(null);
            if (job) await job.run();
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </motion.div>
  );
}

/* ─── small pieces ───────────────────────────────────────────────────────── */

function ScopeBadge({ scope }: { scope: AgentScope }) {
  const cls =
    scope === 'admin'
      ? 'text-[var(--color-warning)]'
      : scope === 'read-write'
        ? 'text-[var(--color-text)]'
        : 'text-[var(--color-text-subtle)]';
  return (
    <span
      className={`inline-flex rounded-md bg-[var(--color-surface-raised)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls}`}
    >
      {scope}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
