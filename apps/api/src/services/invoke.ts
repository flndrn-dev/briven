import { brivenError, NotFoundError } from '@briven/shared';

import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { getCurrentDeployment } from './deployments.js';
import { getPlainEnvForProject } from './project-env.js';

export interface InvokeInput {
  projectId: string;
  functionName: string;
  args: unknown;
  requestId: string;
  auth: {
    userId: string;
    tokenType: 'session' | 'api_key';
  } | null;
}

export type InvokeResult =
  | {
      ok: true;
      value: unknown;
      durationMs: number;
      deploymentId: string;
      touchedTables: readonly string[];
    }
  | {
      ok: false;
      code: string;
      message: string;
      durationMs: number;
      deploymentId: string;
      touchedTables?: readonly string[];
    };

/**
 * Forward an invoke to apps/runtime. The control plane is the only caller
 * that can reach the runtime — the runtime itself requires the shared
 * secret, and we never expose the runtime URL publicly.
 */
export async function invoke(input: InvokeInput): Promise<InvokeResult> {
  const deployment = await getCurrentDeployment(input.projectId);
  if (!deployment) throw new NotFoundError('deployment', input.projectId);

  const functionNames = (deployment.functionNames as string[] | null) ?? [];
  if (!functionNames.includes(input.functionName)) {
    throw new NotFoundError('function', input.functionName);
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (env.BRIVEN_RUNTIME_SHARED_SECRET) {
    headers['authorization'] = `Bearer ${env.BRIVEN_RUNTIME_SHARED_SECRET}`;
  }

  // Pull per-project env vars. Encrypted at rest, decrypted only here and
  // shipped to the runtime over the swarm overlay. The runtime never caches
  // them and `ctx.env` is the only surface exposed to user code.
  const projectEnv = await getPlainEnvForProject(input.projectId).catch(() => ({}));

  let res: Response;
  try {
    res = await fetch(`${env.BRIVEN_RUNTIME_URL}/invoke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        projectId: input.projectId,
        functionName: input.functionName,
        deploymentId: deployment.id,
        requestId: input.requestId,
        args: input.args,
        auth: input.auth,
        env: projectEnv,
      }),
    });
  } catch (err) {
    log.error('runtime_unreachable', {
      projectId: input.projectId,
      message: err instanceof Error ? err.message : String(err),
    });
    throw new brivenError('runtime_unreachable', 'function runtime is unreachable', {
      status: 502,
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.error('runtime_error', {
      projectId: input.projectId,
      status: res.status,
      body: body.slice(0, 500),
    });
    throw new brivenError('runtime_error', 'function runtime returned an error', {
      status: 502,
    });
  }

  const payload = (await res.json()) as {
    ok: boolean;
    value?: unknown;
    code?: string;
    message?: string;
    durationMs?: number;
    touchedTables?: string[];
  };

  const durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : 0;
  const touchedTables = payload.touchedTables ?? [];
  if (payload.ok) {
    return {
      ok: true,
      value: payload.value,
      durationMs,
      deploymentId: deployment.id,
      touchedTables,
    };
  }
  return {
    ok: false,
    code: payload.code ?? 'unknown_error',
    message: payload.message ?? 'unknown error',
    durationMs,
    deploymentId: deployment.id,
    touchedTables,
  };
}
