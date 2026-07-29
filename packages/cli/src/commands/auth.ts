import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { apiCall, ApiCallError } from '../api-client.js';
import { readCredentials, readUserCredential } from '../config.js';
import { error as printError, banner, step, success, blankLine } from '../output.js';
import { readProjectConfig } from '../project-config.js';

/**
 * Next.js middleware that proxies `/api/auth/*` to Briven's auth-tenant bridge
 * with the project id + browser-safe public key. Body streaming needs duplex.
 */
const MIDDLEWARE_TS = `import { NextResponse, type NextRequest } from 'next/server';

const BRIVEN_API_ORIGIN = process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? 'https://api.briven.tech';
const BRIVEN_PROJECT_ID = process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID!;
// Prefer the public Next env (browser-safe pk_briven_auth_…); fall back to the
// server-only alias used by older scaffolds.
const BRIVEN_AUTH_KEY =
  process.env.BRIVEN_AUTH_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_BRIVEN_AUTH_KEY!;

/**
 * First-party proxy → briven-engine FDI (live).
 * Never proxy to /v1/auth-tenant/* (retired → HTTP 410).
 *   Browser:  /api/auth/signinup/code
 *   Upstream: /v1/auth-core/fdi/signinup/code
 */
export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/api/auth/')) return NextResponse.next();

  let path = req.nextUrl.pathname;
  if (path.startsWith('/api/auth/v1/auth-core/fdi')) {
    path = path.slice('/api/auth'.length);
  } else if (path.startsWith('/api/auth/v1/auth-tenant')) {
    // Old scaffold / emails — rewrite retired bridge → FDI
    path = path.replace(/^\\/api\\/auth\\/v1\\/auth-tenant/, '/v1/auth-core/fdi');
  } else {
    path = path.replace(/^\\/api\\/auth/, '/v1/auth-core/fdi');
  }

  const url = new URL(path, BRIVEN_API_ORIGIN);
  url.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  headers.set('x-briven-project-id', BRIVEN_PROJECT_ID);
  headers.set('authorization', \`Bearer \${BRIVEN_AUTH_KEY}\`);
  if (!url.searchParams.has('briven_project_id')) {
    url.searchParams.set('briven_project_id', BRIVEN_PROJECT_ID);
  }

  return fetch(url, {
    method: req.method,
    headers,
    body: req.body,
    // @ts-expect-error — duplex is required for streaming request bodies in Node 18+
    duplex: 'half',
  });
}

export const config = {
  matcher: ['/api/auth/:path*'],
};
`;

function envLocalTemplate(projectId: string): string {
  return `# Briven Auth — fill public key from dashboard → Auth → API keys
# https://docs.briven.tech/auth
NEXT_PUBLIC_BRIVEN_API_ORIGIN=https://api.briven.tech
NEXT_PUBLIC_BRIVEN_PROJECT_ID=${projectId}
# Browser-safe key (pk_briven_auth_…). Never put a brk_ server key here.
NEXT_PUBLIC_BRIVEN_AUTH_KEY=pk_briven_auth_xxxxxxxxxxxxxxxx
# Optional alias for middleware (same value as NEXT_PUBLIC_BRIVEN_AUTH_KEY)
BRIVEN_AUTH_PUBLIC_KEY=pk_briven_auth_xxxxxxxxxxxxxxxx
`;
}

const AUTH_TS = `import { createBrivenAuth } from '@briven/auth';

/**
 * Stateless client. Session lives in the httpOnly cookie set by Briven.
 * https://docs.briven.tech/auth
 */
export const auth = createBrivenAuth({
  projectId: process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID!,
  publicKey: process.env.NEXT_PUBLIC_BRIVEN_AUTH_KEY!,
});
`;

const SIGN_IN_HINT = `// Example sign-in page (paste into app/sign-in/page.tsx or similar)
//
// Option A — hosted Briven pages (fastest pilot):
//   'use client';
//   import { auth } from '@/lib/auth';
//   export default function SignIn() {
//     return (
//       <button type="button" onClick={() => {
//         window.location.assign(auth.hostedPageURL('sign-in', '/dashboard'));
//       }}>
//         Sign in
//       </button>
//     );
//   }
//
// Option B — embedded panel:
//   'use client';
//   import { BrivenSignIn } from '@briven/auth/react';
//   export default function SignIn() {
//     return <BrivenSignIn redirectTo="/dashboard" showEmailPassword showMagicLink />;
//   }
`;

