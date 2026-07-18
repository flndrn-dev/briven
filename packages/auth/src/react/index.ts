'use client';

/**
 * @briven/auth/react — React bindings for `@briven/auth`.
 *
 * Provider wraps the customer app; hooks pull state from the provider's
 * context; the prebuilt component is opt-in. Zero hard dependency on
 * Next.js — works in any React 19 environment.
 *
 *   import { BrivenAuthProvider, useSession, useUser, BrivenSignIn } from '@briven/auth/react';
 *
 *   <BrivenAuthProvider value={auth}>
 *     <App />
 *   </BrivenAuthProvider>
 *
 *   function App() {
 *     const { session, isLoading } = useSession();
 *     return session ? <Home /> : <BrivenSignIn />;
 *   }
 *
 * Bundle target (§5): `<BrivenSignIn />` gzipped < 35 KB. The component
 * carries no icon library + no css framework; the customer's app styles
 * apply via the `className` prop set on every interactive element.
 */

import {
  createContext,
  createElement,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  type BrivenAuthClient,
  type ClientSession,
  type MembershipRequest,
  type OAuthProvider,
  type Org,
  type OrgDomain,
  type OrgInvite,
  type OrgMember,
  type OrgPermission,
  type OrgRole,
  type Passkey,
  type SessionResponse,
  type SignInResult,
  type SimpleResult,
  type SsoConnection,
  type SsoProviderType,
  type User,
  type UserEmail,
} from '../index.js';

const BrivenAuthContext = createContext<BrivenAuthClient | null>(null);

export interface BrivenAuthProviderProps {
  value: BrivenAuthClient;
  children: ReactNode;
}

/**
 * Provider for the SDK client. Re-render-safe — the client is stateless,
 * so passing a new instance is allowed but unnecessary.
 */
export function BrivenAuthProvider({ value, children }: BrivenAuthProviderProps) {
  return createElement(BrivenAuthContext.Provider, { value }, children);
}

/** Throws when called outside a `<BrivenAuthProvider>`. */
export function useBrivenAuth(): BrivenAuthClient {
  const client = useContext(BrivenAuthContext);
  if (!client) {
    throw new Error('useBrivenAuth must be called inside <BrivenAuthProvider>');
  }
  return client;
}

