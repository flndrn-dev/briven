import { StreamableHTTPTransport } from '@hono/mcp';
import { Hono } from 'hono';

import { hashIp } from '../services/audit.js';
import { verifyMcpKey } from '../services/mcp-access.js';
import { buildMcpServer } from '../services/mcp-tools.js';

/**
 * mcp.briven.tech — the live MCP server endpoint, mounted INSIDE the existing
 * api (not a new app/container). An AI agent connects here over the MCP
 * Streamable HTTP transport, presents a per-project key as
 * `Authorization: Bearer pk_briven_mcp_…`, and is HARD-LOCKED to exactly that
 * one project's DoltGres data-plane database for the life of the request.
 *
 * Transport choice: the api runs on Bun and composes routes with Hono's Fetch
 * model (Request/Response), whereas the SDK's own `StreamableHTTPServerTransport`
 * is built around Node's `http` `IncomingMessage`/`ServerResponse`. `@hono/mcp`'s
 * `StreamableHTTPTransport` is the SDK-compatible Streamable HTTP transport that
 * speaks Hono's `Context` directly — so it drops into this Bun/Hono app with no
 * Node-http shim. It is run STATELESS (`sessionIdGenerator: undefined`): a fresh
 * server + transport is built per request, bound to the freshly-verified key, so
 * a binding can never leak across keys or sessions. `enableJsonResponse` returns
 * a plain JSON-RPC response (no SSE) for simple request/response clients.
 *
 * CSRF: the global `csrfOriginCheck` middleware has a Bearer-token carve-out, so
 * a server-to-server MCP POST carrying `Authorization: Bearer …` is never gated
 * by the browser-origin check.
 */
export const mcpServerRouter = new Hono();

const BEARER_RE = /^Bearer\s+(.+)$/i;

// Streamable HTTP clients open a GET /mcp to listen for server->client SSE
// messages, and may send DELETE /mcp to end a session. This server is STATELESS
// (`sessionIdGenerator: undefined`) and answers every POST inline as JSON, so it
// offers no server->client stream and holds no session to terminate. Per the MCP
// Streamable HTTP spec the correct answer is an immediate 405 Method Not Allowed.
// Previously these fell through the `.all` handler into the transport, where the
// GET path hung ~10s and then 500'd — which stalled the client's connection until
// it timed out and got benched. Answering 405 instantly keeps the door responsive.
mcpServerRouter.on(['GET', 'DELETE'], '/mcp', (c) =>
  c.json(
    { jsonrpc: '2.0', error: { code: -32000, message: 'Method Not Allowed' }, id: null },
    405,
    { Allow: 'POST' },
  ),
);

mcpServerRouter.post('/mcp', async (c) => {
  // 1. Extract the presented key from the Authorization header.
  const authz = c.req.header('authorization') ?? '';
  const presented = BEARER_RE.exec(authz)?.[1]?.trim() ?? null;

  // 2. Verify it + resolve the project binding. 401 = bad/missing/revoked key;
  //    403 = valid key but a plan/enablement gate refused it. The plaintext key
  //    is never logged.
  const verified = await verifyMcpKey(presented);
  if (!verified.ok) {
    return c.json({ error: 'mcp_access_denied', reason: verified.reason }, verified.status);
  }

  // 3. Build a server bound to THIS key's project + scope and let the transport
  //    drive the JSON-RPC exchange. Each tool derives the project id from this
  //    binding only — never from the request payload.
  const ipHash = hashIp(
    c.req.raw.headers.get('cf-connecting-ip') ?? c.req.raw.headers.get('x-forwarded-for'),
  );
  const server = buildMcpServer({
    keyId: verified.keyId,
    projectId: verified.projectId,
    scope: verified.scope,
    ipHash,
    userAgent: c.req.header('user-agent') ?? null,
  });

  const transport = new StreamableHTTPTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(c);
  return res ?? c.body(null, 204);
});
