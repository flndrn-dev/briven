import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { error as printError, banner, step, success, blankLine } from '../output.js';
import { readProjectConfig } from '../project-config.js';

const MIDDLEWARE_TS = `import { NextResponse, type NextRequest } from 'next/server';

const BRIVEN_API_ORIGIN = process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? 'https://api.briven.tech';
const BRIVEN_PROJECT_ID = process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID!;
const BRIVEN_AUTH_KEY = process.env.BRIVEN_AUTH_PUBLIC_KEY!;

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

const ENV_LOCAL = `# Briven Auth — paste your project id and public key from the dashboard
NEXT_PUBLIC_BRIVEN_API_ORIGIN=https://api.briven.tech
NEXT_PUBLIC_BRIVEN_PROJECT_ID=p_xxxxxxxxxxxxxxxx
BRIVEN_AUTH_PUBLIC_KEY=pk_briven_auth_xxxxxxxxxxxxxxxx
`;

export async function runAuth(argv: readonly string[]): Promise<number> {
  const cmd = argv[0];

  if (cmd === 'scaffold') {
    return runScaffold();
  }

  banner('auth');
  step('usage:');
  step('  briven auth scaffold   — generate middleware.ts + .env.local for Briven Auth');
  blankLine();
  step('docs: https://docs.briven.tech/auth/setup');
  return 0;
}

async function runScaffold(): Promise<number> {
  const cwd = process.cwd();
  const config = await readProjectConfig(cwd);
  if (!config) {
    printError('no briven.json found — run `briven link` first.');
    return 1;
  }

  banner('auth scaffold');

  const middlewarePath = resolve(cwd, 'middleware.ts');
  await writeFile(middlewarePath, MIDDLEWARE_TS);
  step('created middleware.ts');

  const envPath = resolve(cwd, '.env.local');
  try {
    // Only write .env.local if it doesn't exist — never overwrite secrets.
    await writeFile(envPath, ENV_LOCAL, { flag: 'wx' });
    step('created .env.local (fill in your project id + public key)');
  } catch {
    step('.env.local already exists — skipped (add the vars manually)');
  }

  blankLine();
  success('scaffolded Briven Auth proxy:');
  step('  middleware.ts    — forwards /api/auth/* to Briven with your project id');
  step('  .env.local       — env vars for project id + public key');
  blankLine();
  step('next:');
  step('  1. copy your public key from the dashboard → Auth → API Keys');
  step('  2. paste it into .env.local as BRIVEN_AUTH_PUBLIC_KEY');
  step('  3. import { createBrivenAuth } from "@briven/auth" in your app');
  step('  4. use auth.hostedPageURL(flow, "/dashboard") to redirect users');
  link('https://docs.briven.tech/auth/setup');
  return 0;
}

function link(url: string): void {
  step(`  docs: ${url}`);
}
