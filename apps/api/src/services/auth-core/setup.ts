/**
 * Golden-path Auth setup for one project — status + one-click finish.
 */

import { createAuthSdkKey, listAuthSdkKeysForProject } from '../auth-sdk-keys.js';
import {
  addBrivenEngineAppOrigins,
  getBrivenEngineAppOrigins,
  getBrivenEngineProjectConfig,
  setBrivenEngineMethodFlags,
  type BrivenEngineMethodFlags,
} from './project-config.js';
import { enableBrivenEngineAuth, isBrivenEngineAuthEnabled } from './workspace.js';
import { recordBrivenEngineAudit } from './audit.js';
import { env } from '../../env.js';

const STARTER_METHODS: BrivenEngineMethodFlags = {
  emailPassword: true,
  passwordlessEmail: true,
  magicLink: true,
  passwordlessSms: false,
  passkeys: true,
  mfa: false,
};

export type SetupStepId =
  | 'auth_on'
  | 'core_methods'
  | 'public_key'
  | 'app_origin'
  | 'proxy';

export type SetupStep = {
  id: SetupStepId;
  label: string;
  ok: boolean;
  detail: string;
  href?: string;
};

export type SetupStatus = {
  engine: 'briven-engine';
  projectId: string;
  complete: boolean;
  steps: SetupStep[];
  appOrigins: string[];
  methods: BrivenEngineMethodFlags;
  activeKeyCount: number;
  apiOrigin: string;
  /** Snippet for first-party proxy (Next.js style). */
  proxySnippet: string;
};

function coreMethodsOn(m: BrivenEngineMethodFlags): boolean {
  return (
    m.emailPassword === true &&
    m.passwordlessEmail === true &&
    m.magicLink === true &&
    m.passkeys === true
  );
}

/**
 * Probe whether the app host has a first-party auth proxy.
 * Soft check — network failures = not ok, not a hard error.
 */
async function probeProxy(origin: string): Promise<{
  ok: boolean;
  detail: string;
}> {
  const base = origin.replace(/\/$/, '');
  const candidates = [
    `${base}/api/auth/v1/auth-core/info`,
    `${base}/api/auth/v1/auth-core/ready`,
  ];
  for (const url of candidates) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(url, {
        method: 'GET',
        signal: ctrl.signal,
        redirect: 'manual',
        headers: { accept: 'application/json' },
      });
      clearTimeout(t);
      // Any non-network response means the path exists (even 401/404/502).
      // Prefer 2xx with engine JSON for true green.
      if (res.status >= 200 && res.status < 500) {
        const text = await res.text().catch(() => '');
        if (
          res.ok &&
          (text.includes('briven-engine') ||
            text.includes('auth_core') ||
            text.includes('"ok"'))
        ) {
          return { ok: true, detail: `proxy answered at ${url.replace(base, '')}` };
        }
        if (res.status !== 404) {
          return {
            ok: true,
            detail: `proxy path reachable (${res.status}) — finish wiring if login fails`,
          };
        }
      }
    } catch {
      // try next
    }
  }
  return {
    ok: false,
    detail:
      'add /api/auth proxy on your app so cookies stay on your domain (see snippet below)',
  };
}

