import { Hono } from 'hono';

import { hashIp } from '../services/audit.js';
import { invoke } from '../services/invoke.js';
import {
  decryptEndpointSecret,
  getWebhookRaw,
  recordDelivery,
  verifyWebhookSignature,
} from '../services/webhooks.js';
import type { AppEnv } from '../types/app-env.js';

export const webhooksPublicRouter = new Hono<AppEnv>();

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB — generous for most webhook payloads
const MAX_REQUEST_ID_LEN = 64;

/**
 * Public webhook ingestion. Authenticated via HMAC-SHA256 signature only
 * — no Better Auth session, no api key, no project-role check. The
 * signature IS the authorisation.
 *
 *   POST /webhooks/:projectId/:endpointId
 *     X-Briven-Signature: v1=<hex>
 *     X-Briven-Timestamp: <unix-milliseconds>
 *     content-type: application/json
 *
 * Always inserts one row into webhook_deliveries — accepted, rejected,
 * disabled, function 500 — so the operator can see every inbound attempt
 * in the dashboard delivery log. Returns are conservative: signature
 * failures get 401, replay failures 401, missing endpoint 404, disabled
 * 410, function errors 502, success 200.
 */
webhooksPublicRouter.post('/webhooks/:projectId/:endpointId', async (c) => {
  const projectId = c.req.param('projectId');
  const endpointId = c.req.param('endpointId');
  const sourceIpHash = hashIp(
    c.req.raw.headers.get('cf-connecting-ip') ?? c.req.raw.headers.get('x-forwarded-for'),
  );

  // Body cap. Read as text first so we can HMAC-verify the EXACT bytes
  // that arrived — JSON parsing happens after verification on the way
  // into the function invoke.
  const rawBody = await c.req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    // Don't even try to record a delivery row — we don't know which
    // endpoint this was for in a useful sense, and storing the rejected
    // body opens a DoS vector. Just refuse.
    return c.json({ code: 'body_too_large', message: 'body exceeds 1 MiB cap' }, 413);
  }

  let endpoint;
  try {
    endpoint = await getWebhookRaw(endpointId, projectId);
  } catch {
    // Don't differentiate "wrong project" from "wrong endpoint" — both
    // 404 so a probe can't enumerate live endpoints.
    return c.json({ code: 'not_found' }, 404);
  }

  if (!endpoint.enabled) {
    await recordDelivery({
      endpointId: endpoint.id,
      projectId: endpoint.projectId,
      status: 'disabled',
      sourceIpHash,
      functionName: endpoint.functionName,
      durationMs: null,
      errorMessage: null,
    });
    return c.json({ code: 'disabled', message: 'endpoint is disabled' }, 410);
  }

  const signatureHeader = c.req.header('x-briven-signature') ?? null;
  const timestampHeader = c.req.header('x-briven-timestamp') ?? null;
  const verify = verifyWebhookSignature({
    rawBody,
    signatureHeader,
    timestampHeader,
    plaintextSecret: decryptEndpointSecret(endpoint),
    now: new Date(),
  });

  if (!verify.ok) {
    await recordDelivery({
      endpointId: endpoint.id,
      projectId: endpoint.projectId,
      status: verify.status,
      sourceIpHash,
      functionName: endpoint.functionName,
      durationMs: null,
      errorMessage: verify.reason,
    });
    // 401 for either rejection — don't leak which one to the source.
    return c.json({ code: verify.status }, 401);
  }

  // Body is verified. Parse and dispatch to the function. We pass the
  // body straight through as `args` — the customer's function decides
  // what to do with it. Headers aren't forwarded (Phase 3 work).
  let args: unknown;
  try {
    args = rawBody.length === 0 ? {} : JSON.parse(rawBody);
  } catch {
    await recordDelivery({
      endpointId: endpoint.id,
      projectId: endpoint.projectId,
      status: 'invoke_error',
      sourceIpHash,
      functionName: endpoint.functionName,
      durationMs: null,
      errorMessage: 'request body is not valid json',
    });
    return c.json({ code: 'invalid_json', message: 'body must be json' }, 400);
  }

  const requestId = (c.get('requestId') ?? '').slice(0, MAX_REQUEST_ID_LEN);
  const t0 = Date.now();
  try {
    const result = await invoke({
      projectId: endpoint.projectId,
      functionName: endpoint.functionName,
      args,
      requestId,
      // Webhook deliveries carry no human identity. The runtime treats
      // this the same as a scheduled invocation: no session, no api key.
      auth: null,
    });
    const durationMs = Date.now() - t0;
    if (!result.ok) {
      await recordDelivery({
        endpointId: endpoint.id,
        projectId: endpoint.projectId,
        status: 'invoke_error',
        sourceIpHash,
        functionName: endpoint.functionName,
        durationMs,
        errorMessage: `${result.code}: ${result.message}`.slice(0, 500),
      });
      return c.json({ code: 'invoke_failed', message: result.message }, 502);
    }
    await recordDelivery({
      endpointId: endpoint.id,
      projectId: endpoint.projectId,
      status: 'ok',
      sourceIpHash,
      functionName: endpoint.functionName,
      durationMs,
      errorMessage: null,
    });
    return c.json({ ok: true });
  } catch (err) {
    const durationMs = Date.now() - t0;
    const errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await recordDelivery({
      endpointId: endpoint.id,
      projectId: endpoint.projectId,
      status: 'invoke_error',
      sourceIpHash,
      functionName: endpoint.functionName,
      durationMs,
      errorMessage,
    });
    return c.json({ code: 'internal_error', message: 'invoke threw' }, 500);
  }
});
