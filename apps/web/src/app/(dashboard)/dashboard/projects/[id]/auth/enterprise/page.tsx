import Link from 'next/link';

import { apiJson } from '../../../../../../../lib/api';

import { CompliancePanel } from './compliance-panel';
import { EnterpriseCopyButton } from './enterprise-copy-button';
import { RoleMapsPanel } from './role-maps-panel';
import { ScimTokensPanel } from './scim-tokens-panel';

interface AuthStateResponse {
  enabled: boolean;
}

interface ComplianceSettings {
  soc2ControlsUrl: string | null;
  hipaaBaaSignedAt: string | null;
  hipaaBaaSignedBy: string | null;
  gdprDpaSignedAt: string | null;
  gdprDpaSignedBy: string | null;
  encryptionAtRestEnabled: boolean;
}

interface EnterprisePack {
  packVersion: string;
  projectId: string;
  generatedAt: string;
  compliance: ComplianceSettings;
  retention: { auditLogDays: number | null; appLogDays: number | null };
  capabilities: Record<string, boolean>;
  endpoints: {
    scimBase: string;
    samlMetadataPattern: string;
    oidcStartPattern: string;
    complianceApi: string;
    compliancePackApi: string;
  };
  checklistForSales: Array<{ id: string; label: string; done: boolean }>;
}

interface ScimToken {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface RoleMap {
  id: string;
  displayName: string;
  orgId: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export const metadata = { title: 'auth · enterprise' };
export const dynamic = 'force-dynamic';

export default async function AuthEnterprisePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const state = await apiJson<AuthStateResponse>(`/v1/projects/${id}/auth/config`).catch(
    () => null,
  );

  if (!state || !state.enabled) {
    return (
      <section className="flex flex-col gap-6">
        <header>
          <h2 className="font-mono text-lg tracking-tight">auth · enterprise</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            enable auth on this project first — then you can manage SCIM, compliance, and company
            directory sync here.
          </p>
        </header>
        <Link
          href={`/dashboard/projects/${id}/auth`}
          className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          ← back to auth overview
        </Link>
      </section>
    );
  }

  const [pack, tokens, roleMaps] = await Promise.all([
    apiJson<EnterprisePack>(`/v1/projects/${id}/auth/compliance/pack`).catch(() => null),
    apiJson<{ items: ScimToken[] }>(`/v1/projects/${id}/auth/scim/tokens`).catch(() => ({
      items: [] as ScimToken[],
    })),
    apiJson<{ items: RoleMap[] }>(`/v1/projects/${id}/auth/scim/role-maps`).catch(() => ({
      items: [] as RoleMap[],
    })),
  ]);

  const scimBase =
    pack?.endpoints.scimBase ?? `https://api.briven.tech/v1/projects/${id}/scim/v2`;

  return (
    <section className="flex flex-col gap-8">
      <header>
        <h2 className="font-mono text-lg tracking-tight">auth · enterprise</h2>
        <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          Company IT tools (Okta, Microsoft Entra, Google Workspace, …) connect here — no raw API
          calls needed. Three parts:{' '}
          <strong className="text-[var(--color-text)]">compliance pack</strong> (legal sales kit),{' '}
          <strong className="text-[var(--color-text)]">SCIM tokens</strong> (directory secret), and{' '}
          <strong className="text-[var(--color-text)]">group → team maps</strong>.
        </p>
      </header>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
        <h3 className="font-mono text-sm text-[var(--color-text)]">SCIM base URL</h3>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          Paste into your identity provider&apos;s SCIM / provisioning settings. Auth uses a Bearer
          token from the SCIM tokens section below.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-sm bg-[var(--color-surface)] p-2 font-mono text-[11px] text-[var(--color-text)]">
          {scimBase}
        </pre>
        <div className="mt-2">
          <EnterpriseCopyButton value={scimBase} label="copy URL" />
        </div>
      </div>

      <CompliancePanel projectId={id} pack={pack} />
      <ScimTokensPanel projectId={id} items={tokens.items} />
      <RoleMapsPanel projectId={id} items={roleMaps.items} />

      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
        docs: ENTERPRISE-PACK.md · SCIM.md · public trust page at /trust
      </p>
    </section>
  );
}
