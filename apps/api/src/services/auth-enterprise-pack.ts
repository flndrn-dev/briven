/**
 * Enterprise compliance / sales pack (S7).
 *
 * Turns compliance groundwork into a downloadable "sales kit" JSON plus
 * standard legal templates for DPA, BAA outline, and retention.
 * Per-project signed flags still live in `_briven_auth_compliance`.
 */

import { getComplianceSettings, type ComplianceSettings } from './auth-compliance.js';
import { getAuthConfig } from './tenant-config-store.js';

export const ENTERPRISE_PACK_VERSION = '2026-07-19';

/** Static legal/sales templates (not a signed contract — templates for counsel). */
export const ENTERPRISE_LEGAL_TEMPLATES = {
  dpa: {
    title: 'Data Processing Addendum (template)',
    version: ENTERPRISE_PACK_VERSION,
    summary:
      'Template DPA for EU GDPR Art. 28. Briven (flndrn Limited) acts as processor for customer-end-user auth data held in the customer’s project; the customer is controller for their end users.',
    controller: 'Customer (your company)',
    processor: 'flndrn Limited (Cyprus) operating briven.tech',
    subjectMatter: 'Authentication, sessions, SSO, SCIM provisioning, audit metadata',
    duration: 'Term of the Briven subscription + retention windows below',
    nature: 'Hosting, processing for login, security, support',
    typesOfData: [
      'End-user email and name',
      'Auth session identifiers',
      'SSO/SCIM identifiers',
      'Hashed credentials (not plaintext passwords)',
      'Security events (IP hashed where applicable)',
    ],
    subprocessorsUrl: 'https://briven.tech/subprocessors',
    trustUrl: 'https://briven.tech/trust',
    contact: 'legal@flndrn.com',
    note: 'This is a sales/ops template. Final DPA is signed between flndrn Limited and the customer; enable gdprDpaSignedAt on the project after signature.',
  },
  hipaaBaaOutline: {
    title: 'HIPAA Business Associate Agreement (outline)',
    version: ENTERPRISE_PACK_VERSION,
    summary:
      'Outline only — not a substitute for counsel-drafted BAA. Available when PHI is in scope and both parties agree.',
    status: 'template_outline',
    contact: 'legal@flndrn.com',
    prerequisites: [
      'Customer classifies workload as PHI-relevant',
      'Enterprise plan / written agreement',
      'hipaaBaaSignedAt recorded on the project after wet/electronic signature',
    ],
  },
  retention: {
    title: 'Auth data retention pack',
    version: ENTERPRISE_PACK_VERSION,
    defaults: {
      auditLogDays: 'configured per project (auth config retention.auditLogDays)',
      appLogDays: 'configured per project (auth config retention.appLogDays)',
      sessions: 'until expiry or revoke',
      scimMappings: 'while user/group exists',
      backups: 'see trust page (platform backups)',
    },
    customerControls: [
      'Dashboard Auth → retention / purge endpoints',
      'User delete (GDPR erasure) via admin bulk delete / SCIM DELETE User',
      'Project disable/delete removes tenant data plane after grace (platform policy)',
    ],
  },
  securityOverview: {
    title: 'Security overview (enterprise one-pager)',
    version: ENTERPRISE_PACK_VERSION,
    bullets: [
      'TLS on public endpoints',
      'Per-project data isolation (project-scoped DB + auth tables)',
      'Env secrets encrypted at rest (AES-256-GCM)',
      'API / SCIM / SDK keys hashed at rest',
      'Enterprise SSO: SAML 2.0 + OIDC',
      'SCIM 2.0 user/group provisioning',
      'Audit log + app logs with configurable retention',
      'Rate limits (Redis with memory fallback)',
      '2FA TOTP, passkeys, backup codes (where enabled)',
    ],
    publicTrust: 'https://briven.tech/trust',
    statusPage: 'https://briven.tech/status',
  },
} as const;

