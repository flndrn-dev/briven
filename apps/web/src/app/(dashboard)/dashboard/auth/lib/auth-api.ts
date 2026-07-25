/**
 * Server helpers for yellow Authentication pages → briven-engine API.
 * Forwards session cookies via apiFetch.
 */

import { apiFetch } from '@/lib/api';

export type AuthCoreInfo = {
  ok?: boolean;
  engine?: string;
  engineVersion?: string;
  storage?: string;
  database?: string;
  message?: string;
  hello?: string | null;
  schemaReady?: boolean;
  poolReady?: boolean;
  appLoginReady?: boolean;
  loginMethods?: string[];
  productStatus?: string;
  notice?: string;
  buildSha?: string;
  buildAt?: string;
};

export type AuthDashboard = {
  engine: string;
  storage: string;
  database: string;
  ok: boolean;
  message: string;
  counts: {
    users: number;
    sessions: number;
    tenants: number;
    thirdPartyLinks: number;
    passwordlessCodesActive: number;
  };
  methods: {
    emailPassword: boolean;
    passwordlessEmail: boolean;
    passwordlessSms: boolean;
    google: boolean;
    github: boolean;
    webauthn: boolean;
    mfa: boolean;
  };
  recentUsers: Array<{
    id: string;
    emails: string[];
    phoneNumbers: string[];
    timeJoined: number;
  }>;
  recipesLoaded: string[];
};

export async function fetchAuthCoreInfo(): Promise<AuthCoreInfo | null> {
  try {
    const res = await apiFetch('/v1/auth-core/info');
    if (!res.ok) return null;
    return (await res.json()) as AuthCoreInfo;
  } catch {
    return null;
  }
}

export async function fetchAuthDashboard(
  projectId?: string,
): Promise<
  | { ok: true; data: AuthDashboard }
  | { ok: false; status: number; message: string }
> {
  try {
    const q = projectId
      ? `?projectId=${encodeURIComponent(projectId)}`
      : '';
    const res = await apiFetch(`/v1/auth-core/dashboard${q}`);
    if (res.status === 401) {
      return { ok: false, status: 401, message: 'sign in to briven.tech required' };
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, status: res.status, message: t || res.statusText };
    }
    return { ok: true, data: (await res.json()) as AuthDashboard };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export type AuthUserStatus = 'active' | 'held' | 'archived';

export type AuthUserSummary = {
  id: string;
  emails: string[];
  phoneNumbers: string[];
  tenantId?: string;
  timeJoined: number;
  status?: AuthUserStatus;
  heldAt?: string | null;
  heldReason?: string | null;
  archivedAt?: string | null;
  archivedReason?: string | null;
  storage?: string;
};

export type AuthUserDetail = AuthUserSummary & {
  emailVerified?: boolean;
  metadata?: Record<string, unknown>;
  roles?: string[];
  linkedLogins?: Array<{
    id: string;
    provider: string;
    providerUserId: string;
    createdAt: string;
  }>;
  sessions?: Array<{
    handle: string;
    expiresAt: string;
    createdAt: string;
  }>;
  passkeyCount?: number;
  totpCount?: number;
};

export async function fetchAuthUsers(
  limit = 50,
  projectId?: string,
): Promise<
  | {
      ok: true;
      users: AuthUserSummary[];
      storage?: string;
    }
  | { ok: false; status: number; message: string }
> {
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (projectId) params.set('projectId', projectId);
    const res = await apiFetch(`/v1/auth-core/users?${params}`);
    if (res.status === 401) {
      return { ok: false, status: 401, message: 'sign in to briven.tech required' };
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, status: res.status, message: t || res.statusText };
    }
    const body = (await res.json()) as {
      users?: AuthUserSummary[];
      storage?: string;
    };
    return {
      ok: true,
      users: body.users ?? [],
      storage: body.storage ?? 'doltgres',
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchAuthUserDetail(
  userId: string,
  projectId: string,
): Promise<
  | { ok: true; user: AuthUserDetail }
  | { ok: false; status: number; message: string }
> {
  try {
    const params = new URLSearchParams({ projectId });
    const res = await apiFetch(
      `/v1/auth-core/users/${encodeURIComponent(userId)}?${params}`,
    );
    if (res.status === 401) {
      return { ok: false, status: 401, message: 'sign in to briven.tech required' };
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, status: res.status, message: t || res.statusText };
    }
    const body = (await res.json()) as { user?: AuthUserDetail };
    if (!body.user) {
      return { ok: false, status: 404, message: 'user not found' };
    }
    return { ok: true, user: body.user };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchAuthRecipes(): Promise<{
  loaded: string[];
  catalog: Array<{
    id: string;
    title: string;
    phase: number;
    loaded: boolean;
    sms: boolean;
  }>;
  smsIncluded?: boolean;
  storage?: string;
} | null> {
  try {
    const res = await apiFetch('/v1/auth-core/recipes');
    if (!res.ok) return null;
    return (await res.json()) as {
      loaded: string[];
      catalog: Array<{
        id: string;
        title: string;
        phase: number;
        loaded: boolean;
        sms: boolean;
      }>;
      smsIncluded?: boolean;
    };
  } catch {
    return null;
  }
}
