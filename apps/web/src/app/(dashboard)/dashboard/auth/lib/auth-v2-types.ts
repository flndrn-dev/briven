export interface AuthV2ProviderFlags {
  emailPassword: boolean;
  magicLink: boolean;
  emailOtp: boolean;
  passkey: boolean;
}

export interface AuthV2ProjectRow {
  id: string;
  slug: string;
  name: string;
  authEnabled: boolean;
  tenantId?: string | null;
  providers: AuthV2ProviderFlags | null;
  error?: boolean;
}

export interface AuthV2Workspace {
  ok: boolean;
  phase: number;
  projects: AuthV2ProjectRow[];
}