export interface UseSessionResult {
  session: SessionResponse | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Subscribe to the current session. Fetches once on mount; the caller
 * can re-fetch via `refresh()` after sign-in / sign-out actions.
 */
export function useSession(): UseSessionResult {
  const client = useBrivenAuth();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [isLoading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await client.getSession();
    setSession(next);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await client.getSession();
      if (!cancelled) {
        setSession(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  return { session, isLoading, refresh };
}

export interface UseUserResult {
  user: User | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Subscribe to the current user. Same fetch lifecycle as `useSession`.
 * Returned `User` carries `email` for the account holder — never echo
 * it back into a list view or analytics event (CLAUDE.md §5.1 applies
 * to consumer apps too).
 */
export function useUser(): UseUserResult {
  const client = useBrivenAuth();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await client.getUser();
    setUser(next);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await client.getUser();
      if (!cancelled) {
        setUser(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  return { user, isLoading, refresh };
}

export interface UseUserMetadataResult {
  metadata: Record<string, unknown> | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  set: (patch: Record<string, unknown>) => Promise<void>;
}

/**
 * Subscribe to the current user's public metadata.
 * Fetches once on mount; caller can re-fetch via `refresh()`.
 */
export function useUserMetadata(): UseUserMetadataResult {
  const client = useBrivenAuth();
  const [metadata, setMetadata] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await client.user.getMetadata();
    setMetadata(result.ok ? result.publicMetadata : null);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await client.user.getMetadata();
      if (!cancelled) {
        setMetadata(result.ok ? result.publicMetadata : null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const set = useCallback(
    async (patch: Record<string, unknown>) => {
      const result = await client.user.setMetadata(patch);
      if (result.ok) {
        setMetadata(result.publicMetadata);
      }
    },
    [client],
  );

  return { metadata, isLoading, refresh, set };
}

export interface UseUserEmailsResult {
  emails: UserEmail[] | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  add: (email: string) => Promise<void>;
  remove: (emailId: string) => Promise<void>;
}

/**
 * Subscribe to the current user's additional email addresses.
 * Fetches once on mount; caller can re-fetch via `refresh()`.
 */
export function useUserEmails(): UseUserEmailsResult {
  const client = useBrivenAuth();
  const [emails, setEmails] = useState<UserEmail[] | null>(null);
  const [isLoading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await client.user.listEmails();
    setEmails(result.ok ? result.emails : null);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await client.user.listEmails();
      if (!cancelled) {
        setEmails(result.ok ? result.emails : null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const add = useCallback(
    async (email: string) => {
      const result = await client.user.addEmail(email);
      if (result.ok) await refresh();
    },
    [client, refresh],
  );

  const remove = useCallback(
    async (emailId: string) => {
      const result = await client.user.removeEmail(emailId);
      if (result.ok) await refresh();
    },
    [client, refresh],
  );

  return { emails, isLoading, refresh, add, remove };
}

export interface UseActiveOrganizationResult {
  activeOrg: Org | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  setActive: (orgId: string) => Promise<void>;
}

/**
 * Subscribe to the currently-active organization for this session.
 * The active org is set via `organization.setActive(orgId)` and persists
 * per-session, so org switching does not require re-authentication.
 */
export function useActiveOrganization(): UseActiveOrganizationResult {
  const client = useBrivenAuth();
  const [activeOrg, setActiveOrg] = useState<Org | null>(null);
  const [isLoading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await client.organization.getActive();
    if (result.ok) setActiveOrg(result.data);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await client.organization.getActive();
      if (!cancelled) {
        setActiveOrg(result.ok ? result.data : null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const setActive = useCallback(
    async (orgId: string) => {
      const result = await client.organization.setActive(orgId);
      if (result.ok) await refresh();
    },
    [client, refresh],
  );

  return { activeOrg, isLoading, refresh, setActive };
}

// ─── Shared helpers ────────────────────────────────────────────────────────

function useRedirectToHosted(auth: BrivenAuthClient, redirectTo?: string, locale?: string) {
  return useCallback(
    (flow: 'sign-in' | 'sign-up' | 'magic-link') => {
      const url = auth.hostedPageURL(flow, redirectTo, locale);
      if (typeof window !== 'undefined') {
        window.location.assign(url);
      }
    },
    [auth, redirectTo, locale],
  );
}

// ─── BrivenSignIn ──────────────────────────────────────────────────────────

export interface BrivenSignInProps {
  /** Providers to render as OAuth buttons. Empty array hides the OAuth section. */
  providers?: ReadonlyArray<OAuthProvider>;
  /** Render the email + password form. Default true. */
  showEmailPassword?: boolean;
  /** Render the magic-link section. Default true. */
  showMagicLink?: boolean;
  /** Post-sign-in URL the customer's app wants users to land on. */
  redirectTo?: string;
  /** Called when sign-in completes successfully. */
  onSuccess?: (result: { userId: string }) => void;
  /** Optional className applied to the root container. */
  className?: string;
  /**
   * 'direct' (default) — make cross-origin API calls from the component.
   * 'hosted' — redirect to Briven's hosted auth pages. Eliminates CORS
   * and origin-allowlist issues; recommended for production.
   */
  mode?: 'direct' | 'hosted';
  /** BCP 47 locale for hosted-page redirects (e.g. 'nl', 'fr-FR'). */
  locale?: string;
}

const DEFAULT_PROVIDERS: ReadonlyArray<OAuthProvider> = [
  'google',
  'github',
  'discord',
  'microsoft',
  'apple',
  'twitter',
  'linkedin',
  'gitlab',
];

/**
 * Drop-in sign-in component. Renders email+password, magic-link, and the
 * configured OAuth providers in a single panel. No CSS framework — the
 * caller styles via the standard `class` attribute on the elements
 * via the `className` prop (root) and the cascaded element styles.
 *
 * Customer can compose their own UI by wiring the hooks directly:
 *   `const auth = useBrivenAuth(); await auth.signIn.email({...})`.
 */
export function BrivenSignIn(props: BrivenSignInProps) {
  const auth = useBrivenAuth();
  const providers = props.providers ?? DEFAULT_PROVIDERS;
  const showEmailPassword = props.showEmailPassword ?? true;
  const showMagicLink = props.showMagicLink ?? true;
  const mode = props.mode ?? 'direct';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [magicEmail, setMagicEmail] = useState('');
  const [pending, setPending] = useState<'password' | 'magic' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  const redirectToHosted = useRedirectToHosted(auth, props.redirectTo, props.locale);

  const handlePassword = useCallback(
    async (e: FormEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
      if (mode === 'hosted') {
        redirectToHosted('sign-in');
        return;
      }
      setPending('password');
      setError(null);
      const result: SignInResult = await auth.signIn.email({ email, password });
      if (result.ok) {
        props.onSuccess?.({ userId: result.userId });
      } else {
        setError(result.message);
      }
      setPending(null);
    },
    [auth, email, mode, password, props, redirectToHosted],
  );

  const handleMagic = useCallback(
    async (e: FormEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
      if (mode === 'hosted') {
        redirectToHosted('magic-link');
        return;
      }
      setPending('magic');
      setError(null);
      const result = await auth.signIn.magicLink({
        email: magicEmail,
        redirectTo: props.redirectTo,
      });
      if (result.ok) {
        setMagicSent(true);
      } else {
        setError(result.message);
      }
      setPending(null);
    },
    [auth, magicEmail, mode, props.redirectTo, redirectToHosted],
  );

  const handleOAuth = useCallback(
    (provider: OAuthProvider): void => {
      const { redirectUrl } = auth.signIn.social({
        provider,
        redirectTo: props.redirectTo,
      });
      if (typeof window !== 'undefined') {
        window.location.assign(redirectUrl);
      }
    },
    [auth, props.redirectTo],
  );

  const oauthButtons = useMemo(
    () =>
      providers.map((provider) =>
        createElement(
          'button',
          {
            key: provider,
            type: 'button',
            'data-briven-auth-provider': provider,
            onClick: () => handleOAuth(provider),
            className: 'briven-auth-oauth-button',
          },
          `continue with ${provider}`,
        ),
      ),
    [providers, handleOAuth],
  );

  return createElement(
    'div',
    {
      className: props.className ?? 'briven-auth-signin',
      'data-briven-auth': 'signin',
    },
    showEmailPassword
      ? createElement(
          'form',
          {
            key: 'password',
            onSubmit: handlePassword,
            className: 'briven-auth-form',
            'data-briven-auth-flow': 'password',
          },
          createElement('input', {
            key: 'email',
            type: 'email',
            required: true,
            placeholder: 'email',
            value: email,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value),
            autoComplete: 'email',
            className: 'briven-auth-input',
          }),
          createElement('input', {
            key: 'password',
            type: 'password',
            required: true,
            placeholder: 'password',
            value: password,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value),
            autoComplete: 'current-password',
            className: 'briven-auth-input',
          }),
          createElement(
            'button',
            {
              key: 'submit',
              type: 'submit',
              disabled: pending !== null,
              className: 'briven-auth-submit',
            },
            pending === 'password' ? 'signing in…' : 'sign in',
          ),
        )
      : null,
    showMagicLink
      ? magicSent
        ? createElement(
            'p',
            { key: 'magic-sent', className: 'briven-auth-message' },
            'check your inbox for the sign-in link.',
          )
        : createElement(
            'form',
            {
              key: 'magic',
              onSubmit: handleMagic,
              className: 'briven-auth-form',
              'data-briven-auth-flow': 'magic-link',
            },
            createElement('input', {
              key: 'email',
              type: 'email',
              required: true,
              placeholder: 'email for magic link',
              value: magicEmail,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                setMagicEmail(e.target.value),
              autoComplete: 'email',
              className: 'briven-auth-input',
            }),
            createElement(
              'button',
              {
                key: 'submit',
                type: 'submit',
                disabled: pending !== null,
                className: 'briven-auth-submit',
              },
              pending === 'magic' ? 'sending…' : 'send magic link',
            ),
          )
      : null,
    providers.length > 0
      ? createElement(
          'div',
          {
            key: 'oauth',
            className: 'briven-auth-oauth',
            'data-briven-auth-flow': 'oauth',
          },
          oauthButtons,
        )
      : null,
    error
      ? createElement(
          'p',
          {
            key: 'error',
            className: 'briven-auth-error',
            role: 'alert',
          },
          error,
        )
      : null,
  );
}

// ─── BrivenSignUp ──────────────────────────────────────────────────────────

export interface BrivenSignUpProps {
  /** Providers to render as OAuth buttons. Empty array hides the OAuth section. */
  providers?: ReadonlyArray<OAuthProvider>;
  /** Render the email + password form. Default true. */
  showEmailPassword?: boolean;
  /** Post-sign-up URL the customer's app wants users to land on. */
  redirectTo?: string;
  /** Called when sign-up completes successfully. */
  onSuccess?: (result: { userId: string }) => void;
  /** Optional className applied to the root container. */
  className?: string;
  /**
   * 'direct' (default) — make cross-origin API calls from the component.
   * 'hosted' — redirect to Briven's hosted auth pages. Eliminates CORS
   * and origin-allowlist issues; recommended for production.
   */
  mode?: 'direct' | 'hosted';
  /** BCP 47 locale for hosted-page redirects (e.g. 'nl', 'fr-FR'). */
  locale?: string;
}

/**
 * Drop-in sign-up component. Renders email+password + OAuth providers.
 * Mirrors BrivenSignIn's contract and styling approach.
 */
export function BrivenSignUp(props: BrivenSignUpProps) {
  const auth = useBrivenAuth();
  const providers = props.providers ?? DEFAULT_PROVIDERS;
  const showEmailPassword = props.showEmailPassword ?? true;
  const mode = props.mode ?? 'direct';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectToHosted = useRedirectToHosted(auth, props.redirectTo, props.locale);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
      if (mode === 'hosted') {
        redirectToHosted('sign-up');
        return;
      }
      setPending(true);
      setError(null);
      const result: SignInResult = await auth.signUp.email({
        email,
        password,
        name: name || undefined,
      });
      if (result.ok) {
        props.onSuccess?.({ userId: result.userId });
      } else {
        setError(result.message);
      }
      setPending(false);
    },
    [auth, email, mode, name, password, props, redirectToHosted],
  );

  const handleOAuth = useCallback(
    (provider: OAuthProvider): void => {
      const { redirectUrl } = auth.signIn.social({
        provider,
        redirectTo: props.redirectTo,
      });
      if (typeof window !== 'undefined') {
        window.location.assign(redirectUrl);
      }
    },
    [auth, props.redirectTo],
  );

  const oauthButtons = useMemo(
    () =>
      providers.map((provider) =>
        createElement(
          'button',
          {
            key: provider,
            type: 'button',
            'data-briven-auth-provider': provider,
            onClick: () => handleOAuth(provider),
            className: 'briven-auth-oauth-button',
          },
          `continue with ${provider}`,
        ),
      ),
    [providers, handleOAuth],
  );

  return createElement(
    'div',
    {
      className: props.className ?? 'briven-auth-signup',
      'data-briven-auth': 'signup',
    },
    showEmailPassword
      ? createElement(
          'form',
          {
            key: 'password',
            onSubmit: handleSubmit,
            className: 'briven-auth-form',
            'data-briven-auth-flow': 'password',
          },
          createElement('input', {
            key: 'name',
            type: 'text',
            placeholder: 'name (optional)',
            value: name,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
            autoComplete: 'name',
            className: 'briven-auth-input',
          }),
          createElement('input', {
            key: 'email',
            type: 'email',
            required: true,
            placeholder: 'email',
            value: email,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value),
            autoComplete: 'email',
            className: 'briven-auth-input',
          }),
          createElement('input', {
            key: 'password',
            type: 'password',
            required: true,
            placeholder: 'password',
            value: password,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value),
            autoComplete: 'new-password',
            className: 'briven-auth-input',
          }),
          createElement(
            'button',
            {
              key: 'submit',
              type: 'submit',
              disabled: pending,
              className: 'briven-auth-submit',
            },
            pending ? 'creating account…' : 'create account',
          ),
        )
      : null,
    providers.length > 0
      ? createElement(
          'div',
          {
            key: 'oauth',
            className: 'briven-auth-oauth',
            'data-briven-auth-flow': 'oauth',
          },
          oauthButtons,
        )
      : null,
    error
      ? createElement(
          'p',
          {
            key: 'error',
            className: 'briven-auth-error',
            role: 'alert',
          },
          error,
        )
      : null,
  );
}

// ─── UserButton ────────────────────────────────────────────────────────────

export interface UserButtonProps {
  /** Optional className applied to the root container. */
  className?: string;
  /** URL to redirect to when "Profile" is clicked. Defaults to hosted profile page. */
  profileUrl?: string;
}

/**
 * Drop-in user button. Shows the current user's name (or email) in a
 * dropdown with profile + sign-out actions. Renders nothing while loading
 * or when unauthenticated.
 */
export function UserButton(props: UserButtonProps) {
  const auth = useBrivenAuth();
  const { user, isLoading } = useUser();
  const [open, setOpen] = useState(false);

  const handleSignOut = useCallback(async () => {
    await auth.signOut();
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, [auth]);

  const handleProfile = useCallback(() => {
    const url = props.profileUrl ?? auth.hostedPageURL('profile');
    if (typeof window !== 'undefined') {
      window.location.assign(url);
    }
  }, [auth, props.profileUrl]);

  if (isLoading || !user) return null;

  const label = user.name ?? user.email;

  return createElement(
    'div',
    {
      className: props.className ?? 'briven-auth-userbutton',
      'data-briven-auth': 'userbutton',
    },
    createElement(
      'button',
      {
        type: 'button',
        onClick: () => setOpen((v) => !v),
        className: 'briven-auth-userbutton-trigger',
      },
      label,
    ),
    open
      ? createElement(
          'div',
          {
            className: 'briven-auth-userbutton-dropdown',
            'data-briven-auth-dropdown': 'open',
          },
          createElement(
            'button',
            {
              type: 'button',
              onClick: handleProfile,
              className: 'briven-auth-userbutton-item',
            },
            'profile',
          ),
          createElement(
            'button',
            {
              type: 'button',
              onClick: handleSignOut,
              className: 'briven-auth-userbutton-item',
            },
            'sign out',
          ),
        )
      : null,
  );
}

// ─── UserProfile ───────────────────────────────────────────────────────────

export interface UserProfileProps {
  /** Optional className applied to the root container. */
  className?: string;
  /** Called after the user is updated successfully. */
  onUpdate?: () => void;
}

/**
 * Drop-in user profile component. Renders name, email, password change
 * form, and account deletion. No CSS framework — caller styles via
 * `className` and cascading element classes.
 */
export function UserProfile(props: UserProfileProps) {
  const auth = useBrivenAuth();
  const { user, refresh } = useUser();

  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [updatePending, setUpdatePending] = useState(false);
  const [pwPending, setPwPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user?.name]);

  const handleUpdate = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setUpdatePending(true);
      setError(null);
      setMessage(null);
      const result = await auth.user.update({ name: name || undefined });
      if (result.ok) {
        setMessage('profile updated');
        await refresh();
        props.onUpdate?.();
      } else {
        setError(result.message);
      }
      setUpdatePending(false);
    },
    [auth.user, name, props, refresh],
  );

  const handleChangePassword = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setPwPending(true);
      setError(null);
      setMessage(null);
      const result = await auth.user.changePassword({ currentPassword, newPassword });
      if (result.ok) {
        setMessage('password changed');
        setCurrentPassword('');
        setNewPassword('');
      } else {
        setError(result.message);
      }
      setPwPending(false);
    },
    [auth.user, currentPassword, newPassword],
  );

  const handleDelete = useCallback(async () => {
    if (!window.confirm('Delete your account? This cannot be undone.')) return;
    setDeletePending(true);
    setError(null);
    setMessage(null);
    const result = await auth.user.delete();
    if (result.ok) {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } else {
      setError(result.message);
      setDeletePending(false);
    }
  }, [auth.user]);

  if (!user) {
    return createElement(
      'p',
      { className: 'briven-auth-message' },
      'not authenticated',
    );
  }

  return createElement(
    'div',
    {
      className: props.className ?? 'briven-auth-userprofile',
      'data-briven-auth': 'userprofile',
    },
    createElement(
      'form',
      {
        key: 'profile',
        onSubmit: handleUpdate,
        className: 'briven-auth-form',
        'data-briven-auth-flow': 'profile-update',
      },
      createElement('h3', { className: 'briven-auth-heading' }, 'profile'),
      createElement('input', {
        key: 'name',
        type: 'text',
        placeholder: 'name',
        value: name,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
        className: 'briven-auth-input',
      }),
      createElement('input', {
        key: 'email',
        type: 'email',
        disabled: true,
        value: user.email,
        className: 'briven-auth-input',
      }),
      createElement(
        'button',
        {
          key: 'submit',
          type: 'submit',
          disabled: updatePending,
          className: 'briven-auth-submit',
        },
        updatePending ? 'saving…' : 'save profile',
      ),
    ),
    createElement(
      'form',
      {
        key: 'password',
        onSubmit: handleChangePassword,
        className: 'briven-auth-form',
        'data-briven-auth-flow': 'change-password',
      },
      createElement('h3', { className: 'briven-auth-heading' }, 'change password'),
      createElement('input', {
        key: 'current',
        type: 'password',
        required: true,
        placeholder: 'current password',
        value: currentPassword,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCurrentPassword(e.target.value),
        autoComplete: 'current-password',
        className: 'briven-auth-input',
      }),
      createElement('input', {
        key: 'new',
        type: 'password',
        required: true,
        placeholder: 'new password',
        value: newPassword,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value),
        autoComplete: 'new-password',
        className: 'briven-auth-input',
      }),
      createElement(
        'button',
        {
          key: 'submit',
          type: 'submit',
          disabled: pwPending,
          className: 'briven-auth-submit',
        },
        pwPending ? 'changing…' : 'change password',
      ),
    ),
    createElement(
      'div',
      {
        key: 'danger',
        className: 'briven-auth-danger-zone',
        'data-briven-auth-flow': 'delete-account',
      },
      createElement('h3', { className: 'briven-auth-heading' }, 'danger zone'),
      createElement(
        'button',
        {
          type: 'button',
          onClick: handleDelete,
          disabled: deletePending,
          className: 'briven-auth-danger-button',
        },
        deletePending ? 'deleting…' : 'delete account',
      ),
    ),
    message
      ? createElement('p', { key: 'message', className: 'briven-auth-message' }, message)
      : null,
    error
      ? createElement('p', { key: 'error', className: 'briven-auth-error', role: 'alert' }, error)
      : null,
  );
}

// ─── SessionManager ────────────────────────────────────────────────────────

export interface SessionManagerProps {
  /** Optional className applied to the root container. */
  className?: string;
}

/**
 * Drop-in session manager. Lists active sessions with a revoke button
 * for each. No CSS framework — caller styles via `className` and
 * cascading element classes.
 */
export function SessionManager(props: SessionManagerProps) {
  const auth = useBrivenAuth();
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await auth.sessions.list();
    if (result.ok) {
      setSessions(result.sessions);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, [auth]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = useCallback(
    async (sessionId: string) => {
      const result = await auth.sessions.revoke(sessionId);
      if (result.ok) {
        await load();
      } else {
        setError(result.message);
      }
    },
    [auth, load],
  );

  return createElement(
    'div',
    {
      className: props.className ?? 'briven-auth-sessionmanager',
      'data-briven-auth': 'sessionmanager',
    },
    createElement('h3', { className: 'briven-auth-heading' }, 'active sessions'),
    isLoading
      ? createElement('p', { className: 'briven-auth-message' }, 'loading…')
      : sessions.length === 0
        ? createElement('p', { className: 'briven-auth-message' }, 'no active sessions')
        : createElement(
            'ul',
            { className: 'briven-auth-session-list' },
            sessions.map((s) =>
              createElement(
                'li',
                { key: s.id, className: 'briven-auth-session-item' },
                createElement(
                  'span',
                  { className: 'briven-auth-session-info' },
                  s.userAgent ?? 'unknown device',
                ),
                createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: () => handleRevoke(s.id),
                    className: 'briven-auth-session-revoke',
                  },
                  'revoke',
                ),
              ),
            ),
          ),
    error
      ? createElement('p', { className: 'briven-auth-error', role: 'alert' }, error)
      : null,
  );
}

// ─── OrganizationSwitcher ─────────────────────────────────────────────────

export interface OrganizationSwitcherProps {
  /** Optional className applied to the root container. */
  className?: string;
}

/**
 * Drop-in organization switcher. Shows the active organization (if any)
 * and a dropdown to switch between orgs or create a new one. Renders
 * nothing while loading or unauthenticated.
 *
 * Uses the same `briven-auth-*` CSS class convention as the rest of the
 * SDK — no Clerk UI cloning.
 */
export function OrganizationSwitcher(props: OrganizationSwitcherProps) {
  const auth = useBrivenAuth();
  const { activeOrg, setActive } = useActiveOrganization();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await auth.organization.list();
    if (result.ok) setOrgs(result.data);
    setLoading(false);
  }, [auth]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback(async (name: string, slug: string) => {
    const result = await auth.organization.create({ name, slug });
    if (result.ok) {
      setShowCreate(false);
      await load();
    }
    return result;
  }, [auth, load]);

  const handleSwitch = useCallback(
    async (orgId: string) => {
      await setActive(orgId);
      setOpen(false);
    },
    [setActive],
  );

  if (isLoading) return null;

  if (orgs.length === 0) {
    return createElement(
      'button',
      {
        type: 'button',
        onClick: () => setShowCreate(true),
        className: props.className ?? 'briven-auth-org-switcher',
      },
      'create organization',
    );
  }

  return createElement(
    'div',
    {
      className: props.className ?? 'briven-auth-org-switcher',
      'data-briven-auth': 'org-switcher',
    },
    createElement(
      'button',
      {
        type: 'button',
        onClick: () => setOpen((v) => !v),
        className: 'briven-auth-org-switcher-trigger',
      },
      activeOrg?.name ?? 'switch organization',
    ),
    open
      ? createElement(
          'div',
          { className: 'briven-auth-org-switcher-dropdown' },
          orgs.map((org) =>
            createElement(
              'button',
              {
                key: org.id,
                type: 'button',
                onClick: () => handleSwitch(org.id),
                className:
                  org.id === activeOrg?.id
                    ? 'briven-auth-org-switcher-item briven-auth-org-switcher-item-active'
                    : 'briven-auth-org-switcher-item',
              },
              org.name,
            ),
          ),
          createElement(
            'button',
            {
              type: 'button',
              onClick: () => setShowCreate(true),
              className: 'briven-auth-org-switcher-create',
            },
            '+ create organization',
          ),
        )
      : null,
    showCreate
      ? createElement(CreateOrganization, {
          key: 'create',
          onCreate: handleCreate,
          onCancel: () => setShowCreate(false),
        })
      : null,
  );
}

// ─── CreateOrganization ───────────────────────────────────────────────────

export interface CreateOrganizationProps {
  onCreate(name: string, slug: string): Promise<unknown>;
  onCancel(): void;
}

export function CreateOrganization(props: CreateOrganizationProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setPending(true);
      setError(null);
      const result = await props.onCreate(name, slug);
      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        setError((result as { message?: string }).message ?? 'create failed');
      }
      setPending(false);
    },
    [name, props, slug],
  );

  return createElement(
    'div',
    { className: 'briven-auth-create-org' },
    createElement('h3', { className: 'briven-auth-heading' }, 'create organization'),
    createElement(
      'form',
      { className: 'briven-auth-form', onSubmit: handleSubmit },
      createElement('input', {
        type: 'text',
        required: true,
        placeholder: 'organization name',
        value: name,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
        className: 'briven-auth-input',
      }),
      createElement('input', {
        type: 'text',
        required: true,
        placeholder: 'slug (lowercase-hyphens)',
        value: slug,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSlug(e.target.value),
        pattern: '[a-z0-9-]{1,64}',
        className: 'briven-auth-input',
      }),
      createElement(
        'button',
        { type: 'submit', disabled: pending, className: 'briven-auth-submit' },
        pending ? 'creating…' : 'create',
      ),
    ),
    error ? createElement('p', { className: 'briven-auth-error', role: 'alert' }, error) : null,
    createElement(
      'button',
      { type: 'button', onClick: props.onCancel, className: 'briven-auth-cancel' },
      'cancel',
    ),
  );
}