export async function runAuth(argv: readonly string[]): Promise<number> {
  const cmd = argv[0];

  if (cmd === 'scaffold') {
    return runScaffold();
  }
  if (cmd === 'enable') {
    return runEnable(argv.slice(1));
  }

  banner('auth');
  step('usage:');
  step('  briven auth enable [--origin https://your.app] [--project p_…]');
  step('      — turn Auth ON (starter pack) + mint pk_briven_auth_… if missing');
  step('  briven auth scaffold');
  step('      — middleware.ts + lib/auth.ts + .env.local seeds');
  blankLine();
  step('agents: prefer `briven auth enable` after `briven connect` / `briven setup`');
  step('docs: https://docs.briven.tech/auth');
  return 0;
}

interface SetupFinishResponse {
  ok?: boolean;
  projectId?: string;
  actions?: string[];
  mintedKeyPlaintext?: string | null;
  status?: {
    authEnabled?: boolean;
    methodsReady?: boolean;
    hasPublicKey?: boolean;
    originsReady?: boolean;
  };
  message?: string;
  code?: string;
}

export interface EnableAuthOptions {
  projectId: string;
  apiOrigin: string;
  /** Platform user JWT (CLI login token). */
  bearer: string;
  productionOrigin?: string;
  /** When true, skip banner chrome (used from setup/connect). */
  quiet?: boolean;
  cwd?: string;
}

/**
 * Enable Auth + starter methods + mint browser key if missing.
 * Shared by `briven auth enable` and automatic setup/connect.
 */
export async function enableAuthForProject(
  opts: EnableAuthOptions,
): Promise<{ ok: true; publicKey: string | null; actions: string[] } | { ok: false; message: string }> {
  const apiOrigin = opts.apiOrigin.replace(/\/$/, '');
  const body: { productionOrigin?: string } = {};
  if (opts.productionOrigin?.trim()) {
    body.productionOrigin = opts.productionOrigin.trim();
  }
  try {
    const result = await apiCall<SetupFinishResponse>(
      `/v1/auth-core/projects/${encodeURIComponent(opts.projectId)}/setup-finish`,
      {
        apiOrigin,
        bearer: opts.bearer,
        method: 'POST',
        body,
      },
    );
    const pk = result.mintedKeyPlaintext?.trim() || null;
    if (pk) {
      await mergeEnvLocal(opts.projectId, pk, apiOrigin, opts.cwd);
    }
    return { ok: true, publicKey: pk, actions: result.actions ?? [] };
  } catch (err) {
    if (err instanceof ApiCallError) {
      return {
        ok: false,
        message: `server rejected: ${err.code} (${err.status}) — ${err.message}`,
      };
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'auth enable failed',
    };
  }
}

/**
 * One-shot Auth enable for agents and humans.
 * Calls platform setup-finish (enable + methods + localhost + mint key).
 * Needs `briven login` / connect so a CLI user token exists (not only brk_).
 */
async function runEnable(argv: readonly string[]): Promise<number> {
  banner('auth enable');

  let productionOrigin: string | undefined;
  let projectArg: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--origin' || a === '-o') {
      productionOrigin = argv[i + 1];
      i += 1;
      continue;
    }
    if (a === '--project' || a === '-p') {
      projectArg = argv[i + 1];
      i += 1;
      continue;
    }
    if (a?.startsWith('--origin=')) {
      productionOrigin = a.slice('--origin='.length);
      continue;
    }
    if (a?.startsWith('--project=')) {
      projectArg = a.slice('--project='.length);
    }
  }

  const user = await readUserCredential();
  if (!user?.token) {
    printError('no platform login in the CLI');
    step('run: briven login   (or briven connect) so agents have a user token');
    step('then: briven auth enable');
    return 1;
  }

  const file = await readCredentials();
  const local = await readProjectConfig();
  const projectId =
    projectArg?.trim() || local?.projectId?.trim() || file.default || undefined;
  if (!projectId) {
    printError('no project id — link a project first');
    step('run: briven projects use <p_…>   or pass --project p_…');
    return 1;
  }

  const apiOrigin = user.apiOrigin.replace(/\/$/, '');
  step(`project  ${projectId}`);
  step(`origin   ${apiOrigin}`);
  if (productionOrigin) step(`app URL  ${productionOrigin}`);

  const result = await enableAuthForProject({
    projectId,
    apiOrigin,
    bearer: user.token,
    productionOrigin,
  });
  if (!result.ok) {
    printError(result.message);
    if (result.message.includes('401') || result.message.includes('403')) {
      step('need admin access on this project + fresh `briven login`');
    }
    return 1;
  }

  blankLine();
  for (const action of result.actions) {
    step(`  · ${action}`);
  }
  if (result.publicKey) {
    blankLine();
    success('browser public key (copy once — not shown again):');
    step(result.publicKey);
  } else {
    step('public key already present — check dashboard Auth → API keys');
  }
  blankLine();
  success('Auth enable finished');
  step('next: briven auth scaffold   (if app files not wired yet)');
  step('      pnpm add @briven/auth');
  step('      prove login on an Allowed Domain / origin');
  return 0;
}

