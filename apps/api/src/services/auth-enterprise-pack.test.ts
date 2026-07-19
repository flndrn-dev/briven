import { describe, expect, test } from 'bun:test';

import { ENTERPRISE_LEGAL_TEMPLATES, ENTERPRISE_PACK_VERSION } from './auth-enterprise-pack.js';

describe('enterprise pack templates (S7)', () => {
  test('pack version is set', () => {
    expect(ENTERPRISE_PACK_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('DPA template has controller/processor', () => {
    expect(ENTERPRISE_LEGAL_TEMPLATES.dpa.controller.length).toBeGreaterThan(3);
    expect(ENTERPRISE_LEGAL_TEMPLATES.dpa.processor).toContain('flndrn');
    expect(ENTERPRISE_LEGAL_TEMPLATES.dpa.typesOfData.length).toBeGreaterThan(2);
  });

  test('retention + security overviews exist', () => {
    expect(ENTERPRISE_LEGAL_TEMPLATES.retention.customerControls.length).toBeGreaterThan(0);
    const joined = ENTERPRISE_LEGAL_TEMPLATES.securityOverview.bullets.join(' ');
    expect(joined).toMatch(/SCIM|SSO|TLS/i);
  });

  test('HIPAA outline is marked template', () => {
    expect(ENTERPRISE_LEGAL_TEMPLATES.hipaaBaaOutline.status).toBe('template_outline');
  });
});
