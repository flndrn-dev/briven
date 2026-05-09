/**
 * Customer-controlled outbound network filter.
 *
 * IPv4 CIDRs from CLAUDE.md §5.3 — must match the IPv4 set verbatim.
 * IPv6 enforcement is deferred to the Phase 3 host-level outbound proxy
 * (Deno 2.x's --deny-net does not accept v6 CIDR notation). The Phase 1
 * isolates bind only v4 outbound; v6 default routes are blocked at the
 * host firewall layer.
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
