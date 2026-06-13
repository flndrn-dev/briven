import { z } from 'zod';

import { ValidationError } from './errors.js';

/**
 * Load and validate `BRIVEN_*` env vars at process boot.
 *
 * Per CLAUDE.md §4.1, every env var owned by briven must carry the `BRIVEN_`
 * prefix. This loader enforces that invariant — if a required var is missing
 * or unprefixed, the process fails loudly at startup rather than later.
 */
export function loadEnv<T extends z.ZodObject<z.ZodRawShape>>(schema: T): z.infer<T> {
  const keys = Object.keys(schema.shape);
  const unprefixed = keys.filter((k) => !k.startsWith('BRIVEN_'));
  if (unprefixed.length > 0) {
    throw new ValidationError(
      `env vars must carry the BRIVEN_ prefix, got: ${unprefixed.join(', ')}`,
    );
  }

  // Treat empty-string env vars as unset. Docker Compose interpolation like
  // `${BRIVEN_FOO:-}` injects "" for an unset var; an empty string would
  // otherwise fail `.url()`/`.min()` on `.optional()` fields, which are meant
  // to accept "absent". Strip empties so optional vars resolve to undefined.
  const cleanedEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && v !== '') cleanedEnv[k] = v;
  }

  const parsed = schema.safeParse(cleanedEnv);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new ValidationError(`missing or invalid env vars: ${missing}`);
  }

  return parsed.data;
}