// ─── OrganizationProfile ──────────────────────────────────────────────────

export interface OrganizationProfileProps {
  orgId: string;
  className?: string;
}

export function OrganizationProfile(props: OrganizationProfileProps) {
  const auth = useBrivenAuth();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [mResult, iResult] = await Promise.all([
      auth.organization.listMembers(props.orgId),
      auth.organization.listInvites(props.orgId),
    ]);
    if (mResult.ok) setMembers(mResult.data);
    if (iResult.ok) setInvites(iResult.data);
    setLoading(false);
  }, [auth, props.orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInvite = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      const result = await auth.organization.createInvite(props.orgId, { email: inviteEmail });
      if (result.ok) {
        setInviteEmail('');
        await load();
      } else {
        setError(result.message);
      }
    },
    [auth, inviteEmail, load, props.orgId],
  );

  const handleRemove = useCallback(
    async (userId: string) => {
      const result = await auth.organization.removeMember(props.orgId, userId);
      if (result.ok) await load();
      else setError(result.message);
    },
    [auth, load, props.orgId],
  );

  return createElement(
    'div',
    {
      className: props.className ?? 'briven-auth-org-profile',
      'data-briven-auth': 'org-profile',
    },
    createElement('h3', { className: 'briven-auth-heading' }, 'members'),
    isLoading
      ? createElement('p', { className: 'briven-auth-message' }, 'loading…')
      : createElement(
          'ul',
          { className: 'briven-auth-member-list' },
          members.map((m) =>
            createElement(
              'li',
              { key: m.id, className: 'briven-auth-member-item' },
              createElement('span', { className: 'briven-auth-member-role' }, m.role),
              createElement('span', { className: 'briven-auth-member-id' }, m.userId),
              m.role !== 'owner'
                ? createElement(
                    'button',
                    {
                      type: 'button',
                      onClick: () => handleRemove(m.userId),
                      className: 'briven-auth-member-remove',
                    },
                    'remove',
                  )
                : null,
            ),
          ),
        ),
    createElement('h3', { className: 'briven-auth-heading' }, 'invites'),
    createElement(
      'form',
      { className: 'briven-auth-form', onSubmit: handleInvite },
      createElement('input', {
        type: 'email',
        required: true,
        placeholder: 'email to invite',
        value: inviteEmail,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInviteEmail(e.target.value),
        className: 'briven-auth-input',
      }),
      createElement(
        'button',
        { type: 'submit', className: 'briven-auth-submit' },
        'send invite',
      ),
    ),
    invites.length > 0
      ? createElement(
          'ul',
          { className: 'briven-auth-invite-list' },
          invites.map((i) =>
            createElement(
              'li',
              { key: i.id, className: 'briven-auth-invite-item' },
              i.email,
              ' · ',
              i.role,
            ),
          ),
        )
      : null,
    error ? createElement('p', { className: 'briven-auth-error', role: 'alert' }, error) : null,
  );
}

