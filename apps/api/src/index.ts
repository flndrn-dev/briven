import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';

import { env } from './env.js';
import { log } from './lib/logger.js';
import { resolveCorsOrigin, startOriginAllowlist } from './services/auth-origin-allowlist.js';
import { accessLog } from './middleware/access-log.js';
import { csrfOriginCheck } from './middleware/csrf.js';
import { errorHandler } from './middleware/error.js';
import { maintenanceMode } from './middleware/maintenance.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { blockIfProjectSuspended } from './middleware/project-suspended.js';
import { requestId } from './middleware/request-id.js';
import { attachSession, type Session, type User } from './middleware/session.js';
import { abuseRouter } from './routes/abuse.js';
import { adminRouter } from './routes/admin.js';
import { adminAgentsRouter } from './routes/admin-agents.js';
import { adminMcpRouter } from './routes/admin-mcp.js';
import { adminRevenueRouter } from './routes/admin-revenue.js';
import { adminManifestRouter } from './routes/admin-manifest.js';
import { adminTimeseriesRouter } from './routes/admin-timeseries.js';
import { aiRouter } from './routes/ai.js';
import { apiKeysRouter } from './routes/api-keys.js';
import { authRouter } from './routes/auth.js';
import { authCliRouter } from './routes/auth-cli.js';
import { authProductRetiredRouter } from './routes/auth-product-retired.js';
import { authCoreStatusRouter } from './routes/auth-core-status.js';
import { initAuthCoreSdk } from './services/auth-core/engine.js';
// Option B Phase 1: status shell only (info/ready/map). Full FDI + product
// routers stay unmounted until later phases + flndrn OK.
// import { authServiceRouter } from './routes/auth-service.js';
// import { authV2Router } from './routes/auth-v2.js';
// import { authScimRouter } from './routes/auth-scim.js';
// import { authCoreRouter } from './routes/auth-core.js';
import { billingRouter } from './routes/billing.js';
import { brandingPublicRouter } from './routes/branding-public.js';
import { dbRouter } from './routes/db.js';
import { deploymentsRouter } from './routes/deployments.js';
import { exportRouter } from './routes/export.js';
import { BUILD_AT, BUILD_SHA, healthRouter } from './routes/health.js';
import { internalRouter } from './routes/internal.js';
import { invitationsRouter } from './routes/invitations.js';
import { invokeRouter } from './routes/invoke.js';
import { logsRouter } from './routes/logs.js';
import { meRouter } from './routes/me.js';
import { mitteraWebhookRouter } from './routes/mittera-webhook.js';
import { orgsRouter } from './routes/orgs.js';
import { outboundWebhooksRouter } from './routes/outbound-webhooks.js';
import { projectEnvRouter } from './routes/project-env.js';
import { projectMcpRouter } from './routes/project-mcp.js';
import { membersRouter } from './routes/project-members.js';
import { projectsRouter } from './routes/projects.js';
import { rootRouter } from './routes/root.js';
import { schedulesRouter } from './routes/schedules.js';
import { storageKeysRouter } from './routes/storage-keys.js';
import { storageRouter } from './routes/storage.js';
import { studioRouter } from './routes/studio.js';
import { platformRouter } from './routes/platform.js';
import { usageRouter } from './routes/usage.js';
import { incidentsRouter } from './routes/incidents.js';
import { marketingEventsPublicRouter } from './routes/marketing-events.js';
import { mcpServerRouter } from './routes/mcp-server.js';
import { mediaRouter } from './routes/media.js';
import { contactPublicRouter } from './routes/contact.js';
import {
  migrationRequestsPublicRouter,
  migrationRequestsRouter,
} from './routes/migration-requests.js';
import { webhooksAdminRouter } from './routes/webhooks-admin.js';
import { webhooksPublicRouter } from './routes/webhooks-public.js';
import { recordDeploy } from './services/deploy-history.js';
import { startAccountDeletionGc } from './workers/account-deletion-gc.js';
import { startAutoSnapshotWorker } from './workers/auto-snapshot.js';
import { startScheduleDispatcher } from './workers/schedule-dispatcher.js';
import {
  startAuditRetentionCron,
  startLogFanoutWorker,
  startLogRetentionCron,
  startOutboundWebhookDeliveriesRetentionCron,
  startWebhookDeliveriesRetentionCron,
} from './workers/log-fanout.js';
import { startOutboundWebhookDispatcher } from './workers/outbound-webhook-dispatcher.js';
import { startPolarMeterPush } from './workers/polar-meter-push.js';
import { startStorageJanitor } from './workers/storage-janitor.js';
import { startUsageAggregator } from './workers/usage-aggregator.js';

