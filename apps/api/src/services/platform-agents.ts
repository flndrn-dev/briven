import { brivenError, newId, NotFoundError, ValidationError } from '@briven/shared';

import { asc, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  platformAgents,
  type PlatformAgent,
  type PlatformAgentScope,
} from '../db/schema.js';
import { decryptTenantSecret, encryptTenantSecret } from './tenant-secret-store.js';

/**
 * Platform-agent manager — CRUD over the `platform_agents` registry the
 * admin cockpit uses to wire up named AI agents (anthropic / openai /
 * ollama / custom).
 *
 * Secret handling: unlike mcp-access.ts (where WE mint the key and persist
 * only a hash), the api key here is INPUT by the admin and must be
 * recoverable server-side — the /test ping (and future outbound agent
 * calls) present it to the provider. So it is stored as AES-256-GCM
 * ciphertext produced by the EXISTING tenant-secret-store primitives
 * (HKDF-SHA256 derived key + the shared iv||tag||body wire format).
 * The HKDF salt slot normally carries a project id; here it carries the
 * AGENT id, so every agent's key is encrypted under its own derived key —
 * a leak of one agent's plaintext never decrypts another's blob. The
 * master key is BRIVEN_AUTH_MASTER_KEY (the 'auth' service slot).
 *
 * Plaintext is NEVER logged, NEVER stored, and NEVER returned after
 * creation — reads only ever see `keyPrefix…keySuffix`, mirroring
 * mcp-access.ts `maskKey`.
 */

/* ─── masking ────────────────────────────────────────────────────────────── */

/** First chars shown in the masked hint. Suffix is always the last 4. */
const KEY_PREFIX_CHARS = 4;
const KEY_SUFFIX_CHARS = 4;

/**
 * Displayable fragments of an admin-supplied key. The zod boundary enforces
 * a minimum plaintext length well above prefix+suffix, so the hint can never
 * reconstruct the key.
 */
export function maskAgentKey(plaintext: string): { keyPrefix: string; keySuffix: string } {
  return {
    keyPrefix: plaintext.slice(0, KEY_PREFIX_CHARS),
    keySuffix: plaintext.slice(-KEY_SUFFIX_CHARS),
  };
}

export interface MaskedPlatformAgent {
  id: string;
  name: string;
  provider: string;
  endpoint: string | null;
  model: string;
  scope: PlatformAgentScope;
  enabled: boolean;
  /** True when an encrypted key is on file. The key itself is never returned. */
  hasKey: boolean;
  keyPrefix: string | null;
  keySuffix: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Strip the ciphertext; never return it. Mirrors mcp-access.ts maskKey. */
export function maskAgent(row: PlatformAgent): MaskedPlatformAgent {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    endpoint: row.endpoint,
    model: row.model,
    scope: row.scope,
    enabled: row.enabled,
    hasKey: row.encryptedApiKey !== null,
    keyPrefix: row.keyPrefix,
    keySuffix: row.keySuffix,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ─── crypto (reuse of tenant-secret-store, salted per agent) ────────────── */

function encryptAgentKey(agentId: string, plaintext: string): string {
  // 'auth' selects BRIVEN_AUTH_MASTER_KEY; the projectId slot is the HKDF
  // salt — the agent id scopes the derived key to this one agent row.
  return encryptTenantSecret({ service: 'auth', projectId: agentId, plaintext });
}

function decryptAgentKey(agentId: string, ciphertext: string): string {
  return decryptTenantSecret({ service: 'auth', projectId: agentId, ciphertext });
}

/* ─── CRUD ───────────────────────────────────────────────────────────────── */

export interface CreatePlatformAgentInput {
  name: string;
  provider: string;
  endpoint?: string | null;
  /** Admin-supplied provider key. Optional — local/keyless endpoints exist. */
  apiKey?: string | null;
  model: string;
  scope: PlatformAgentScope;
  enabled?: boolean;
}

export interface UpdatePlatformAgentInput {
  name?: string;
  provider?: string;
  endpoint?: string | null;
  /** When present, the stored key is re-encrypted with this new plaintext. */
  apiKey?: string;
  model?: string;
  scope?: PlatformAgentScope;
  enabled?: boolean;
}

/** All agents, masked, stable name order for the cockpit table. */
export async function listPlatformAgents(): Promise<MaskedPlatformAgent[]> {
  const db = getDb();
  const rows = await db.select().from(platformAgents).orderBy(asc(platformAgents.name));
  return rows.map(maskAgent);
}

async function getAgentRow(agentId: string): Promise<PlatformAgent> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(platformAgents)
    .where(eq(platformAgents.id, agentId))
    .limit(1);
  if (!row) throw new NotFoundError('agent', agentId);
  return row;
}

/** 409 mapper for the unique name index — names are the registry identity. */
function duplicateName(name: string): brivenError {
  return new brivenError('duplicate', `an agent named "${name}" already exists`, {
    status: 409,
  });
}

/** True when the error is postgres unique_violation (code 23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}

/**
 * Register an agent. The api key (when given) is encrypted before the row is
 * written; the returned shape is masked — the plaintext is NEVER echoed back,
 * not even on this first response (the admin typed it; they already have it).
 */
export async function createPlatformAgent(
  input: CreatePlatformAgentInput,
  createdBy: string | null,
): Promise<MaskedPlatformAgent> {
  const db = getDb();
  const agentId = newId('agt');
  const apiKey = input.apiKey ?? null;
  try {
    const [row] = await db
      .insert(platformAgents)
      .values({
        id: agentId,
        name: input.name,
        provider: input.provider,
        endpoint: input.endpoint ?? null,
        model: input.model,
        scope: input.scope,
        enabled: input.enabled ?? true,
        encryptedApiKey: apiKey ? encryptAgentKey(agentId, apiKey) : null,
        keyPrefix: apiKey ? maskAgentKey(apiKey).keyPrefix : null,
        keySuffix: apiKey ? maskAgentKey(apiKey).keySuffix : null,
        createdBy,
      })
      .returning();
    if (!row) throw new Error('platform agent insert returned no row');
    return maskAgent(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateName(input.name);
    throw err;
  }
}

/**
 * Patch an agent. Only the provided fields change; when `apiKey` is present
 * the stored ciphertext is replaced with a fresh encryption of the new key
 * (and the masked hint is refreshed alongside it).
 */
export async function updatePlatformAgent(
  agentId: string,
  patch: UpdatePlatformAgentInput,
): Promise<MaskedPlatformAgent> {
  await getAgentRow(agentId); // 404 before we attempt a write
  const db = getDb();
  const set: Partial<typeof platformAgents.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.provider !== undefined) set.provider = patch.provider;
  if (patch.endpoint !== undefined) set.endpoint = patch.endpoint;
  if (patch.model !== undefined) set.model = patch.model;
  if (patch.scope !== undefined) set.scope = patch.scope;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.apiKey !== undefined) {
    set.encryptedApiKey = encryptAgentKey(agentId, patch.apiKey);
    const hint = maskAgentKey(patch.apiKey);
    set.keyPrefix = hint.keyPrefix;
    set.keySuffix = hint.keySuffix;
  }
  try {
    const [row] = await db
      .update(platformAgents)
      .set(set)
      .where(eq(platformAgents.id, agentId))
      .returning();
    if (!row) throw new NotFoundError('agent', agentId);
    return maskAgent(row);
  } catch (err) {
    if (isUniqueViolation(err) && patch.name) throw duplicateName(patch.name);
    throw err;
  }
}