// ─── TwoFactorSetup ───────────────────────────────────────────────────────

export interface TwoFactorSetupProps {
  className?: string;
  onEnabled?: () => void;
}

export function TwoFactorSetup(props: TwoFactorSetupProps) {
  const auth = useBrivenAuth();
  const [step, setStep] = useState<'idle' | 'enabling' | 'verify' | 'done'>('idle');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleEnable = useCallback(async () => {
    setStep('enabling');
    setError(null);
    const result = await auth.twoFactor.enable(password || undefined);
    if (result.ok) {
      setStep('verify');
    } else {
      setError(result.message);
      setStep('idle');
    }
  }, [auth, password]);

  const handleVerify = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      const result = await auth.twoFactor.verify(code);
      if (result.ok && !('twoFactorRequired' in result && result.twoFactorRequired)) {
        const codes = await auth.twoFactor.generateBackupCodes(password || undefined);
        if (codes.ok) setBackupCodes(codes.codes);
        setStep('done');
        props.onEnabled?.();
      } else if (result.ok) {
        // Unexpected intermediate challenge during enroll — still show verify UI.
        setError('enter the authenticator code again');
      } else {
        setError(result.message);
      }
    },
    [auth, code, password, props],
  );

  return createElement(
    'div',
    { className: props.className ?? 'briven-auth-2fa-setup' },
    step === 'idle'
      ? createElement(
          'div',
          { className: 'briven-auth-form' },
          createElement('p', { className: 'briven-auth-message' }, 'confirm your password, then scan the authenticator setup'),
          createElement('input', {
            type: 'password',
            required: true,
            placeholder: 'password',
            value: password,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value),
            className: 'briven-auth-input',
            autoComplete: 'current-password',
          }),
          createElement(
            'button',
            { type: 'button', onClick: handleEnable, className: 'briven-auth-submit' },
            'enable two-factor',
          ),
        )
      : null,
    step === 'verify'
      ? createElement(
          'form',
          { onSubmit: handleVerify, className: 'briven-auth-form' },
          createElement(
            'p',
            { className: 'briven-auth-message' },
            'enter the 6-digit code from your authenticator app',
          ),
          createElement('input', {
            type: 'text',
            required: true,
            placeholder: '6-digit code',
            value: code,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value),
            pattern: '\\d{6}',
            maxLength: 6,
            className: 'briven-auth-input',
            autoComplete: 'one-time-code',
          }),
          createElement('button', { type: 'submit', className: 'briven-auth-submit' }, 'verify'),
        )
      : null,
    backupCodes.length > 0
      ? createElement(
          'div',
          { className: 'briven-auth-backup-codes' },
          createElement(
            'p',
            { className: 'briven-auth-message' },
            'save these backup codes now — each works once if you lose your phone:',
          ),
          createElement(
            'ul',
            {},
            backupCodes.map((c) => createElement('li', { key: c, className: 'briven-auth-code' }, c)),
          ),
        )
      : null,
    error ? createElement('p', { className: 'briven-auth-error', role: 'alert' }, error) : null,
  );
}

