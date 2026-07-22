import { describe, expect, test } from 'bun:test';

import { extractSessionHandle } from './session.js';

describe('extractSessionHandle (Phase 2)', () => {
  test('reads x-briven-session-handle header', () => {
    const headers = new Headers({
      'x-briven-session-handle': 'sh_abc123',
    });
    expect(extractSessionHandle({ headers })).toBe('sh_abc123');
  });

  test('reads sAccessToken cookie', () => {
    const headers = new Headers({
      cookie: 'other=1; sAccessToken=sh_from_cookie; path=x',
    });
    expect(extractSessionHandle({ headers })).toBe('sh_from_cookie');
  });

  test('decodes URI-encoded cookie', () => {
    const headers = new Headers({
      cookie: `sAccessToken=${encodeURIComponent('sh_a+b')}`,
    });
    expect(extractSessionHandle({ headers })).toBe('sh_a+b');
  });

  test('prefers header over cookie', () => {
    const headers = new Headers({
      'x-briven-session-handle': 'sh_header',
      cookie: 'sAccessToken=sh_cookie',
    });
    expect(extractSessionHandle({ headers })).toBe('sh_header');
  });

  test('returns null when missing', () => {
    expect(extractSessionHandle({ headers: new Headers() })).toBeNull();
  });
});
