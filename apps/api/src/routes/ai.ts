import { Hono } from 'hono';
import { z } from 'zod';

import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { projectRateLimit } from '../middleware/rate-limit.js';
import { generateFunction } from '../services/ai-function-gen.js';
import { AiNotConfiguredError, generateSchema } from '../services/ai-schema-gen.js';
import type { ProjectAppEnv as AppEnv } from '../types/app-env.js';

export const aiRouter = new Hono<AppEnv>();

const generateSchemaSchema = z.object({
  prompt: z.string().min(1).max(4000),
});

const generateFunctionSchema = z.object({
  prompt: z.string().min(1).max(4000),
  // Optional — when the dashboard knows the project's current schema it
  // passes it through so the model can reference real table/column
  // names. Capped at 16 KB at the API layer; the service truncates to
  // 8 KB before forwarding to Ollama (the service cap is the binding
  // one; the wire cap is a defense-in-depth backstop).
  schemaContext: z.string().max(16_384).optional(),
});

aiRouter.use('/v1/projects/:id/ai/*', projectRateLimit('mutate'));
aiRouter.use('/v1/projects/:id/ai/*', requireProjectAuth());
aiRouter.use('/v1/projects/:id/ai/*', requireProjectRole('developer'));

/**
 * Phase 3 AI schema generator. Forwards a NL prompt to the configured
 * Ollama instance and returns the draft schema TS as a string the
 * dashboard can paste into the editor. Returns 503 not_configured
 * when BRIVEN_OLLAMA_URL is unset so the operator knows to wire
 * Ollama before the feature works.
 */
aiRouter.post('/v1/projects/:id/ai/generate-schema', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = generateSchemaSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const result = await generateSchema({ prompt: parsed.data.prompt });
    return c.json({
      schema: result.schema,
      model: result.model,
      elapsedMs: result.elapsedMs,
    });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return c.json(
        {
          code: 'not_configured',
          message: 'AI features are disabled on this deployment (BRIVEN_OLLAMA_URL unset)',
        },
        503,
      );
    }
    throw err;
  }
});

/**
 * Phase 3 AI function generator. Pairs with the schema generator above —
 * given a natural-language description and optionally the project's
 * current schema, returns a single TypeScript file the user can drop
 * into briven/functions/<name>.ts. Same not_configured semantics.
 */
aiRouter.post('/v1/projects/:id/ai/generate-function', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = generateFunctionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const result = await generateFunction({
      prompt: parsed.data.prompt,
      schemaContext: parsed.data.schemaContext,
    });
    return c.json({
      function: result.function,
      model: result.model,
      elapsedMs: result.elapsedMs,
    });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return c.json(
        {
          code: 'not_configured',
          message: 'AI features are disabled on this deployment (BRIVEN_OLLAMA_URL unset)',
        },
        503,
      );
    }
    throw err;
  }
});
