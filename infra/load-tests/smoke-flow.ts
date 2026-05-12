/**
 * End-to-end smoke test — drives the customer journey through the prod
 * api without any UI clicks. Day 2 G step automation; faster + more
 * repeatable than the manual checklist in the plan.
 *
 * Covers the parts of the flow we can drive purely via HTTP:
 *   1. /info               — api reachable, build sha known
 *   2. /v1/me              — session cookie valid
 *   3. /v1/me/orgs         — personal org auto-created
 *   4. /v1/projects        — list owned projects
 *   5. POST /v1/projects   — create a fresh project
 *   6. POST /v1/projects/:id/studio/tables  — create one table
 *   7. POST /v1/projects/:id/studio/tables/:t/rows — insert one row
 *   8. GET  /v1/projects/:id/studio/tables/:t/rows — read it back
 *   9. POST /v1/projects/:id/studio/query — sql editor smoke
 *  10. DELETE /v1/projects/:id — soft-delete the test project
 *
 * Out of band (UI-only, run those manually): OAuth provider flow,
 * polar checkout, account deletion form. The harness validates that
 * the api supports each step end-to-end with a real session.
 *
 * Usage:
 *   BRIVEN_API_ORIGIN=https://api.briven.tech \
 *   BRIVEN_SESSION_COOKIE='better-auth.session_token=...' \
 *     bun infra/load-tests/smoke-flow.ts
 *
 * Capture the session cookie from your browser devtools after signing
 * in via the dashboard. The harness never sees your password.
 *
 * Exits 0 on full pass, 1 on any GO/NO-GO failure. Each step prints
 * GO or NO-GO with the relevant diagnostics so a failed run can be
 * shipped to support as-is.
 */

interface Ctx {
  origin: string;
  cookie: string;
  startedAt: number;
}

