import { describe, expect, test } from 'bun:test';

import {
  BLOCKED_CIDRS,
  formatDenyNet,
  isBlockedV6Literal,
  noopOutboundProxy,
} from './network-filter.js';

describe('network-filter', () => {
  test('BLOCKED_CIDRS matches CLAUDE.md §5.3 IPv4 entries verbatim', () => {
    expect(BLOCKED_CIDRS).toEqual([
      '169.254.0.0/16',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '127.0.0.0/8',
    ]);
  });

  test('formatDenyNet joins all five CIDRs with commas, no spaces', () => {
    const out = formatDenyNet();
    expect(out).toBe('169.254.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8');
  });

  test('noopOutboundProxy returns empty env', () => {
    expect(noopOutboundProxy.proxyEnvForIsolate('iso-1')).toEqual({});
  });
});

describe('isBlockedV6Literal', () => {
  test('blocks ::1 loopback', () => {
    expect(isBlockedV6Literal('::1')).toBe(true);
    expect(isBlockedV6Literal('[::1]')).toBe(true);
  });

  test('blocks fc00::/7 (fc** + fd** first hextets)', () => {
    expect(isBlockedV6Literal('fc00::1')).toBe(true);
    expect(isBlockedV6Literal('fcab::')).toBe(true);
    expect(isBlockedV6Literal('fd12:3456:789a::1')).toBe(true);
    expect(isBlockedV6Literal('[fcff::]')).toBe(true);
  });

  test('blocks fe80::/10 link-local (fe8*, fe9*, fea*, feb* first hextet)', () => {
    expect(isBlockedV6Literal('fe80::1')).toBe(true);
    expect(isBlockedV6Literal('fe9a::')).toBe(true);
    expect(isBlockedV6Literal('feaf::cafe')).toBe(true);
    expect(isBlockedV6Literal('feb0::1')).toBe(true);
  });

  test('does not block fec0::/10 (deprecated site-local, not in deny set)', () => {
    expect(isBlockedV6Literal('fec0::1')).toBe(false);
  });

  test('does not block global unicast', () => {
    expect(isBlockedV6Literal('2001:db8::1')).toBe(false);
    expect(isBlockedV6Literal('2606:4700::')).toBe(false); // cloudflare
  });

  test('does not block hostnames or v4 addresses', () => {
    expect(isBlockedV6Literal('example.com')).toBe(false);
    expect(isBlockedV6Literal('10.0.0.1')).toBe(false);
    expect(isBlockedV6Literal('localhost')).toBe(false); // v4 path handles this
  });
});
