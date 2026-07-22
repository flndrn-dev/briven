/**
 * Server helpers for yellow Authentication pages → briven-engine API.
 * Forwards session cookies via apiFetch.
 */

import { apiFetch } from '@/lib/api';

export type AuthCoreInfo = {
  ok?: boolean;
  engine?: string;
  storage?: string;
  database?: string;
  message?: string;
  hello?: string | null;
  schemaReady?: boolean;
  buildSha?: string;
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

export async function fetchAuthDashboard(): Promise<
  | { ok: true; data: AuthDashboard }
  | { ok: false; status: number; message: string }
> {
  try {
    const res = await apiFetch('/v1/auth-core/dashboard');
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

export async function fetchAuthUsers(limit = 50): Promise<
  | {
      ok: true;
      users: Array<{
        id: string;
        emails: string[];
        phoneNumbers: string[];
        tenantId?: string;
        timeJoined: number;
        storage?: string;
      }>;
      storage?: string;
    }
  | { ok: false; status: number; message: string }
> {
  try {
    const res = await apiFetch(`/v1/auth-core/users?limit=${limit}`);
    if (res.status === 401) {
      return { ok: false, status: 401, message: 'sign in to briven.tech required' };
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, status: res.status, message: t || res.statusText };
    }
    const body = (await res.json()) as {
      users?: Array<{
        id: string;
        emails: string[];
        phoneNumbers: string[];
        tenantId?: string;
        timeJoined: number;
        storage?: string;
      }>;
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
