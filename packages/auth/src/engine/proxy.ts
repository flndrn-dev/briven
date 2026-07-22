/**
 * First-party proxy for briven-engine FDI.
 *
 * Browser talks to YOUR app:
 *   https://your-app.com/api/auth/signup
 * This proxy forwards to Briven:
 *   https://api.briven.tech/v1/auth-core/fdi/signup
 * and returns Set-Cookie so cookies land on **your-app.com**.
 *
 * Product: briven-engine · storage stays on Briven Doltgres.
 */

const BRIVEN_ENGINE_ID = 'briven-engine' as const;

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

export type BrivenEngineProxyOptions = {
  /** Briven API origin, e.g. https://api.briven.tech */
  apiOrigin?: string;
  /** Default: /v1/auth-core/fdi */
  fdiBasePath?: string;
  /** Optional fixed project id stamped on every hop */
  projectId?: string;
  fetch?: typeof globalThis.fetch;
};

/**
 * Absolute FDI base, e.g. https://api.briven.tech/v1/auth-core/fdi
 */
export function resolveFdiTarget(opts?: BrivenEngineProxyOptions): string {
  const origin = (opts?.apiOrigin ?? 'https://api.briven.tech').replace(
    /\/$/,
    '',
  );
  const base = (opts?.fdiBasePath ?? '/v1/auth-core/fdi').replace(/\/$/, '');
  const path = base.startsWith('/') ? base : `/${base}`;
  return `${origin}${path}`;
}

/**
 * Map app path under /api/auth → FDI path suffix.
 *   /api/auth/signup → /signup
 *   /api/auth/signinup/code → /signinup/code
 */
export function appAuthPathToFdiSuffix(
  pathname: string,
  proxyMount = '/api/auth',
): string {
  const mount = proxyMount.replace(/\/$/, '') || '/api/auth';
  let rest = pathname;
  if (rest.startsWith(mount)) {
    rest = rest.slice(mount.length);
  }
  if (!rest.startsWith('/')) rest = `/${rest}`;
  if (rest === '/') rest = '';
  return rest || '';
}

/**
 * Proxy one Request to briven-engine FDI. Use from Next.js route handlers
 * or any fetch-compatible server.
 */
export async function proxyBrivenEngineAuth(
  request: Request,
  opts: BrivenEngineProxyOptions & {
    /** Override path suffix (without FDI base). Default: derived from request URL. */
    pathSuffix?: string;
    proxyMount?: string;
  } = {},
): Promise<Response> {
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const targetBase = resolveFdiTarget(opts);
  const url = new URL(request.url);
  const suffix =
    opts.pathSuffix ??
    appAuthPathToFdiSuffix(url.pathname, opts.proxyMount ?? '/api/auth');
  const dest = `${targetBase}${suffix}${url.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  headers.set('x-briven-engine', BRIVEN_ENGINE_ID);
  if (opts.projectId) {
    headers.set('x-briven-project-id', opts.projectId);
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const upstream = await fetchFn(dest, {
    method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
  });

  // Rebuild response so Set-Cookie reaches the browser on the **app** host.
  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'transfer-encoding') return;
    // Multiple Set-Cookie: append each
    if (k === 'set-cookie') {
      // Headers.forEach may combine; use getSetCookie when available
      return;
    }
    outHeaders.set(key, value);
  });

  const anyHeaders = upstream.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof anyHeaders.getSetCookie === 'function') {
    for (const c of anyHeaders.getSetCookie()) {
      outHeaders.append('set-cookie', c);
    }
  } else {
    const single = upstream.headers.get('set-cookie');
    if (single) outHeaders.append('set-cookie', single);
  }

  outHeaders.set('x-briven-engine', BRIVEN_ENGINE_ID);
  outHeaders.set('x-briven-proxy', 'first-party');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

/**
 * Next.js App Router helper — drop into app/api/auth/[...path]/route.ts
 *
 *   export const GET = brivenEngineNextHandler({ apiOrigin: process.env.BRIVEN_API_ORIGIN })
 *   export const POST = GET
 */
export function brivenEngineNextHandler(opts: BrivenEngineProxyOptions = {}) {
  return async (
    request: Request,
    context?: { params?: Promise<{ path?: string[] }> | { path?: string[] } },
  ): Promise<Response> => {
    let pathSuffix: string | undefined;
    if (context?.params) {
      const params = await Promise.resolve(context.params);
      if (params?.path?.length) {
        pathSuffix = `/${params.path.join('/')}`;
      }
    }
    return proxyBrivenEngineAuth(request, {
      ...opts,
      pathSuffix,
      projectId:
        opts.projectId ??
        request.headers.get('x-briven-project-id') ??
        undefined,
    });
  };
}