export async function getAuthSetupStatus(
  projectId: string,
): Promise<SetupStatus> {
  const authOn = await isBrivenEngineAuthEnabled(projectId);
  const config = authOn
    ? await getBrivenEngineProjectConfig(projectId)
    : null;
  const methods = config?.methods ?? STARTER_METHODS;
  const appOrigins =
    config?.appOrigins ?? (await getBrivenEngineAppOrigins(projectId));
  let activeKeyCount = 0;
  try {
    const keys = await listAuthSdkKeysForProject(projectId);
    activeKeyCount = keys.filter((k) => !k.revokedAt).length;
  } catch {
    activeKeyCount = 0;
  }

  const methodsOk = coreMethodsOn(methods);
  const originOk = appOrigins.length > 0;

  let proxyOk = false;
  let proxyDetail =
    'add an app origin first, then we check for /api/auth on your site';
  if (originOk) {
    const prod = appOrigins.find(
      (o) => !o.includes('localhost') && !o.includes('127.0.0.1'),
    );
    const probeTarget = prod ?? appOrigins[0]!;
    if (probeTarget.includes('localhost') || probeTarget.includes('127.0.0.1')) {
      // Cannot probe operator laptop from France API — treat origin as enough for local.
      proxyOk = true;
      proxyDetail =
        'local origin only — run the proxy snippet on localhost when you start the app';
    } else {
      const probe = await probeProxy(probeTarget);
      proxyOk = probe.ok;
      proxyDetail = probe.detail;
    }
  }

  const steps: SetupStep[] = [
    {
      id: 'auth_on',
      label: 'Auth on',
      ok: authOn,
      detail: authOn
        ? 'tenant ready on briven-engine'
        : 'turn Auth on for this project',
    },
    {
      id: 'core_methods',
      label: 'Core sign-in methods',
      ok: methodsOk,
      detail: methodsOk
        ? 'password · magic link · email OTP · passkeys'
        : 'enable password, magic link, email OTP, passkeys',
      href: `/dashboard/auth/${projectId}/providers`,
    },
    {
      id: 'public_key',
      label: 'Browser public key',
      ok: activeKeyCount > 0,
      detail:
        activeKeyCount > 0
          ? `${activeKeyCount} key(s) ready`
          : 'mint a pk_briven_auth_… key for the app',
      href: `/dashboard/auth/${projectId}/keys`,
    },
    {
      id: 'app_origin',
      label: 'App domain / origin',
      ok: originOk,
      detail: originOk
        ? appOrigins.join(', ')
        : 'add http://localhost:3000 and your live app URL',
    },
    {
      id: 'proxy',
      label: 'First-party proxy',
      ok: proxyOk,
      detail: proxyDetail,
    },
  ];

  const complete = steps.every((s) => s.ok);
  const proxySnippet = `// next.config — rewrite app /api/auth/* → Briven API
// (or use @briven/auth scaffold middleware)
// Browser calls same-origin /api/auth/... so cookies stay on YOUR domain.

async rewrites() {
  return [
    {
      source: '/api/auth/:path*',
      destination: '${env.BRIVEN_API_ORIGIN}/:path*',
    },
  ];
}`;

  return {
    engine: 'briven-engine',
    projectId,
    complete,
    steps,
    appOrigins,
    methods,
    activeKeyCount,
    apiOrigin: env.BRIVEN_API_ORIGIN,
    proxySnippet,
  };
}

export type SetupFinishResult = {
  ok: true;
  engine: 'briven-engine';
  projectId: string;
  status: SetupStatus;
  /** Shown once if a new key was minted. */
  mintedKeyPlaintext: string | null;
  actions: string[];
};

/**
 * One-click safe defaults: enable Auth, starter methods, localhost origin,
 * mint a browser key if none exists. Optional production origin from body.
 */
export async function finishAuthSetup(
  projectId: string,
  opts: {
    userId: string;
    productionOrigin?: string | null;
  },
): Promise<SetupFinishResult> {
  const actions: string[] = [];

  const enable = await enableBrivenEngineAuth(projectId);
  if (enable.ok) {
    actions.push(enable.created ? 'enabled Auth' : 'Auth already on');
  } else {
    throw new Error(enable.message ?? 'could not enable Auth');
  }

  await setBrivenEngineMethodFlags(projectId, STARTER_METHODS, opts.userId);
  actions.push('core methods on (password, magic, OTP, passkeys)');

  const originsToAdd = ['http://localhost:3000'];
  if (opts.productionOrigin?.trim()) {
    originsToAdd.push(opts.productionOrigin.trim());
  }
  const { appOrigins } = await addBrivenEngineAppOrigins(
    projectId,
    originsToAdd,
    opts.userId,
  );
  actions.push(`app origins: ${appOrigins.join(', ') || 'none'}`);

  let mintedKeyPlaintext: string | null = null;
  const keys = await listAuthSdkKeysForProject(projectId);
  const active = keys.filter((k) => !k.revokedAt);
  if (active.length === 0) {
    const created = await createAuthSdkKey({
      projectId,
      createdBy: opts.userId,
      name: 'browser',
      scope: 'read-write',
    });
    mintedKeyPlaintext = created.plaintext;
    actions.push('minted browser public key (copy once)');
  } else {
    actions.push('public key already present');
  }

  void recordBrivenEngineAudit({
    action: 'setup.finish',
    projectId,
    userId: opts.userId,
    metadata: { actions },
  });

  const status = await getAuthSetupStatus(projectId);
  return {
    ok: true,
    engine: 'briven-engine',
    projectId,
    status,
    mintedKeyPlaintext,
    actions,
  };
}
