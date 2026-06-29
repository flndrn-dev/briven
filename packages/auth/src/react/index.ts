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
  type OAuthProvider,
  type SessionResponse,
  type SignInResult,
  type SocialProvider,
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

export interface BrivenSignInProps {
  /**
   * Providers to render as OAuth buttons. An empty array hides the OAuth
   * section. When OMITTED, the component auto-discovers the project's enabled
   * providers at runtime (via `auth.getEnabledProviders()`) and renders only
   * those — so it never shows a button for a provider that isn't wired.
   */
  providers?: ReadonlyArray<SocialProvider>;
  /** Render the email + password form. Default true. */
  showEmailPassword?: boolean;
  /** Render the magic-link section. Default true. */
  showMagicLink?: boolean;
  /** Post-sign-in URL the customer's app wants users to land on. */
  redirectTo?: string;
  /**
   * Whether to render a sign-in or sign-up form. Defaults to `'sign-in'`.
   * In `'sign-up'` mode the form calls `auth.signUp.email()` and shows an
   * optional name field. Use `<BrivenSignUp>` as a convenience alias.
   */
  mode?: 'sign-in' | 'sign-up';
  /** Called when sign-in / sign-up completes successfully. */
  onSuccess?: (result: { userId: string }) => void;
  /** Optional className applied to the root container. */
  className?: string;
}

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
  const mode = props.mode ?? 'sign-in';
  const explicitProviders = props.providers;
  const showEmailPassword = props.showEmailPassword ?? true;
  const showMagicLink = props.showMagicLink ?? true;

  // Auto-discovery: when the caller does NOT pass `providers`, fetch the
  // project's enabled list once on mount instead of defaulting to all five
  // built-ins (which would render buttons for unconfigured providers). `null`
  // means "not fetched yet" → render no OAuth buttons until the list lands.
  const [discovered, setDiscovered] = useState<ReadonlyArray<string> | null>(null);
  useEffect(() => {
    if (explicitProviders !== undefined) return;
    let cancelled = false;
    void (async () => {
      const list = await auth.getEnabledProviders();
      if (!cancelled) setDiscovered(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, explicitProviders]);

  const providers: ReadonlyArray<SocialProvider> =
    explicitProviders ?? discovered ?? [];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [magicEmail, setMagicEmail] = useState('');
  const [pending, setPending] = useState<'password' | 'magic' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  const handlePassword = useCallback(
    async (e: FormEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
      setPending('password');
      setError(null);
      const result: SignInResult =
        mode === 'sign-up'
          ? await auth.signUp.email({ email, password, name: name || undefined })
          : await auth.signIn.email({ email, password });
      if (result.ok) {
        props.onSuccess?.({ userId: result.userId });
      } else {
        setError(result.message);
      }
      setPending(null);
    },
    [auth, email, password, name, mode, props],
  );

  const handleMagic = useCallback(
    async (e: FormEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
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
    [auth, magicEmail, props.redirectTo],
  );

  const handleOAuth = useCallback(
    (provider: SocialProvider): void => {
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
      className:
        props.className ?? (mode === 'sign-up' ? 'briven-auth-signup' : 'briven-auth-signin'),
      'data-briven-auth': mode === 'sign-up' ? 'signup' : 'signin',
    },
    showEmailPassword
      ? createElement(
          'form',
          {
            key: 'password',
            onSubmit: handlePassword,
            className: 'briven-auth-form',
            'data-briven-auth-flow': mode === 'sign-up' ? 'sign-up' : 'password',
          },
          mode === 'sign-up'
            ? createElement('input', {
                key: 'name',
                type: 'text',
                placeholder: 'full name (optional)',
                value: name,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
                autoComplete: 'name',
                className: 'briven-auth-input',
              })
            : null,
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
            autoComplete: mode === 'sign-up' ? 'new-password' : 'current-password',
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
            pending === 'password'
              ? mode === 'sign-up'
                ? 'creating account…'
                : 'signing in…'
              : mode === 'sign-up'
                ? 'create account'
                : 'sign in',
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

/**
 * Returns a stable function that calls `auth.signOut()`.
 * Convenience alternative to `const auth = useBrivenAuth(); auth.signOut()`.
 *
 * @example
 * ```tsx
 * function SignOutButton() {
 *   const signOut = useSignOut();
 *   return <button onClick={signOut}>sign out</button>;
 * }
 * ```
 */
export function useSignOut(): () => Promise<{ ok: boolean }> {
  const auth = useBrivenAuth();
  return useCallback(() => auth.signOut(), [auth]);
}

/** Props for `<BrivenSignUp>` — identical to `BrivenSignInProps` without `mode`. */
export type BrivenSignUpProps = Omit<BrivenSignInProps, 'mode'>;

/**
 * Drop-in sign-up component. Mirrors `<BrivenSignIn>` but wires
 * email+password to `auth.signUp.email()` and adds an optional name field.
 * Identical to `<BrivenSignIn mode="sign-up" />`.
 */
export function BrivenSignUp(props: BrivenSignUpProps) {
  return createElement(BrivenSignIn, { ...props, mode: 'sign-up' });
}

export type {
  BrivenAuthClient,
  SessionResponse,
  SignInResult,
  User,
  OAuthProvider,
  SocialProvider,
};
