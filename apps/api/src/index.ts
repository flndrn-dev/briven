import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { env } from './env.js';
import { log } from './lib/logger.js';
import { accessLog } from './middleware/access-log.js';
import { errorHandler } from './middleware/error.js';
import { requestId } from './middleware/request-id.js';
import { attachSession, type Session, type User } from './middleware/session.js';
import { adminRouter } from './routes/admin.js';
import { apiKeysRouter } from './routes/api-keys.js';
import { authRouter } from './routes/auth.js';
import { billingRouter } from './routes/billing.js';
import { deploymentsRouter } from './routes/deployments.js';
import { healthRouter } from './routes/health.js';
import { internalRouter } from './routes/internal.js';
import { invitationsRouter } from './routes/invitations.js';
import { invokeRouter } from './routes/invoke.js';
import { meRouter } from './routes/me.js';
import { projectEnvRouter } from './routes/project-env.js';
import { membersRouter } from './routes/project-members.js';
import { projectsRouter } from './routes/projects.js';
import { rootRouter } from './routes/root.js';

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
app.use('*', attachSession());

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

app.notFound((c) => c.json({ code: 'not_found', message: 'route not found' }, 404));
app.onError(errorHandler);

log.info('api_boot', { port: env.BRIVEN_API_PORT, origin: env.BRIVEN_API_ORIGIN });

export default {
  port: env.BRIVEN_API_PORT,
  fetch: app.fetch,
};
