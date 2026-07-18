import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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

export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/api/auth/')) return NextResponse.next();

  const url = new URL(
    req.nextUrl.pathname.replace('/api/auth', '/v1/auth-tenant'),
    BRIVEN_API_ORIGIN,
  );
  url.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  headers.set('x-briven-project-id', BRIVEN_PROJECT_ID);
  headers.set('authorization', \`Bearer \${BRIVEN_AUTH_KEY}\`);

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

  banner('auth');
  step('usage:');
  step('  briven auth scaffold   — middleware.ts + lib/auth.ts + .env.local seeds');
  blankLine();
  step('docs: https://docs.briven.tech/auth');
  step('human checklist: AUTH-GO-LIVE-CHECKLIST.md (in the Briven repo)');
  return 0;
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
  step('next:');
  step('  1. pnpm add @briven/auth   (or npm i @briven/auth)');
  step('  2. dashboard → Auth → API keys → create key (pk_briven_auth_…, scope read-write)');
  step('  3. paste key into NEXT_PUBLIC_BRIVEN_AUTH_KEY (+ BRIVEN_AUTH_PUBLIC_KEY)');
  step('  4. copy the sign-in example into a real page');
  step('  5. if 2FA is on: handle twoFactorRequired (hosted /two-factor or TwoFactorChallenge)');
  step('  6. run AUTH-GO-LIVE-CHECKLIST.md in a browser before real users');
  step('  7. e2e only: Auth → testing tokens → auth.signIn.testToken(…)');
  link('https://docs.briven.tech/auth');
  return 0;
}

function link(url: string): void {
  step(`  docs: ${url}`);
}
