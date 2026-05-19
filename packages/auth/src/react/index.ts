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
}

const DEFAULT_PROVIDERS: ReadonlyArray<OAuthProvider> = [
  'google',
  'github',
  'discord',
  'microsoft',
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

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [magicEmail, setMagicEmail] = useState('');
  const [pending, setPending] = useState<'password' | 'magic' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  const handlePassword = useCallback(
    async (e: FormEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
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
    [auth, email, password, props],
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

export type { BrivenAuthClient, SessionResponse, SignInResult, User, OAuthProvider };
