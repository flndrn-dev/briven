import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { env } from './env.js';
import { log } from './lib/logger.js';
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
import { aiRouter } from './routes/ai.js';
import { apiKeysRouter } from './routes/api-keys.js';
import { authRouter } from './routes/auth.js';
import { authServiceRouter } from './routes/auth-service.js';
import { billingRouter } from './routes/billing.js';
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
import { membersRouter } from './routes/project-members.js';
import { projectsRouter } from './routes/projects.js';
import { rootRouter } from './routes/root.js';
import { schedulesRouter } from './routes/schedules.js';
import { storageRouter } from './routes/storage.js';
import { studioRouter } from './routes/studio.js';
import { usageRouter } from './routes/usage.js';
import { incidentsRouter } from './routes/incidents.js';
import { marketingEventsPublicRouter } from './routes/marketing-events.js';
import {
  migrationRequestsPublicRouter,
  migrationRequestsRouter,
} from './routes/migration-requests.js';
import { webhooksAdminRouter } from './routes/webhooks-admin.js';
import { webhooksPublicRouter } from './routes/webhooks-public.js';
import { recordDeploy } from './services/deploy-history.js';
import { startAccountDeletionGc } from './workers/account-deletion-gc.js';
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
    origin: [env.BRIVEN_WEB_ORIGIN],
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
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

// Block state-changing routes on a suspended project at the app level
// instead of per-router — keeps the abuse-suspension gate from drifting
// when a new mutating route lands without picking up the middleware. The
// middleware short-circuits on GET/HEAD/OPTIONS so dashboards stay
// readable, and on missing :id so the unmounted segments pass through.
app.use('/v1/projects/:id', blockIfProjectSuspended());
app.use('/v1/projects/:id/*', blockIfProjectSuspended());

app.route('/', rootRouter);
app.route('/', healthRouter);
app.route('/', authRouter);
app.route('/', meRouter);
app.route('/', projectsRouter);
app.route('/', apiKeysRouter);
app.route('/', membersRouter);
app.route('/', deploymentsRouter);
app.route('/', invokeRouter);
app.route('/', internalRouter);
app.route('/', projectEnvRouter);
app.route('/', invitationsRouter);
app.route('/', adminRouter);
app.route('/', billingRouter);
app.route('/', dbRouter);
app.route('/', logsRouter);
app.route('/', usageRouter);
app.route('/', abuseRouter);
app.route('/', studioRouter);
app.route('/', exportRouter);
app.route('/', aiRouter);
app.route('/', orgsRouter);
app.route('/', mitteraWebhookRouter);
app.route('/', schedulesRouter);
app.route('/', storageRouter);
app.route('/', webhooksAdminRouter);
app.route('/', webhooksPublicRouter);
app.route('/', incidentsRouter);
app.route('/', migrationRequestsRouter);
app.route('/', migrationRequestsPublicRouter);
app.route('/', marketingEventsPublicRouter);
app.route('/', outboundWebhooksRouter);

// briven auth service router — kill-switch gated per ARCHITECTURE.md §9.
// Default-disabled in env.ts; flip BRIVEN_AUTH_ENABLED=true in Dokploy when
// the multi-tenant pool + Better Auth wiring (BUILD_PLAN.md §13 step 3+)
// is ready to serve customer traffic.
if (env.BRIVEN_AUTH_ENABLED) {
  app.route('/', authServiceRouter);
  log.info('auth_service_mounted', { kill_switch: 'on' });
}

app.notFound((c) => c.json({ code: 'not_found', message: 'route not found' }, 404));
app.onError(errorHandler);

log.info('api_boot', { port: env.BRIVEN_API_PORT, origin: env.BRIVEN_API_ORIGIN });

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
