import { Hono } from 'hono';
import { z } from 'zod';

import { env } from '../env.js';
import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { projectRateLimit } from '../middleware/rate-limit.js';
import { explainCode, EXPLAIN_SYSTEM_PROMPT } from '../services/ai-explain.js';
import { FUNCTION_SYSTEM_PROMPT, generateFunction } from '../services/ai-function-gen.js';
import {
  AiNotConfiguredError,
  generateSchema,
  SCHEMA_SYSTEM_PROMPT,
} from '../services/ai-schema-gen.js';
import { streamAiResponse } from '../services/ai-stream.js';
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

const explainCodeSchema = z.object({
  // The code to explain. 8 KB matches the schema-context cap so we
  // don't blow the model's context with a single long file.
  code: z.string().min(1).max(8_192),
  // Optional perspective shaper — "I'm new to briven", "I migrated from
  // prisma", "explain like a senior engineer". Empty is fine.
  perspective: z.string().max(512).optional(),
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

/**
 * Phase 3 AI explain code. Third member of the AI trifecta — same
 * Ollama-backed pattern as schema + function gen. Returns 503 when
 * BRIVEN_OLLAMA_URL is unset so the dashboard can render an "AI
 * offline" state without throwing.
 */
aiRouter.post('/v1/projects/:id/ai/explain-code', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = explainCodeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const result = await explainCode({
      code: parsed.data.code,
      perspective: parsed.data.perspective,
    });
    return c.json({
      explanation: result.explanation,
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
 * SSE streaming variants of the three AI features. Same input shape +
 * same auth + same not_configured semantics as the non-streaming
 * endpoints — just emit `event: token` / `event: done` over text/event-
 * stream instead of waiting for the full response. Dashboard consumers
 * use EventSource; the CLI uses --stream.
 */
aiRouter.post('/v1/projects/:id/ai/generate-schema/stream', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = generateSchemaSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  try {
    const res = await streamAiResponse({
      system: SCHEMA_SYSTEM_PROMPT,
      prompt: parsed.data.prompt,
      model: env.BRIVEN_OLLAMA_MODEL_SCHEMA ?? env.BRIVEN_OLLAMA_MODEL,
      temperature: 0.2,
    });
    return res;
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return c.json({ code: 'not_configured', message: 'BRIVEN_OLLAMA_URL unset' }, 503);
    }
    throw err;
  }
});

aiRouter.post('/v1/projects/:id/ai/generate-function/stream', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = generateFunctionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const userMessage = parsed.data.schemaContext
    ? `Current schema:\n\`\`\`ts\n${parsed.data.schemaContext.slice(0, 8192)}\n\`\`\`\n\nWrite a function that: ${parsed.data.prompt}`
    : parsed.data.prompt;
  try {
    const res = await streamAiResponse({
      system: FUNCTION_SYSTEM_PROMPT,
      prompt: userMessage,
      model: env.BRIVEN_OLLAMA_MODEL_FUNCTION ?? env.BRIVEN_OLLAMA_MODEL,
      temperature: 0.3,
    });
    return res;
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return c.json({ code: 'not_configured', message: 'BRIVEN_OLLAMA_URL unset' }, 503);
    }
    throw err;
  }
});

aiRouter.post('/v1/projects/:id/ai/explain-code/stream', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = explainCodeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
  }
  const userMessage =
    parsed.data.perspective && parsed.data.perspective.trim().length > 0
      ? `Perspective: ${parsed.data.perspective.trim()}\n\nExplain this code:\n\`\`\`ts\n${parsed.data.code}\n\`\`\``
      : `Explain this code:\n\`\`\`ts\n${parsed.data.code}\n\`\`\``;
  try {
    const res = await streamAiResponse({
      system: EXPLAIN_SYSTEM_PROMPT,
      prompt: userMessage,
      model: env.BRIVEN_OLLAMA_MODEL_EXPLAIN ?? env.BRIVEN_OLLAMA_MODEL,
      temperature: 0.4,
    });
    return res;
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return c.json({ code: 'not_configured', message: 'BRIVEN_OLLAMA_URL unset' }, 503);
    }
    throw err;
  }
});

// Suppress no-unused-vars for the imports above — they're used by the
// three stream routes appended at the end of this file.
void explainCode;
void generateFunction;
void generateSchema;