export interface EnterpriseSalesPack {
  packVersion: string;
  projectId: string;
  generatedAt: string;
  compliance: ComplianceSettings;
  retention: {
    auditLogDays: number | null;
    appLogDays: number | null;
  };
  capabilities: {
    samlSso: true;
    oidcSso: true;
    scim: true;
    scimGroups: true;
    auditLog: true;
    encryptionAtRest: boolean;
  };
  endpoints: {
    scimBase: string;
    samlMetadataPattern: string;
    oidcStartPattern: string;
    complianceApi: string;
    compliancePackApi: string;
  };
  templates: typeof ENTERPRISE_LEGAL_TEMPLATES;
  checklistForSales: Array<{ id: string; label: string; done: boolean }>;
}

export async function buildEnterpriseSalesPack(
  projectId: string,
  apiOrigin: string,
): Promise<EnterpriseSalesPack> {
  const compliance = await getComplianceSettings(projectId);
  const config = await getAuthConfig(projectId).catch(() => null);
  const retention = {
    auditLogDays: config?.retention?.auditLogDays ?? null,
    appLogDays: config?.retention?.appLogDays ?? null,
  };
  const base = apiOrigin.replace(/\/$/, '');

  const checklistForSales: EnterpriseSalesPack['checklistForSales'] = [
    {
      id: 'dpa',
      label: 'GDPR DPA signed (record gdprDpaSignedAt)',
      done: Boolean(compliance.gdprDpaSignedAt),
    },
    {
      id: 'hipaa',
      label: 'HIPAA BAA signed if PHI in scope',
      done: Boolean(compliance.hipaaBaaSignedAt),
    },
    {
      id: 'soc2_url',
      label: 'SOC 2 controls URL published (if available)',
      done: Boolean(compliance.soc2ControlsUrl),
    },
    {
      id: 'encryption',
      label: 'Encryption at rest affirmed',
      done: compliance.encryptionAtRestEnabled,
    },
    {
      id: 'sso',
      label: 'Customer SSO (SAML or OIDC) configured when required',
      done: false, // sales fills; not auto-detected here
    },
    {
      id: 'scim',
      label: 'SCIM token issued when directory sync required',
      done: false,
    },
  ];

  return {
    packVersion: ENTERPRISE_PACK_VERSION,
    projectId,
    generatedAt: new Date().toISOString(),
    compliance,
    retention,
    capabilities: {
      samlSso: true,
      oidcSso: true,
      scim: true,
      scimGroups: true,
      auditLog: true,
      encryptionAtRest: compliance.encryptionAtRestEnabled,
    },
    endpoints: {
      scimBase: `${base}/v1/projects/${projectId}/scim/v2`,
      samlMetadataPattern: `${base}/v1/auth-tenant/sso/saml/{connectionId}/metadata`,
      oidcStartPattern: `${base}/v1/auth-tenant/sso/oidc/{connectionId}`,
      complianceApi: `${base}/v1/projects/${projectId}/auth/compliance`,
      compliancePackApi: `${base}/v1/projects/${projectId}/auth/compliance/pack`,
    },
    templates: ENTERPRISE_LEGAL_TEMPLATES,
    checklistForSales,
  };
}

/** Record DPA signature quickly from dashboard (owner). */
export async function signGdprDpa(
  projectId: string,
  signedBy: string,
): Promise<ComplianceSettings> {
  const { setComplianceSettings } = await import('./auth-compliance.js');
  return setComplianceSettings(projectId, {
    gdprDpaSignedAt: new Date().toISOString(),
    gdprDpaSignedBy: signedBy,
  });
}

export async function signHipaaBaa(
  projectId: string,
  signedBy: string,
): Promise<ComplianceSettings> {
  const { setComplianceSettings } = await import('./auth-compliance.js');
  return setComplianceSettings(projectId, {
    hipaaBaaSignedAt: new Date().toISOString(),
    hipaaBaaSignedBy: signedBy,
  });
}