interface StepResult {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

const TABLE_NAME = 'smoke_notes';

async function call<T = unknown>(
  ctx: Ctx,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T | null; text: string }> {
  const res = await fetch(`${ctx.origin}${path}`, {
    method,
    headers: {
      cookie: ctx.cookie,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data, text };
}

async function step<T>(
  ctx: Ctx,
  name: string,
  fn: () => Promise<T>,
  check: (v: T) => string | null,
): Promise<StepResult> {
  const t0 = performance.now();
  try {
    const v = await fn();
    const err = check(v);
    const ms = Math.round(performance.now() - t0);
    if (err) return { name, ok: false, ms, detail: err };
    return { name, ok: true, ms };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    return { name, ok: false, ms, detail: e instanceof Error ? e.message : String(e) };
  }
}

function print(r: StepResult): void {
  const tag = r.ok ? '\x1b[32m  GO\x1b[0m' : '\x1b[31mNO-GO\x1b[0m';
  const detail = r.detail ? `  · ${r.detail}` : '';
  console.log(`${tag}  ${r.name.padEnd(38)} ${String(r.ms).padStart(5)}ms${detail}`);
}

async function main(): Promise<number> {
  const origin = process.env.BRIVEN_API_ORIGIN;
  const cookie = process.env.BRIVEN_SESSION_COOKIE;
  if (!origin || !cookie) {
    console.error('set BRIVEN_API_ORIGIN + BRIVEN_SESSION_COOKIE');
    return 2;
  }

  const ctx: Ctx = { origin, cookie, startedAt: Date.now() };
  const results: StepResult[] = [];
  let projectId: string | null = null;

  results.push(
    await step(
      ctx,
      '1. /info reachable',
      () => call<{ buildSha: string }>(ctx, 'GET', '/info'),
      (r) => (r.status === 200 && r.data?.buildSha ? null : `status=${r.status}`),
    ),
  );

  results.push(
    await step(
      ctx,
      '2. /v1/me session valid',
      () => call<{ email: string }>(ctx, 'GET', '/v1/me'),
      (r) => (r.status === 200 && r.data?.email ? null : `status=${r.status} body=${r.text.slice(0, 120)}`),
    ),
  );

  results.push(
    await step(
      ctx,
      '3. /v1/me/orgs has personal org',
      () => call<{ orgs: Array<{ id: string; personal: boolean }> }>(ctx, 'GET', '/v1/me/orgs'),
      (r) => {
        if (r.status !== 200 || !r.data) return `status=${r.status}`;
        const personal = r.data.orgs.find((o) => o.personal);
        return personal ? null : 'no personal org';
      },
    ),
  );

  results.push(
    await step(
      ctx,
      '4. list projects',
      () => call<{ projects: unknown[] }>(ctx, 'GET', '/v1/projects'),
      (r) => (r.status === 200 ? null : `status=${r.status}`),
    ),
  );

  const created = await step(
    ctx,
    '5. create project (briven-smoke)',
    () =>
      call<{ project: { id: string; slug: string } }>(ctx, 'POST', '/v1/projects', {
        name: `briven-smoke-${Date.now()}`,
        region: 'eu-west-1',
      }),
    (r) => {
      if (r.status !== 200 || !r.data?.project) return `status=${r.status} body=${r.text.slice(0, 120)}`;
      projectId = r.data.project.id;
      return null;
    },
  );
  results.push(created);

  if (projectId) {
    results.push(
      await step(
        ctx,
        '6. CREATE TABLE smoke_notes',
        () =>
          call<{ name: string }>(
            ctx,
            'POST',
            `/v1/projects/${projectId}/studio/tables`,
            {
              tableName: TABLE_NAME,
              columns: [
                { name: 'id', type: 'text', primaryKey: true },
                { name: 'body', type: 'text', notNull: true },
                {
                  name: 'createdAt',
                  type: 'timestamptz',
                  notNull: true,
                  defaultExpr: 'now()',
                },
              ],
            },
          ),
        (r) => (r.status === 201 ? null : `status=${r.status} body=${r.text.slice(0, 200)}`),
      ),
    );

    const id = `smk_${Math.random().toString(36).slice(2, 10)}`;
    results.push(
      await step(
        ctx,
        '7. INSERT row',
        () =>
          call(
            ctx,
            'POST',
            `/v1/projects/${projectId}/studio/tables/${TABLE_NAME}/rows`,
            { values: { id, body: 'hello from smoke flow' } },
          ),
        (r) => (r.status === 201 ? null : `status=${r.status} body=${r.text.slice(0, 200)}`),
      ),
    );

    results.push(
      await step(
        ctx,
        '8. SELECT rows · expect 1',
        () =>
          call<{ rows: unknown[] }>(
            ctx,
            'GET',
            `/v1/projects/${projectId}/studio/tables/${TABLE_NAME}/rows?limit=10`,
          ),
        (r) => {
          if (r.status !== 200 || !r.data) return `status=${r.status}`;
          if (r.data.rows.length === 0) return 'no rows returned';
          return null;
        },
      ),
    );

    results.push(
      await step(
        ctx,
        '9. sql editor: count(*)',
        () =>
          call<{ rows: unknown[] }>(
            ctx,
            'POST',
            `/v1/projects/${projectId}/studio/query`,
            { sql: `SELECT count(*) FROM ${TABLE_NAME}` },
          ),
        (r) => (r.status === 200 ? null : `status=${r.status} body=${r.text.slice(0, 200)}`),
      ),
    );

    results.push(
      await step(
        ctx,
        '10. soft-delete test project',
        () => call(ctx, 'DELETE', `/v1/projects/${projectId}`),
        (r) => (r.status === 200 ? null : `status=${r.status} body=${r.text.slice(0, 200)}`),
      ),
    );
  } else {
    // Skip the rest if project creation failed.
    results.push({ name: '6–10. skipped (no project)', ok: false, ms: 0 });
  }

  console.log('\nbriven smoke flow · summary');
  console.log('─'.repeat(60));
  for (const r of results) print(r);
  const failed = results.filter((r) => !r.ok).length;
  console.log('─'.repeat(60));
  console.log(`${results.length - failed} / ${results.length} GO`);
  return failed > 0 ? 1 : 0;
}

const code = await main();
process.exit(code);