/** Seed or update .env.local with project id + public key (never overwrites other keys blindly). */
async function mergeEnvLocal(
  projectId: string,
  publicKey: string,
  apiOrigin: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const envPath = resolve(cwd, '.env.local');
  const lines = [
    `NEXT_PUBLIC_BRIVEN_API_ORIGIN=${apiOrigin}`,
    `NEXT_PUBLIC_BRIVEN_PROJECT_ID=${projectId}`,
    `NEXT_PUBLIC_BRIVEN_AUTH_KEY=${publicKey}`,
    `BRIVEN_AUTH_PUBLIC_KEY=${publicKey}`,
  ];
  try {
    let existing = '';
    try {
      existing = await readFile(envPath, 'utf8');
    } catch {
      existing = '';
    }
    if (!existing) {
      await writeFile(envPath, `${lines.join('\n')}\n`, { flag: 'wx' });
      step('wrote .env.local with the new public key');
      return;
    }
    let next = existing;
    const upsert = (key: string, value: string) => {
      const re = new RegExp(`^${key}=.*$`, 'm');
      if (re.test(next)) {
        next = next.replace(re, `${key}=${value}`);
      } else {
        next = `${next.trimEnd()}\n${key}=${value}\n`;
      }
    };
    upsert('NEXT_PUBLIC_BRIVEN_API_ORIGIN', apiOrigin);
    upsert('NEXT_PUBLIC_BRIVEN_PROJECT_ID', projectId);
    upsert('NEXT_PUBLIC_BRIVEN_AUTH_KEY', publicKey);
    upsert('BRIVEN_AUTH_PUBLIC_KEY', publicKey);
    await writeFile(envPath, next.endsWith('\n') ? next : `${next}\n`);
    step('updated .env.local with project id + public key');
  } catch {
    step('could not write .env.local — paste the public key yourself');
  }
}

async function runScaffold(): Promise<number> {
  const cwd = process.cwd();
  const config = await readProjectConfig(cwd);
  if (!config) {
    printError('no briven.json found — run `briven link` first.');
    return 1;
  }

  const projectId = config.projectId?.trim() || 'p_xxxxxxxxxxxxxxxx';
  if (!config.projectId) {
    step('warning: briven.json has no projectId yet — run `briven link` and re-scaffold,');
    step('         or paste your real p_… id into .env.local yourself.');
  }

  banner('auth scaffold');

  const middlewarePath = resolve(cwd, 'middleware.ts');
  await writeFile(middlewarePath, MIDDLEWARE_TS);
  step('created middleware.ts  (proxies /api/auth/* → Briven)');

  const authPath = resolve(cwd, 'lib/auth.ts');
  try {
    await mkdir(dirname(authPath), { recursive: true });
    await writeFile(authPath, AUTH_TS, { flag: 'wx' });
    step('created lib/auth.ts   (createBrivenAuth client)');
  } catch {
    step('lib/auth.ts already exists — skipped');
  }

  const hintPath = resolve(cwd, 'lib/auth.sign-in.example.tsx.txt');
  try {
    await writeFile(hintPath, SIGN_IN_HINT, { flag: 'wx' });
    step('created lib/auth.sign-in.example.tsx.txt  (copy into a page)');
  } catch {
    step('sign-in example already exists — skipped');
  }

  const envPath = resolve(cwd, '.env.local');
  try {
    // Only write .env.local if it doesn't exist — never overwrite secrets.
    await writeFile(envPath, envLocalTemplate(projectId), { flag: 'wx' });
    step(`created .env.local    (project id prefilled: ${projectId})`);
  } catch {
    step('.env.local already exists — skipped (add the vars manually if missing)');
  }

  blankLine();
  success('scaffolded Briven Auth:');
  step('  middleware.ts');
  step('  lib/auth.ts');
  step('  lib/auth.sign-in.example.tsx.txt');
  step('  .env.local (if it was missing)');
  blankLine();
  step('Clerk-simple next steps (do in order):');
  step('  1. briven auth enable   (or Dashboard → Auth → Enable once)');
  step('  2. Public key lands in .env.local when enable mints one');
  step('  3. Add real site origin: briven auth enable --origin https://your.app');
  step('  4. pnpm add @briven/auth');
  step('  5. Copy lib/auth.sign-in.example into a real page (or hostedPageURL sign-in)');
  step('  6. Deploy THIS app after any auth code change');
  step('  Tip: if agents say "providers OFF", re-check THIS project — not another MCP binding.');
  link('https://docs.briven.tech/auth');
  return 0;
}

function link(url: string): void {
  step(`  docs: ${url}`);
}
