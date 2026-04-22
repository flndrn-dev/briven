import { Hono } from 'hono';

import { requireProjectAuth } from '../middleware/project-auth.js';
import type { Session, User } from '../middleware/session.js';
import { invoke } from '../services/invoke.js';

type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    apiKeyId: string | null;
    requestId: string;
  };
};

export const invokeRouter = new Hono<AppEnv>();

// Functions are project-scoped resources, so they share project-auth with
// deployments and api-keys: either a session-bound owner or a matching brk_.
invokeRouter.use('/v1/projects/:id/functions/:name', requireProjectAuth());

invokeRouter.post('/v1/projects/:id/functions/:name', async (c) => {
  const projectId = c.req.param('id');
  const functionName = c.req.param('name');
  const user = c.get('user');
  const apiKeyId = c.get('apiKeyId');
  const requestId = c.get('requestId');

  const raw = await c.req.text();
  let args: unknown = null;
  if (raw.length > 0) {
    try {
      args = JSON.parse(raw);
    } catch {
      return c.json({ code: 'invalid_json', message: 'request body is not valid json' }, 400);
    }
  }

  const result = await invoke({
    projectId,
    functionName,
    args,
    requestId,
    auth: user
      ? { userId: user.id, tokenType: apiKeyId ? 'api_key' : 'session' }
      : apiKeyId
        ? { userId: `key:${apiKeyId}`, tokenType: 'api_key' }
        : null,
  });

  const status = result.ok ? 200 : 500;
  return c.json(result, status);
});
