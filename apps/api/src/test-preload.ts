/**
 * Bun test preload (wired via bunfig.toml `[test].preload`). Runs ONCE before
 * any test module is imported.
 *
 * Why this exists: `src/env.ts` parses `process.env` exactly once at module
 * load (`export const env = loadEnv(envSchema)`) and the result is frozen for
 * the process lifetime. Individual test files that set
 * `process.env.BRIVEN_BETTER_AUTH_SECRET` at their top only work when that file
 * runs alone — in a full `bun test` run the FIRST file to import env.ts
 * (transitively, via almost anything) freezes the secret to whatever was set
 * at that moment. If that first file didn't set it, `env.BRIVEN_BETTER_AUTH_SECRET`
 * is `undefined` for the WHOLE run, and S2.8's fail-closed `secretBytes()`
 * correctly throws — breaking every cli-jwt / Bearer-auth test downstream.
 *
 * Setting it here, before any module loads, mirrors production (the secret is
 * always present at boot) so env.ts captures it regardless of file order. We
 * use `??=` so a real secret provided by CI/the environment is never
 * overwritten.
 */
process.env.BRIVEN_BETTER_AUTH_SECRET ??= 'test-better-auth-secret-0123456789abcdef';

// Same freeze problem for the control-plane DB URL: `src/db/client.ts` getDb()
// reads `env.BRIVEN_DATABASE_URL` and throws "not configured" when empty. Route
// tests (auth-cli, me, projects) set a deliberately-unreachable URL at file-top
// so getDb() constructs (and the route returns 200-or-500 on the dead socket),
// but that only works for whichever file imports env.ts first. Set it here so
// the value is captured regardless of order. Port 5 is intentionally dead — no
// test should ever actually reach a database through this URL.
process.env.BRIVEN_DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5/test';
