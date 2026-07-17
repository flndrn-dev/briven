/**
 * @briven/auth/svelte — Svelte bindings for `@briven/auth`.
 *
 *   import { createBrivenAuth } from '@briven/auth';
 *   import { setBrivenAuthContext, createSessionStore, createUserStore } from '@briven/auth/svelte';
 *
 *   const auth = createBrivenAuth({ projectId: 'p_abc123', publicKey: '...' });
 *
 *   <!-- App.svelte -->
 *   <script>
 *     import { setBrivenAuthContext } from '@briven/auth/svelte';
 *     setBrivenAuthContext(auth);
 *   </script>
 *
 *   <!-- Child.svelte -->
 *   <script>
 *     import { createSessionStore } from '@briven/auth/svelte';
 *     const { session, isLoading, refresh } = createSessionStore();
 *   </script>
 *
 * Zero hard dependency on SvelteKit — works in any Svelte 4/5 environment.
 */

import { getContext, setContext } from 'svelte';
import { writable, type Readable } from 'svelte/store';

import {
  type BrivenAuthClient,
  type ClientSession,
  type Org,
  type SessionResponse,
  type SsoConnection,
  type User,
  type UserEmail,
} from '../index.js';

const BRIVEN_AUTH_KEY = Symbol('briven-auth');

/** Set the auth client in Svelte context (call once in your root layout). */
export function setBrivenAuthContext(client: BrivenAuthClient): void {
  setContext(BRIVEN_AUTH_KEY, client);
}

/** Get the auth client from Svelte context. Throws if not set. */
export function getBrivenAuthContext(): BrivenAuthClient {
  const client = getContext<BrivenAuthClient | undefined>(BRIVEN_AUTH_KEY);
  if (!client) {
    throw new Error('getBrivenAuthContext must be called inside a component with setBrivenAuthContext');
  }
  return client;
}

// ─── Stores ────────────────────────────────────────────────────────────────

export interface SessionStore {
  session: Readable<SessionResponse | null>;
  isLoading: Readable<boolean>;
  refresh: () => Promise<void>;
}

export function createSessionStore(client?: BrivenAuthClient): SessionStore {
  const auth = client ?? getBrivenAuthContext();
  const session = writable<SessionResponse | null>(null);
  const isLoading = writable(true);

  const refresh = async () => {
    isLoading.set(true);
    const next = await auth.getSession();
    session.set(next);
    isLoading.set(false);
  };

  // Auto-fetch on first subscription
  const unsub = session.subscribe(() => {});
  refresh().then(() => unsub());

  return { session, isLoading, refresh };
}

export interface UserStore {
  user: Readable<User | null>;
  isLoading: Readable<boolean>;
  refresh: () => Promise<void>;
}

export function createUserStore(client?: BrivenAuthClient): UserStore {
  const auth = client ?? getBrivenAuthContext();
  const user = writable<User | null>(null);
  const isLoading = writable(true);

  const refresh = async () => {
    isLoading.set(true);
    const next = await auth.getUser();
    user.set(next);
    isLoading.set(false);
  };

  const unsub = user.subscribe(() => {});
  refresh().then(() => unsub());

  return { user, isLoading, refresh };
}

export interface UserMetadataStore {
  metadata: Readable<Record<string, unknown> | null>;
  isLoading: Readable<boolean>;
  refresh: () => Promise<void>;
  set: (patch: Record<string, unknown>) => Promise<void>;
}

export function createUserMetadataStore(client?: BrivenAuthClient): UserMetadataStore {
  const auth = client ?? getBrivenAuthContext();
  const metadata = writable<Record<string, unknown> | null>(null);
  const isLoading = writable(true);

  const refresh = async () => {
    isLoading.set(true);
    const result = await auth.user.getMetadata();
    metadata.set(result.ok ? result.publicMetadata : null);
    isLoading.set(false);
  };

  const set = async (patch: Record<string, unknown>) => {
    const result = await auth.user.setMetadata(patch);
    if (result.ok) metadata.set(result.publicMetadata);
  };

  const unsub = metadata.subscribe(() => {});
  refresh().then(() => unsub());

  return { metadata, isLoading, refresh, set };
}

