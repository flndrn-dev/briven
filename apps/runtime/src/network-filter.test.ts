import { describe, expect, test } from 'bun:test';

import { BLOCKED_CIDRS, formatDenyNet, noopOutboundProxy } from './network-filter.js';

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
