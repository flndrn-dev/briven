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
  type OAuthProvider,
  type SessionResponse,
  type SignInResult,
  type SimpleResult,
  type User,
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

// ─── Shared helpers ────────────────────────────────────────────────────────

function useRedirectToHosted(auth: BrivenAuthClient, redirectTo?: string) {
  return useCallback(
    (flow: 'sign-in' | 'sign-up' | 'magic-link') => {
      const url = auth.hostedPageURL(flow, redirectTo);
      if (typeof window !== 'undefined') {
        window.location.assign(url);
      }
    },
    [auth, redirectTo],
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

  const redirectToHosted = useRedirectToHosted(auth, props.redirectTo);

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

  const redirectToHosted = useRedirectToHosted(auth, props.redirectTo);

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

export type {
  BrivenAuthClient,
  ClientSession,
  OAuthProvider,
  SessionResponse,
  SignInResult,
  SimpleResult,
  User,
};