type AppEnv = {
  Variables: {
    requestId: string;
    user: User | null;
    session: Session | null;
    apiKeyId: string | null;
  };
};

const app = new Hono<AppEnv>();

app.use(
  '*',
  cors({
    // Dynamic guest list: briven's own origins + any project-registered app
    // domain (services/auth-origin-allowlist). FAILS SAFE — an empty or errored
    // allowlist falls back to briven-own origins only, never an outage.
    origin: (origin) => resolveCorsOrigin(origin),
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-briven-project-id'],
    exposeHeaders: ['x-request-id'],
  }),
);

app.use('*', requestId());
app.use('*', accessLog());
app.use('*', metricsMiddleware());
app.use('*', attachSession());
app.use('*', csrfOriginCheck());
// Maintenance-mode gate. Reads platform_settings.maintenanceMode and
// returns 503 on everything except /health, /ready, /info, auth, /me,
// and admin routes. Sits AFTER attachSession so admin requests can be
// identified for the whitelist branch.
app.use('*', maintenanceMode());

// The public branding logo (served by brandingPublicRouter below) is embedded
// cross-origin via a plain <img src>: the dashboard (briven.tech) and the
// hosted auth pages load it from api.briven.tech. secureHeaders() sets
// `Cross-Origin-Resource-Policy: same-origin` on every response, which makes
// the browser refuse the image (it renders as a broken-image icon even though
// the bytes serve 200/image-png). This path-scoped override is registered
// BEFORE secureHeaders so its post-`next()` write is the OUTERMOST one — it has
// the final say and flips just this one logo route to `cross-origin`, leaving
// every other API response same-origin.
app.use('/v1/projects/:id/auth/branding/logo', async (c, next) => {
  await next();
  c.res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
});

// Security response headers (HSTS, nosniff, frame deny, etc.) on every
// API response. Placed after the global middleware chain and before the
// route mounts so all handlers inherit it.
app.use('*', secureHeaders());

// Block state-changing routes on a suspended project at the app level
// instead of per-router — keeps the abuse-suspension gate from drifting
// when a new mutating route lands without picking up the middleware. The
// middleware short-circuits on GET/HEAD/OPTIONS so dashboards stay
// readable, and on missing :id so the unmounted segments pass through.
app.use('/v1/projects/:id', blockIfProjectSuspended());
app.use('/v1/projects/:id/*', blockIfProjectSuspended());

// Mounted FIRST — before every project-auth guard — so the public branding
// logo stays genuinely public (a hosted login page loads it via <img>).
// See routes/branding-public.ts for why it can't live in authServiceRouter.
app.route('/', brandingPublicRouter);

// Public media delivery (M3) — serve files marked public from a clean
// `/media/:projectId/:fileId` path with per-tenant CORS. Mounted here (root
// level, before the project-auth guards) so it's genuinely public; it lives
// outside `/v1/projects` so the suspend/auth middleware never touches it.
app.route('/', mediaRouter);

