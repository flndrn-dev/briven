import { Hono } from 'hono';

export const rootRouter = new Hono();

rootRouter.get('/', (c) =>
  c.json({
    service: 'briven.api',
    status: 'running',
    docs: 'https://docs.briven.cloud',
  }),
);