// ─── TwoFactorChallenge (sign-in recovery) ───────────────────────────────

export interface TwoFactorChallengeProps {
  className?: string;
  onSuccess?: (userId: string) => void;
}

/**
 * Shown after password sign-in when the account has 2FA enabled.
 * Accepts either a TOTP app code or a single-use backup recovery code.
 */
export function TwoFactorChallenge(props: TwoFactorChallengeProps) {
  const auth = useBrivenAuth();
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setPending(true);
      setError(null);
      try {
        const result =
          mode === 'totp'
            ? await auth.twoFactor.verify(code)
            : await auth.twoFactor.verifyBackupCode(code);
        if (result.ok && 'userId' in result) {
          props.onSuccess?.(result.userId);
        } else if (result.ok) {
          setError('still needs another step — try again');
        } else {
          setError(result.message);
        }
      } finally {
        setPending(false);
      }
    },
    [auth, code, mode, props],
  );

  return createElement(
    'div',
    { className: props.className ?? 'briven-auth-2fa-challenge' },
    createElement(
      'form',
      { onSubmit: handleSubmit, className: 'briven-auth-form' },
      createElement(
        'p',
        { className: 'briven-auth-message' },
        mode === 'totp'
          ? 'enter the 6-digit code from your authenticator app'
          : 'enter one of your single-use backup codes (lost phone recovery)',
      ),
      createElement('input', {
        type: 'text',
        required: true,
        placeholder: mode === 'totp' ? '6-digit code' : 'backup code',
        value: code,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value),
        className: 'briven-auth-input',
        autoComplete: mode === 'totp' ? 'one-time-code' : 'off',
        ...(mode === 'totp' ? { pattern: '\\d{6}', maxLength: 6 } : {}),
      }),
      createElement(
        'button',
        { type: 'submit', className: 'briven-auth-submit', disabled: pending },
        pending ? 'checking…' : mode === 'totp' ? 'verify' : 'use backup code',
      ),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'briven-auth-link',
        onClick: () => {
          setMode(mode === 'totp' ? 'backup' : 'totp');
          setCode('');
          setError(null);
        },
      },
      mode === 'totp' ? 'lost your phone? use a backup code' : 'use authenticator code instead',
    ),
    error ? createElement('p', { className: 'briven-auth-error', role: 'alert' }, error) : null,
  );
}

