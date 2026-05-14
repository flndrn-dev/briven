/**
 * Customer-controlled outbound network filter.
 *
 * IPv4 CIDRs from CLAUDE.md §5.3 — must match the IPv4 set verbatim.
 *
 * IPv6 enforcement runs in two layers:
 *   1. Host firewall (ip6tables / nftables) on the runtime host. The
 *      authoritative defense — see docs/runbooks/host-firewall-v6.md
 *      for the apply + verify steps.
 *   2. Belt-and-braces fetch shim inside each Deno isolate that
 *      rejects literal v6 URL hostnames matching the deny ranges. The
 *      shim is inlined into `isolate-runtime/loop.ts` because loop.ts is
 *      materialised into the isolate without node_modules access. The
 *      `isBlockedV6Literal` helper here is the test surface for the
 *      same algorithm — keep the two in sync.
 */
export const BLOCKED_CIDRS = [
  '169.254.0.0/16',  // link-local (incl. cloud metadata 169.254.169.254)
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
] as const;

export function formatDenyNet(): string {
  return BLOCKED_CIDRS.join(',');
}

/**
 * Returns true when the given URL hostname is a literal IPv6 address in
 * one of the deny ranges enforced inside the isolate:
 *   - ::1 (loopback)
 *   - fc00::/7 — unique-local addresses (matches fc** and fd** first hextets)
 *   - fe80::/10 — link-local
 *
 * Hostnames that RESOLVE to v6 aren't covered here — that's the host
 * firewall's job. This function exists to catch obvious
 * `http://[fc00::1]/foo` attempts before they leave the isolate.
 *
 * Accepts both bare (`fe80::1`) and bracketed (`[fe80::1]`) forms.
 */
export function isBlockedV6Literal(host: string): boolean {
  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (h === '::1') return true;
  // fc00::/7 — first 7 bits = 1111110_ → first hextet starts with fc** or fd**
  if (/^fc[0-9a-f]{2}:/i.test(h) || /^fd[0-9a-f]{2}:/i.test(h)) return true;
  // fe80::/10 — first 10 bits → first hextet starts with fe8*, fe9*, fea*, feb*
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return true;
  return false;
}

/**
 * Phase 3 seam — interface defined now, no implementation in Phase 1.
 * Phase 3 swaps `noopOutboundProxy` for a real proxy that returns
 * { HTTP_PROXY, HTTPS_PROXY } pointing at the host-side filtering proxy.
 */
export interface OutboundProxy {
  proxyEnvForIsolate(isolateId: string): Record<string, string>;
}

export const noopOutboundProxy: OutboundProxy = {
  proxyEnvForIsolate: () => ({}),
};
