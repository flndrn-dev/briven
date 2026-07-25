import { describe, expect, it } from 'bun:test';

import { ValidationError } from '@briven/shared';

import {
  ALLOWED_LOGO_TYPES,
  LOGO_MAX_BYTES,
  brandingLogoPublicUrl,
  sniffLogoContentType,
  validateLogoUpload,
} from './auth-branding-logo.js';

describe('validateLogoUpload', () => {
  it('accepts every allowed content-type at a sane size', () => {
    for (const ct of ALLOWED_LOGO_TYPES) {
      expect(() => validateLogoUpload({ contentType: ct, size: 1024 })).not.toThrow();
    }
  });

  it('accepts svg with a charset suffix', () => {
    expect(() =>
      validateLogoUpload({ contentType: 'image/svg+xml; charset=utf-8', size: 512 }),
    ).not.toThrow();
  });

  it('is case-insensitive on the media type', () => {
    expect(() => validateLogoUpload({ contentType: 'IMAGE/PNG', size: 512 })).not.toThrow();
  });

  it('accepts exactly the cap', () => {
    expect(() =>
      validateLogoUpload({ contentType: 'image/png', size: LOGO_MAX_BYTES }),
    ).not.toThrow();
  });

  it('rejects a disallowed content-type', () => {
    expect(() => validateLogoUpload({ contentType: 'image/gif', size: 512 })).toThrow(
      ValidationError,
    );
    expect(() => validateLogoUpload({ contentType: 'application/pdf', size: 512 })).toThrow(
      ValidationError,
    );
    expect(() => validateLogoUpload({ contentType: 'text/html', size: 512 })).toThrow(
      ValidationError,
    );
  });

  it('rejects an empty content-type', () => {
    expect(() => validateLogoUpload({ contentType: '', size: 512 })).toThrow(ValidationError);
  });

  it('rejects an over-cap file', () => {
    expect(() =>
      validateLogoUpload({ contentType: 'image/png', size: LOGO_MAX_BYTES + 1 }),
    ).toThrow(ValidationError);
  });

  it('rejects an empty / non-positive file', () => {
    expect(() => validateLogoUpload({ contentType: 'image/png', size: 0 })).toThrow(
      ValidationError,
    );
    expect(() => validateLogoUpload({ contentType: 'image/png', size: -5 })).toThrow(
      ValidationError,
    );
    expect(() => validateLogoUpload({ contentType: 'image/png', size: Number.NaN })).toThrow(
      ValidationError,
    );
  });
});

describe('brandingLogoPublicUrl', () => {
  it('points at the public serve route and is cache-busted', () => {
    const url = brandingLogoPublicUrl('p_abc123');
    expect(url).toContain('/v1/projects/p_abc123/auth/branding/logo');
    expect(url).toMatch(/\?v=\d+$/);
  });
});

describe('sniffLogoContentType', () => {
  it('keeps a trusted header type', () => {
    expect(sniffLogoContentType(new Uint8Array([1, 2, 3]), 'image/png')).toBe(
      'image/png',
    );
  });

  it('sniffs png magic when header is missing', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffLogoContentType(png, 'application/octet-stream')).toBe(
      'image/png',
    );
  });

  it('sniffs svg text when header is wrong', () => {
    const svg = new TextEncoder().encode(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );
    expect(sniffLogoContentType(svg, null)).toBe('image/svg+xml');
  });
});