/** Hard-delete an agent row (ciphertext goes with it). 404 when unknown. */
export async function deletePlatformAgent(agentId: string): Promise<void> {
  await getAgentRow(agentId);
  const db = getDb();
  await db.delete(platformAgents).where(eq(platformAgents.id, agentId));
}

/* ─── connectivity test ──────────────────────────────────────────────────── */

/**
 * Well-known API origins for hosted providers, used when the agent has no
 * explicit endpoint. Both paths are cheap authenticated GETs, so a 200
 * means "reachable AND the key is accepted".
 */
const PROVIDER_DEFAULT_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1/models',
  openai: 'https://api.openai.com/v1/models',
};

const TEST_TIMEOUT_MS = 5_000;

export interface AgentTestResult {
  ok: boolean;
  /** HTTP status from the provider, when the request got that far. */
  status: number | null;
  message: string;
}

/**
 * Server-side connectivity ping. Decrypts the key IN MEMORY ONLY, sends one
 * GET to the agent's endpoint (or the provider's well-known models URL) with
 * the provider-appropriate auth header, and reports reachable / rejected /
 * unreachable. The key and the raw provider error are never logged and never
 * leave this function — only { ok, status, message } comes back.
 */
export async function testPlatformAgent(agentId: string): Promise<AgentTestResult> {
  const agent = await getAgentRow(agentId);

  const url = agent.endpoint ?? PROVIDER_DEFAULT_URLS[agent.provider] ?? null;
  if (!url) {
    return {
      ok: false,
      status: null,
      message: `no endpoint configured and no default url is known for provider "${agent.provider}"`,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: null, message: 'endpoint is not a valid url' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, status: null, message: 'endpoint must be an http(s) url' };
  }

  const headers: Record<string, string> = {};
  if (agent.encryptedApiKey) {
    let plaintext: string;
    try {
      plaintext = decryptAgentKey(agentId, agent.encryptedApiKey);
    } catch (err) {
      // Master key missing / rotated without a re-encrypt migration. Surface
      // a plain-words failure; never the crypto internals.
      if (err instanceof ValidationError) {
        return { ok: false, status: null, message: err.message };
      }
      return { ok: false, status: null, message: 'stored key could not be decrypted' };
    }
    if (agent.provider === 'anthropic') {
      headers['x-api-key'] = plaintext;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${plaintext}`;
    }
  }

  try {
    const res = await fetch(parsed, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      redirect: 'manual',
    });
    if (res.ok) {
      return { ok: true, status: res.status, message: 'endpoint reachable' };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        status: res.status,
        message: 'endpoint reachable but the key was rejected',
      };
    }
    return {
      ok: false,
      status: res.status,
      message: `endpoint reachable but returned status ${res.status}`,
    };
  } catch {
    // Timeout, DNS failure, refused connection — the raw error can embed the
    // request (and thus headers), so it is deliberately not propagated.
    return { ok: false, status: null, message: 'endpoint unreachable (timeout or network error)' };
  }
}
