/**
 * Compliance metadata for briven auth tenants (Phase 6.6).
 *
 * Tracks SOC 2 Type II controls, HIPAA BAA, and GDPR DPA status.
 * One row per tenant — created lazily on first read/write.
 */

import { runInProjectDatabase } from '../db/data-plane.js';

export interface ComplianceSettings {
  soc2ControlsUrl: string | null;
  hipaaBaaSignedAt: string | null;
  hipaaBaaSignedBy: string | null;
  gdprDpaSignedAt: string | null;
  gdprDpaSignedBy: string | null;
  encryptionAtRestEnabled: boolean;
}

export async function getComplianceSettings(
  projectId: string,
): Promise<ComplianceSettings> {
  const rows = await runInProjectDatabase<
    Array<{
      soc2_controls_url: string | null;
      hipaa_baa_signed_at: Date | null;
      hipaa_baa_signed_by: string | null;
      gdpr_dpa_signed_at: Date | null;
      gdpr_dpa_signed_by: string | null;
      encryption_at_rest_enabled: boolean;
    }>
  >(projectId, async (tx) => {
    return (await tx.unsafe(
      `SELECT soc2_controls_url, hipaa_baa_signed_at, hipaa_baa_signed_by,
              gdpr_dpa_signed_at, gdpr_dpa_signed_by, encryption_at_rest_enabled
       FROM "_briven_auth_compliance"
       LIMIT 1`,
    )) as never[];
  });

  const row = rows[0];
  if (!row) {
    return {
      soc2ControlsUrl: null,
      hipaaBaaSignedAt: null,
      hipaaBaaSignedBy: null,
      gdprDpaSignedAt: null,
      gdprDpaSignedBy: null,
      encryptionAtRestEnabled: true,
    };
  }

  return {
    soc2ControlsUrl: row.soc2_controls_url,
    hipaaBaaSignedAt: row.hipaa_baa_signed_at?.toISOString() ?? null,
    hipaaBaaSignedBy: row.hipaa_baa_signed_by,
    gdprDpaSignedAt: row.gdpr_dpa_signed_at?.toISOString() ?? null,
    gdprDpaSignedBy: row.gdpr_dpa_signed_by,
    encryptionAtRestEnabled: row.encryption_at_rest_enabled,
  };
}

export async function setComplianceSettings(
  projectId: string,
  patch: Partial<ComplianceSettings>,
): Promise<ComplianceSettings> {
  const existing = await getComplianceSettings(projectId);
  const next: ComplianceSettings = {
    soc2ControlsUrl: patch.soc2ControlsUrl ?? existing.soc2ControlsUrl,
    hipaaBaaSignedAt: patch.hipaaBaaSignedAt ?? existing.hipaaBaaSignedAt,
    hipaaBaaSignedBy: patch.hipaaBaaSignedBy ?? existing.hipaaBaaSignedBy,
    gdprDpaSignedAt: patch.gdprDpaSignedAt ?? existing.gdprDpaSignedAt,
    gdprDpaSignedBy: patch.gdprDpaSignedBy ?? existing.gdprDpaSignedBy,
    encryptionAtRestEnabled:
      patch.encryptionAtRestEnabled ?? existing.encryptionAtRestEnabled,
  };

  await runInProjectDatabase(projectId, async (tx) => {
    const rows = await tx.unsafe(
      `SELECT id FROM "_briven_auth_compliance" LIMIT 1`,
    ) as Array<{ id: string }>;

    if (rows[0]) {
      await tx.unsafe(
        `UPDATE "_briven_auth_compliance"
         SET soc2_controls_url = $1,
             hipaa_baa_signed_at = $2,
             hipaa_baa_signed_by = $3,
             gdpr_dpa_signed_at = $4,
             gdpr_dpa_signed_by = $5,
             encryption_at_rest_enabled = $6,
             updated_at = now()
         WHERE id = $7`,
        [
          next.soc2ControlsUrl,
          next.hipaaBaaSignedAt ? new Date(next.hipaaBaaSignedAt) : null,
          next.hipaaBaaSignedBy,
          next.gdprDpaSignedAt ? new Date(next.gdprDpaSignedAt) : null,
          next.gdprDpaSignedBy,
          next.encryptionAtRestEnabled,
          rows[0].id,
        ] as never[],
      );
    } else {
      await tx.unsafe(
        `INSERT INTO "_briven_auth_compliance"
         (id, soc2_controls_url, hipaa_baa_signed_at, hipaa_baa_signed_by,
          gdpr_dpa_signed_at, gdpr_dpa_signed_by, encryption_at_rest_enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())`,
        [
          `comp_${Date.now()}`,
          next.soc2ControlsUrl,
          next.hipaaBaaSignedAt ? new Date(next.hipaaBaaSignedAt) : null,
          next.hipaaBaaSignedBy,
          next.gdprDpaSignedAt ? new Date(next.gdprDpaSignedAt) : null,
          next.gdprDpaSignedBy,
          next.encryptionAtRestEnabled,
        ] as never[],
      );
    }
  });

  return next;
}
