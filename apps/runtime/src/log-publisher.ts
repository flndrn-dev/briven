import { env } from './env.js';
import { getRedis } from './lib/redis.js';
import type { LogEntry } from './log-collector.js';

export interface InvocationEnvelope {
  projectId: string;
  deploymentId: string;
  invocationId: string;
  functionName: string;
  status: 'ok' | 'err';
  durationMs: number;
  touchedTables: readonly string[];
  userLogs: LogEntry[];
  errCode?: string;
  errMessage?: string;
  ts: string;
}

/**
 * Publish an invocation envelope to the project's Redis stream
 * (`logs:{projectId}`). The stream is MAXLEN-capped so it doesn't grow
 * unbounded; durability lives in `function_logs` (apps/api fan-out).
 *
 * Silent no-op when Redis isn't configured — invocations still succeed,
 * `briven logs --tail` just has nothing to show.
 */
export async function publishInvocation(envelope: InvocationEnvelope): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const key = `logs:${envelope.projectId}`;
  const fields: Array<string> = [
    'kind',
    'invocation',
    'deploymentId',
    envelope.deploymentId,
    'invocationId',
    envelope.invocationId,
    'functionName',
    envelope.functionName,
    'status',
    envelope.status,
    'durationMs',
    String(envelope.durationMs),
    'touchedTables',
    envelope.touchedTables.join(','),
    'logs',
    JSON.stringify(envelope.userLogs),
    'ts',
    envelope.ts,
  ];
  if (envelope.errCode) fields.push('errCode', envelope.errCode);
  if (envelope.errMessage) fields.push('errMessage', envelope.errMessage);

  try {
    // ioredis xadd signature: xadd(key, 'MAXLEN', '~', cap, '*', ...fields)
    await redis.xadd(
      key,
      'MAXLEN',
      '~',
      String(env.BRIVEN_LOGS_STREAM_MAX),
      '*',
      ...fields,
    );
  } catch (err) {
    // Don't let a flaky Redis kill the invocation path. Log to real stderr.
    // eslint-disable-next-line no-console
    console.warn(
      '[runtime] logs publish failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