export interface UserEmailsStore {
  emails: Readable<UserEmail[] | null>;
  isLoading: Readable<boolean>;
  refresh: () => Promise<void>;
  add: (email: string) => Promise<void>;
  remove: (emailId: string) => Promise<void>;
}

export function createUserEmailsStore(client?: BrivenAuthClient): UserEmailsStore {
  const auth = client ?? getBrivenAuthContext();
  const emails = writable<UserEmail[] | null>(null);
  const isLoading = writable(true);

  const refresh = async () => {
    isLoading.set(true);
    const result = await auth.user.listEmails();
    emails.set(result.ok ? result.emails : null);
    isLoading.set(false);
  };

  const add = async (email: string) => {
    const result = await auth.user.addEmail(email);
    if (result.ok) await refresh();
  };

  const remove = async (emailId: string) => {
    const result = await auth.user.removeEmail(emailId);
    if (result.ok) await refresh();
  };

  const unsub = emails.subscribe(() => {});
  refresh().then(() => unsub());

  return { emails, isLoading, refresh, add, remove };
}

export interface ActiveOrganizationStore {
  activeOrg: Readable<Org | null>;
  isLoading: Readable<boolean>;
  refresh: () => Promise<void>;
  setActive: (orgId: string) => Promise<void>;
}

export function createActiveOrganizationStore(client?: BrivenAuthClient): ActiveOrganizationStore {
  const auth = client ?? getBrivenAuthContext();
  const activeOrg = writable<Org | null>(null);
  const isLoading = writable(true);

  const refresh = async () => {
    isLoading.set(true);
    const result = await auth.organization.getActive();
    if (result.ok) activeOrg.set(result.data);
    isLoading.set(false);
  };

  const setActive = async (orgId: string) => {
    const result = await auth.organization.setActive(orgId);
    if (result.ok) await refresh();
  };

  const unsub = activeOrg.subscribe(() => {});
  refresh().then(() => unsub());

  return { activeOrg, isLoading, refresh, setActive };
}

export interface SessionsStore {
  sessions: Readable<ClientSession[]>;
  isLoading: Readable<boolean>;
  error: Readable<string | null>;
  refresh: () => Promise<void>;
  revoke: (sessionId: string) => Promise<void>;
}

export function createSessionsStore(client?: BrivenAuthClient): SessionsStore {
  const auth = client ?? getBrivenAuthContext();
  const sessions = writable<ClientSession[]>([]);
  const isLoading = writable(true);
  const error = writable<string | null>(null);

  const refresh = async () => {
    isLoading.set(true);
    error.set(null);
    const result = await auth.sessions.list();
    if (result.ok) {
      sessions.set(result.sessions);
    } else {
      error.set(result.message);
    }
    isLoading.set(false);
  };

  const revoke = async (sessionId: string) => {
    const result = await auth.sessions.revoke(sessionId);
    if (result.ok) {
      await refresh();
    } else {
      error.set(result.message);
    }
  };

  const unsub = sessions.subscribe(() => {});
  refresh().then(() => unsub());

  return { sessions, isLoading, error, refresh, revoke };
}

// ─── SSO Store ─────────────────────────────────────────────────────────────

export interface SsoStore {
  connections: Readable<Array<Pick<SsoConnection, 'id' | 'name' | 'providerType' | 'domains'>> | null>;
  isLoading: Readable<boolean>;
  refresh: () => Promise<void>;
}

export function createSsoStore(client?: BrivenAuthClient): SsoStore {
  const auth = client ?? getBrivenAuthContext();
  const connections = writable<Array<Pick<SsoConnection, 'id' | 'name' | 'providerType' | 'domains'>> | null>(null);
  const isLoading = writable(true);

  const refresh = async () => {
    isLoading.set(true);
    const result = await auth.sso.listConnections();
    if (result.ok) connections.set(result.connections);
    isLoading.set(false);
  };

  const unsub = connections.subscribe(() => {});
  refresh().then(() => unsub());

  return { connections, isLoading, refresh };
}