app.route('/', rootRouter);
app.route('/', healthRouter);
app.route('/', authRouter);
app.route('/', authCliRouter);
app.route('/', meRouter);
// Briven Auth Option B Phase 1: status shell + retired customer login paths.
// Platform operator login stays on authRouter (/v1/auth/* Better Auth for briven.tech).
app.route('/', authCoreStatusRouter);
app.route('/', authProductRetiredRouter);
log.info('auth_product_phase1_shell', {
  note: 'briven-engine status (info/ready/map); app login still closed (410 on product paths)',
  engine: 'briven-engine',
  appLoginReady: false,
  platformLogin: '/v1/auth/*',
});
app.route('/', projectsRouter);
app.route('/', apiKeysRouter);
app.route('/', membersRouter);
app.route('/', deploymentsRouter);
app.route('/', invokeRouter);
app.route('/', internalRouter);
app.route('/', projectEnvRouter);
app.route('/', projectMcpRouter);
app.route('/', invitationsRouter);
app.route('/', adminRouter);
app.route('/', adminAgentsRouter);
app.route('/', adminMcpRouter);
app.route('/', adminRevenueRouter);
app.route('/', adminManifestRouter);
app.route('/', adminTimeseriesRouter);
app.route('/', billingRouter);
app.route('/', dbRouter);
app.route('/', logsRouter);
app.route('/', usageRouter);
app.route('/', abuseRouter);
app.route('/', studioRouter);
app.route('/', platformRouter);
app.route('/', exportRouter);
app.route('/', aiRouter);
app.route('/', orgsRouter);
app.route('/', mitteraWebhookRouter);
app.route('/', schedulesRouter);
app.route('/', storageRouter);
app.route('/', storageKeysRouter);
app.route('/', webhooksAdminRouter);
app.route('/', webhooksPublicRouter);
app.route('/', incidentsRouter);
app.route('/', migrationRequestsRouter);
app.route('/', migrationRequestsPublicRouter);
app.route('/', contactPublicRouter);
app.route('/', marketingEventsPublicRouter);
app.route('/', outboundWebhooksRouter);
// mcp.briven.tech — the live MCP server endpoint (Streamable HTTP at /mcp).
// Bearer-authenticated per-project key; the global csrf middleware's
// Bearer carve-out lets the server-to-server POST through.
app.route('/', mcpServerRouter);

// No full authServiceRouter / authV2Router / auth-core product mounts (Phase 1).

app.notFound((c) => c.json({ code: 'not_found', message: 'route not found' }, 404));
app.onError(errorHandler);

log.info('api_boot', { port: env.BRIVEN_API_PORT, origin: env.BRIVEN_API_ORIGIN });

// Warm the per-project allowed-origin allowlist into memory (best-effort;
// the CORS/CSRF gates fall back to briven-own origins until it loads).
startOriginAllowlist();

// Option B Phase 1: ensure Doltgres `briven_engine` DB + schema (no SuperTokens Core).
void initAuthCoreSdk().then((ok) => {
  log.info('briven_engine_boot', { ok, appLoginReady: false });
});

// Background workers — both degrade gracefully when redis/data-plane
// isn't configured (log-fanout sleeps, retention prunes nothing).
startLogFanoutWorker();
startLogRetentionCron();
startAuditRetentionCron();
startUsageAggregator();
startPolarMeterPush();
startAccountDeletionGc();
startScheduleDispatcher();
startWebhookDeliveriesRetentionCron();
startOutboundWebhookDispatcher();
startOutboundWebhookDeliveriesRetentionCron();
startStorageJanitor();
startAutoSnapshotWorker();

// Audit-trail behind /info — one row per boot. recordDeploy itself
// short-circuits when buildSha is the "dev" sentinel and never throws,
// so the request path stays alive even if the meta-DB is unreachable.
void recordDeploy({
  service: 'api',
  buildSha: BUILD_SHA,
  buildAt: BUILD_AT === 'dev' ? null : BUILD_AT,
  env: env.BRIVEN_ENV,
});

export default {
  port: env.BRIVEN_API_PORT,
  fetch: app.fetch,
};