// ─── PasskeyButton ────────────────────────────────────────────────────────

export interface PasskeyButtonProps {
  className?: string;
  mode?: 'register' | 'sign-in';
}

export function PasskeyButton(props: PasskeyButtonProps) {
  const auth = useBrivenAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setPending(true);
    setError(null);
    if (props.mode === 'register') {
      const result = await auth.passkey.register();
      if (!result.ok) setError(result.message);
    } else {
      const result = await auth.passkey.signIn();
      if (!result.ok) setError(result.message);
    }
    setPending(false);
  }, [auth, props.mode]);

  return createElement(
    'div',
    { className: props.className ?? 'briven-auth-passkey' },
    createElement(
      'button',
      {
        type: 'button',
        onClick: handleClick,
        disabled: pending,
        className: 'briven-auth-passkey-button',
      },
      props.mode === 'register' ? 'register passkey' : 'sign in with passkey',
    ),
    error ? createElement('p', { className: 'briven-auth-error', role: 'alert' }, error) : null,
  );
}

export type {
  BrivenAuthClient,
  ClientSession,
  MembershipRequest,
  OAuthProvider,
  Org,
  OrgDomain,
  OrgInvite,
  OrgMember,
  OrgPermission,
  OrgRole,
  Passkey,
  SessionResponse,
  SignInResult,
  SimpleResult,
  SsoConnection,
  SsoProviderType,
  User,
  UserEmail,
};
