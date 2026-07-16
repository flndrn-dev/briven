/**
 * @briven/auth/vue — Vue 3 bindings for `@briven/auth`.
 *
 *   import { createBrivenAuth } from '@briven/auth';
 *   import { BrivenAuthProvider, useSession, useUser } from '@briven/auth/vue';
 *
 *   const auth = createBrivenAuth({ projectId: 'p_abc123', publicKey: '...' });
 *
 *   <BrivenAuthProvider :value="auth">
 *     <App />
 *   </BrivenAuthProvider>
 *
 *   function App() {
 *     const { session, isLoading } = useSession();
 *     return session ? <Home /> : <BrivenSignIn />;
 *   }
 *
 * Zero hard dependency on Nuxt — works in any Vue 3 environment.
 */

import {
  type InjectionKey,
  type PropType,
  type Ref,
  type VNode,
  h,
  inject,
  onMounted,
  provide,
  ref,
  watch,
} from 'vue';

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

const BrivenAuthKey: InjectionKey<BrivenAuthClient> = Symbol('briven-auth');

// ─── Provider ──────────────────────────────────────────────────────────────

export interface BrivenAuthProviderProps {
  value: BrivenAuthClient;
}

export const BrivenAuthProvider = {
  name: 'BrivenAuthProvider',
  props: {
    value: { type: Object as PropType<BrivenAuthClient>, required: true },
  },
  setup(props: BrivenAuthProviderProps, { slots }: { slots: { default?: () => VNode[] } }) {
    provide(BrivenAuthKey, props.value);
    return () => (slots.default ? slots.default() : null);
  },
};

/** Throws when called outside a `<BrivenAuthProvider>`. */
export function useBrivenAuth(): BrivenAuthClient {
  const client = inject(BrivenAuthKey);
  if (!client) {
    throw new Error('useBrivenAuth must be called inside <BrivenAuthProvider>');
  }
  return client;
}

// ─── Composables ───────────────────────────────────────────────────────────

export interface UseSessionResult {
  session: Ref<SessionResponse | null>;
  isLoading: Ref<boolean>;
  refresh: () => Promise<void>;
}

export function useSession(): UseSessionResult {
  const client = useBrivenAuth();
  const session = ref<SessionResponse | null>(null);
  const isLoading = ref(true);

  const refresh = async () => {
    isLoading.value = true;
    session.value = await client.getSession();
    isLoading.value = false;
  };

  onMounted(() => {
    void refresh();
  });

  return { session, isLoading, refresh };
}

export interface UseUserResult {
  user: Ref<User | null>;
  isLoading: Ref<boolean>;
  refresh: () => Promise<void>;
}

export function useUser(): UseUserResult {
  const client = useBrivenAuth();
  const user = ref<User | null>(null);
  const isLoading = ref(true);

  const refresh = async () => {
    isLoading.value = true;
    user.value = await client.getUser();
    isLoading.value = false;
  };

  onMounted(() => {
    void refresh();
  });

  return { user, isLoading, refresh };
}

export interface UseUserMetadataResult {
  metadata: Ref<Record<string, unknown> | null>;
  isLoading: Ref<boolean>;
  refresh: () => Promise<void>;
  set: (patch: Record<string, unknown>) => Promise<void>;
}

export function useUserMetadata(): UseUserMetadataResult {
  const client = useBrivenAuth();
  const metadata = ref<Record<string, unknown> | null>(null);
  const isLoading = ref(true);

  const refresh = async () => {
    isLoading.value = true;
    const result = await client.user.getMetadata();
    metadata.value = result.ok ? result.publicMetadata : null;
    isLoading.value = false;
  };

  const set = async (patch: Record<string, unknown>) => {
    const result = await client.user.setMetadata(patch);
    if (result.ok) {
      metadata.value = result.publicMetadata;
    }
  };

  onMounted(() => {
    void refresh();
  });

  return { metadata, isLoading, refresh, set };
}

export interface UseUserEmailsResult {
  emails: Ref<UserEmail[] | null>;
  isLoading: Ref<boolean>;
  refresh: () => Promise<void>;
  add: (email: string) => Promise<void>;
  remove: (emailId: string) => Promise<void>;
}

export function useUserEmails(): UseUserEmailsResult {
  const client = useBrivenAuth();
  const emails = ref<UserEmail[] | null>(null);
  const isLoading = ref(true);

  const refresh = async () => {
    isLoading.value = true;
    const result = await client.user.listEmails();
    emails.value = result.ok ? result.emails : null;
    isLoading.value = false;
  };

  const add = async (email: string) => {
    const result = await client.user.addEmail(email);
    if (result.ok) await refresh();
  };

  const remove = async (emailId: string) => {
    const result = await client.user.removeEmail(emailId);
    if (result.ok) await refresh();
  };

  onMounted(() => {
    void refresh();
  });

  return { emails, isLoading, refresh, add, remove };
}

export interface UseActiveOrganizationResult {
  activeOrg: Ref<Org | null>;
  isLoading: Ref<boolean>;
  refresh: () => Promise<void>;
  setActive: (orgId: string) => Promise<void>;
}

export function useActiveOrganization(): UseActiveOrganizationResult {
  const client = useBrivenAuth();
  const activeOrg = ref<Org | null>(null);
  const isLoading = ref(true);

  const refresh = async () => {
    isLoading.value = true;
    const result = await client.organization.getActive();
    if (result.ok) activeOrg.value = result.data;
    isLoading.value = false;
  };

  const setActive = async (orgId: string) => {
    const result = await client.organization.setActive(orgId);
    if (result.ok) await refresh();
  };

  onMounted(() => {
    void refresh();
  });

  return { activeOrg, isLoading, refresh, setActive };
}

// ─── Shared helpers ────────────────────────────────────────────────────────

function useRedirectToHosted(auth: BrivenAuthClient, redirectTo?: string, locale?: string) {
  return (flow: 'sign-in' | 'sign-up' | 'magic-link') => {
    const url = auth.hostedPageURL(flow, redirectTo, locale);
    if (typeof window !== 'undefined') {
      window.location.assign(url);
    }
  };
}

// ─── BrivenSignIn ──────────────────────────────────────────────────────────

export interface BrivenSignInProps {
  providers?: ReadonlyArray<OAuthProvider>;
  showEmailPassword?: boolean;
  showMagicLink?: boolean;
  redirectTo?: string;
  onSuccess?: (result: { userId: string }) => void;
  className?: string;
  mode?: 'direct' | 'hosted';
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

export const BrivenSignIn = {
  name: 'BrivenSignIn',
  props: {
    providers: { type: Array as PropType<ReadonlyArray<OAuthProvider>>, default: () => DEFAULT_PROVIDERS },
    showEmailPassword: { type: Boolean, default: true },
    showMagicLink: { type: Boolean, default: true },
    redirectTo: { type: String, default: undefined },
    onSuccess: { type: Function as PropType<(result: { userId: string }) => void>, default: undefined },
    className: { type: String, default: undefined },
    mode: { type: String as PropType<'direct' | 'hosted'>, default: 'direct' },
    locale: { type: String, default: undefined },
  },
  setup(props: BrivenSignInProps) {
    const auth = useBrivenAuth();
    const email = ref('');
    const password = ref('');
    const magicEmail = ref('');
    const pending = ref<'password' | 'magic' | null>(null);
    const error = ref<string | null>(null);
    const magicSent = ref(false);

    const redirectToHosted = useRedirectToHosted(auth, props.redirectTo, props.locale);

    const handlePassword = async (e: Event) => {
      e.preventDefault();
      if (props.mode === 'hosted') {
        redirectToHosted('sign-in');
        return;
      }
      pending.value = 'password';
      error.value = null;
      const result: SignInResult = await auth.signIn.email({ email: email.value, password: password.value });
      if (result.ok) {
        props.onSuccess?.({ userId: result.userId });
      } else {
        error.value = result.message;
      }
      pending.value = null;
    };

    const handleMagic = async (e: Event) => {
      e.preventDefault();
      if (props.mode === 'hosted') {
        redirectToHosted('magic-link');
        return;
      }
      pending.value = 'magic';
      error.value = null;
      const result = await auth.signIn.magicLink({ email: magicEmail.value, redirectTo: props.redirectTo });
      if (result.ok) {
        magicSent.value = true;
      } else {
        error.value = result.message;
      }
      pending.value = null;
    };

    const handleOAuth = (provider: OAuthProvider) => {
      const { redirectUrl } = auth.signIn.social({ provider, redirectTo: props.redirectTo });
      if (typeof window !== 'undefined') {
        window.location.assign(redirectUrl);
      }
    };

    return () =>
      h(
        'div',
        { class: props.className ?? 'briven-auth-signin', 'data-briven-auth': 'signin' },
        [
          props.showEmailPassword
            ? h(
                'form',
                {
                  key: 'password',
                  onSubmit: handlePassword,
                  class: 'briven-auth-form',
                  'data-briven-auth-flow': 'password',
                },
                [
                  h('input', {
                    key: 'email',
                    type: 'email',
                    required: true,
                    placeholder: 'email',
                    value: email.value,
                    onInput: (e: Event) => { email.value = (e.target as HTMLInputElement).value; },
                    autocomplete: 'email',
                    class: 'briven-auth-input',
                  }),
                  h('input', {
                    key: 'password',
                    type: 'password',
                    required: true,
                    placeholder: 'password',
                    value: password.value,
                    onInput: (e: Event) => { password.value = (e.target as HTMLInputElement).value; },
                    autocomplete: 'current-password',
                    class: 'briven-auth-input',
                  }),
                  h(
                    'button',
                    {
                      key: 'submit',
                      type: 'submit',
                      disabled: pending.value !== null,
                      class: 'briven-auth-submit',
                    },
                    pending.value === 'password' ? 'signing in…' : 'sign in',
                  ),
                ],
              )
            : null,
          props.showMagicLink
            ? magicSent.value
              ? h('p', { key: 'magic-sent', class: 'briven-auth-message' }, 'check your inbox for the sign-in link.')
              : h(
                  'form',
                  {
                    key: 'magic',
                    onSubmit: handleMagic,
                    class: 'briven-auth-form',
                    'data-briven-auth-flow': 'magic-link',
                  },
                  [
                    h('input', {
                      key: 'email',
                      type: 'email',
                      required: true,
                      placeholder: 'email for magic link',
                      value: magicEmail.value,
                      onInput: (e: Event) => { magicEmail.value = (e.target as HTMLInputElement).value; },
                      autocomplete: 'email',
                      class: 'briven-auth-input',
                    }),
                    h(
                      'button',
                      {
                        key: 'submit',
                        type: 'submit',
                        disabled: pending.value !== null,
                        class: 'briven-auth-submit',
                      },
                      pending.value === 'magic' ? 'sending…' : 'send magic link',
                    ),
                  ],
                )
            : null,
          (props.providers ?? DEFAULT_PROVIDERS).length > 0
            ? h(
                'div',
                { key: 'oauth', class: 'briven-auth-oauth', 'data-briven-auth-flow': 'oauth' },
                (props.providers ?? DEFAULT_PROVIDERS).map((provider) =>
                  h(
                    'button',
                    {
                      key: provider,
                      type: 'button',
                      'data-briven-auth-provider': provider,
                      onClick: () => handleOAuth(provider),
                      class: 'briven-auth-oauth-button',
                    },
                    `continue with ${provider}`,
                  ),
                ),
              )
            : null,
          error.value
            ? h('p', { key: 'error', class: 'briven-auth-error', role: 'alert' }, error.value)
            : null,
        ],
      );
  },
};

// ─── BrivenSignUp ──────────────────────────────────────────────────────────

export interface BrivenSignUpProps {
  providers?: ReadonlyArray<OAuthProvider>;
  showEmailPassword?: boolean;
  redirectTo?: string;
  onSuccess?: (result: { userId: string }) => void;
  className?: string;
  mode?: 'direct' | 'hosted';
  locale?: string;
}

export const BrivenSignUp = {
  name: 'BrivenSignUp',
  props: {
    providers: { type: Array as PropType<ReadonlyArray<OAuthProvider>>, default: () => DEFAULT_PROVIDERS },
    showEmailPassword: { type: Boolean, default: true },
    redirectTo: { type: String, default: undefined },
    onSuccess: { type: Function as PropType<(result: { userId: string }) => void>, default: undefined },
    className: { type: String, default: undefined },
    mode: { type: String as PropType<'direct' | 'hosted'>, default: 'direct' },
    locale: { type: String, default: undefined },
  },
  setup(props: BrivenSignUpProps) {
    const auth = useBrivenAuth();
    const name = ref('');
    const email = ref('');
    const password = ref('');
    const pending = ref(false);
    const error = ref<string | null>(null);

    const redirectToHosted = useRedirectToHosted(auth, props.redirectTo, props.locale);

    const handleSubmit = async (e: Event) => {
      e.preventDefault();
      if (props.mode === 'hosted') {
        redirectToHosted('sign-up');
        return;
      }
      pending.value = true;
      error.value = null;
      const result: SignInResult = await auth.signUp.email({
        email: email.value,
        password: password.value,
        name: name.value || undefined,
      });
      if (result.ok) {
        props.onSuccess?.({ userId: result.userId });
      } else {
        error.value = result.message;
      }
      pending.value = false;
    };

    const handleOAuth = (provider: OAuthProvider) => {
      const { redirectUrl } = auth.signIn.social({ provider, redirectTo: props.redirectTo });
      if (typeof window !== 'undefined') {
        window.location.assign(redirectUrl);
      }
    };

    return () =>
      h(
        'div',
        { class: props.className ?? 'briven-auth-signup', 'data-briven-auth': 'signup' },
        [
          props.showEmailPassword
            ? h(
                'form',
                {
                  key: 'password',
                  onSubmit: handleSubmit,
                  class: 'briven-auth-form',
                  'data-briven-auth-flow': 'password',
                },
                [
                  h('input', {
                    key: 'name',
                    type: 'text',
                    placeholder: 'name (optional)',
                    value: name.value,
                    onInput: (e: Event) => { name.value = (e.target as HTMLInputElement).value; },
                    autocomplete: 'name',
                    class: 'briven-auth-input',
                  }),
                  h('input', {
                    key: 'email',
                    type: 'email',
                    required: true,
                    placeholder: 'email',
                    value: email.value,
                    onInput: (e: Event) => { email.value = (e.target as HTMLInputElement).value; },
                    autocomplete: 'email',
                    class: 'briven-auth-input',
                  }),
                  h('input', {
                    key: 'password',
                    type: 'password',
                    required: true,
                    placeholder: 'password',
                    value: password.value,
                    onInput: (e: Event) => { password.value = (e.target as HTMLInputElement).value; },
                    autocomplete: 'new-password',
                    class: 'briven-auth-input',
                  }),
                  h(
                    'button',
                    {
                      key: 'submit',
                      type: 'submit',
                      disabled: pending.value,
                      class: 'briven-auth-submit',
                    },
                    pending.value ? 'creating account…' : 'create account',
                  ),
                ],
              )
            : null,
          (props.providers ?? DEFAULT_PROVIDERS).length > 0
            ? h(
                'div',
                { key: 'oauth', class: 'briven-auth-oauth', 'data-briven-auth-flow': 'oauth' },
                (props.providers ?? DEFAULT_PROVIDERS).map((provider) =>
                  h(
                    'button',
                    {
                      key: provider,
                      type: 'button',
                      'data-briven-auth-provider': provider,
                      onClick: () => handleOAuth(provider),
                      class: 'briven-auth-oauth-button',
                    },
                    `continue with ${provider}`,
                  ),
                ),
              )
            : null,
          error.value
            ? h('p', { key: 'error', class: 'briven-auth-error', role: 'alert' }, error.value)
            : null,
        ],
      );
  },
};

// ─── UserButton ────────────────────────────────────────────────────────────

export interface UserButtonProps {
  className?: string;
  profileUrl?: string;
}

export const UserButton = {
  name: 'UserButton',
  props: {
    className: { type: String, default: undefined },
    profileUrl: { type: String, default: undefined },
  },
  setup(props: UserButtonProps) {
    const auth = useBrivenAuth();
    const { user, isLoading } = useUser();
    const open = ref(false);

    const handleSignOut = async () => {
      await auth.signOut();
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    };

    const handleProfile = () => {
      const url = props.profileUrl ?? auth.hostedPageURL('profile');
      if (typeof window !== 'undefined') {
        window.location.assign(url);
      }
    };

    return () => {
      if (isLoading.value || !user.value) return null;
      const label = user.value.name ?? user.value.email;
      return h(
        'div',
        { class: props.className ?? 'briven-auth-userbutton', 'data-briven-auth': 'userbutton' },
        [
          h(
            'button',
            {
              type: 'button',
              onClick: () => { open.value = !open.value; },
              class: 'briven-auth-userbutton-trigger',
            },
            label,
          ),
          open.value
            ? h(
                'div',
                { class: 'briven-auth-userbutton-dropdown', 'data-briven-auth-dropdown': 'open' },
                [
                  h(
                    'button',
                    { type: 'button', onClick: handleProfile, class: 'briven-auth-userbutton-item' },
                    'profile',
                  ),
                  h(
                    'button',
                    { type: 'button', onClick: handleSignOut, class: 'briven-auth-userbutton-item' },
                    'sign out',
                  ),
                ],
              )
            : null,
        ],
      );
    };
  },
};

// ─── UserProfile ───────────────────────────────────────────────────────────

export interface UserProfileProps {
  className?: string;
  onUpdate?: () => void;
}

export const UserProfile = {
  name: 'UserProfile',
  props: {
    className: { type: String, default: undefined },
    onUpdate: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props: UserProfileProps) {
    const auth = useBrivenAuth();
    const { user, refresh } = useUser();

    const name = ref('');
    const currentPassword = ref('');
    const newPassword = ref('');
    const updatePending = ref(false);
    const pwPending = ref(false);
    const deletePending = ref(false);
    const message = ref<string | null>(null);
    const error = ref<string | null>(null);

    watch(
      () => user.value?.name,
      (n) => { if (n) name.value = n; },
      { immediate: true },
    );

    const handleUpdate = async (e: Event) => {
      e.preventDefault();
      updatePending.value = true;
      error.value = null;
      message.value = null;
      const result = await auth.user.update({ name: name.value || undefined });
      if (result.ok) {
        message.value = 'profile updated';
        await refresh();
        props.onUpdate?.();
      } else {
        error.value = result.message;
      }
      updatePending.value = false;
    };

    const handleChangePassword = async (e: Event) => {
      e.preventDefault();
      pwPending.value = true;
      error.value = null;
      message.value = null;
      const result = await auth.user.changePassword({ currentPassword: currentPassword.value, newPassword: newPassword.value });
      if (result.ok) {
        message.value = 'password changed';
        currentPassword.value = '';
        newPassword.value = '';
      } else {
        error.value = result.message;
      }
      pwPending.value = false;
    };

    const handleDelete = async () => {
      if (typeof window !== 'undefined' && !window.confirm('Delete your account? This cannot be undone.')) return;
      deletePending.value = true;
      error.value = null;
      message.value = null;
      const result = await auth.user.delete();
      if (result.ok) {
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      } else {
        error.value = result.message;
        deletePending.value = false;
      }
    };

    return () => {
      if (!user.value) {
        return h('p', { class: 'briven-auth-message' }, 'not authenticated');
      }
      return h(
        'div',
        { class: props.className ?? 'briven-auth-userprofile', 'data-briven-auth': 'userprofile' },
        [
          h(
            'form',
            {
              key: 'profile',
              onSubmit: handleUpdate,
              class: 'briven-auth-form',
              'data-briven-auth-flow': 'profile-update',
            },
            [
              h('h3', { class: 'briven-auth-heading' }, 'profile'),
              h('input', {
                key: 'name',
                type: 'text',
                placeholder: 'name',
                value: name.value,
                onInput: (e: Event) => { name.value = (e.target as HTMLInputElement).value; },
                class: 'briven-auth-input',
              }),
              h('input', {
                key: 'email',
                type: 'email',
                disabled: true,
                value: user.value.email,
                class: 'briven-auth-input',
              }),
              h(
                'button',
                {
                  key: 'submit',
                  type: 'submit',
                  disabled: updatePending.value,
                  class: 'briven-auth-submit',
                },
                updatePending.value ? 'saving…' : 'save profile',
              ),
            ],
          ),
          h(
            'form',
            {
              key: 'password',
              onSubmit: handleChangePassword,
              class: 'briven-auth-form',
              'data-briven-auth-flow': 'change-password',
            },
            [
              h('h3', { class: 'briven-auth-heading' }, 'change password'),
              h('input', {
                key: 'current',
                type: 'password',
                required: true,
                placeholder: 'current password',
                value: currentPassword.value,
                onInput: (e: Event) => { currentPassword.value = (e.target as HTMLInputElement).value; },
                autocomplete: 'current-password',
                class: 'briven-auth-input',
              }),
              h('input', {
                key: 'new',
                type: 'password',
                required: true,
                placeholder: 'new password',
                value: newPassword.value,
                onInput: (e: Event) => { newPassword.value = (e.target as HTMLInputElement).value; },
                autocomplete: 'new-password',
                class: 'briven-auth-input',
              }),
              h(
                'button',
                {
                  key: 'submit',
                  type: 'submit',
                  disabled: pwPending.value,
                  class: 'briven-auth-submit',
                },
                pwPending.value ? 'changing…' : 'change password',
              ),
            ],
          ),
          h(
            'div',
            { key: 'danger', class: 'briven-auth-danger-zone', 'data-briven-auth-flow': 'delete-account' },
            [
              h('h3', { class: 'briven-auth-heading' }, 'danger zone'),
              h(
                'button',
                {
                  type: 'button',
                  onClick: handleDelete,
                  disabled: deletePending.value,
                  class: 'briven-auth-danger-button',
                },
                deletePending.value ? 'deleting…' : 'delete account',
              ),
            ],
          ),
          message.value ? h('p', { key: 'message', class: 'briven-auth-message' }, message.value) : null,
          error.value ? h('p', { key: 'error', class: 'briven-auth-error', role: 'alert' }, error.value) : null,
        ],
      );
    };
  },
};

// ─── SessionManager ────────────────────────────────────────────────────────

export interface SessionManagerProps {
  className?: string;
}

export const SessionManager = {
  name: 'SessionManager',
  props: {
    className: { type: String, default: undefined },
  },
  setup(props: SessionManagerProps) {
    const auth = useBrivenAuth();
    const sessions = ref<ClientSession[]>([]);
    const isLoading = ref(true);
    const error = ref<string | null>(null);

    const load = async () => {
      isLoading.value = true;
      error.value = null;
      const result = await auth.sessions.list();
      if (result.ok) {
        sessions.value = result.sessions;
      } else {
        error.value = result.message;
      }
      isLoading.value = false;
    };

    onMounted(() => {
      void load();
    });

    const handleRevoke = async (sessionId: string) => {
      const result = await auth.sessions.revoke(sessionId);
      if (result.ok) {
        await load();
      } else {
        error.value = result.message;
      }
    };

    return () =>
      h(
        'div',
        { class: props.className ?? 'briven-auth-sessionmanager', 'data-briven-auth': 'sessionmanager' },
        [
          h('h3', { class: 'briven-auth-heading' }, 'active sessions'),
          isLoading.value
            ? h('p', { class: 'briven-auth-message' }, 'loading…')
            : sessions.value.length === 0
              ? h('p', { class: 'briven-auth-message' }, 'no active sessions')
              : h(
                  'ul',
                  { class: 'briven-auth-session-list' },
                  sessions.value.map((s) =>
                    h(
                      'li',
                      { key: s.id, class: 'briven-auth-session-item' },
                      [
                        h('span', { class: 'briven-auth-session-info' }, s.userAgent ?? 'unknown device'),
                        h(
                          'button',
                          {
                            type: 'button',
                            onClick: () => handleRevoke(s.id),
                            class: 'briven-auth-session-revoke',
                          },
                          'revoke',
                        ),
                      ],
                    ),
                  ),
                ),
          error.value ? h('p', { class: 'briven-auth-error', role: 'alert' }, error.value) : null,
        ],
      );
  },
};

// ─── OrganizationSwitcher ─────────────────────────────────────────────────

export interface OrganizationSwitcherProps {
  className?: string;
}

export const OrganizationSwitcher = {
  name: 'OrganizationSwitcher',
  props: {
    className: { type: String, default: undefined },
  },
  setup(props: OrganizationSwitcherProps) {
    const auth = useBrivenAuth();
    const { activeOrg, setActive } = useActiveOrganization();
    const orgs = ref<Org[]>([]);
    const isLoading = ref(true);
    const open = ref(false);
    const showCreate = ref(false);

    const load = async () => {
      isLoading.value = true;
      const result = await auth.organization.list();
      if (result.ok) orgs.value = result.data;
      isLoading.value = false;
    };

    onMounted(() => {
      void load();
    });

    const handleCreate = async (name: string, slug: string) => {
      const result = await auth.organization.create({ name, slug });
      if (result.ok) {
        showCreate.value = false;
        await load();
      }
      return result;
    };

    const handleSwitch = async (orgId: string) => {
      await setActive(orgId);
      open.value = false;
    };

    return () => {
      if (isLoading.value) return null;

      if (orgs.value.length === 0) {
        return h(
          'button',
          { type: 'button', onClick: () => { showCreate.value = true; }, class: props.className ?? 'briven-auth-org-switcher' },
          'create organization',
        );
      }
      return h(
        'div',
        { class: props.className ?? 'briven-auth-org-switcher', 'data-briven-auth': 'org-switcher' },
        [
          h(
            'button',
            { type: 'button', onClick: () => { open.value = !open.value; }, class: 'briven-auth-org-switcher-trigger' },
            activeOrg.value?.name ?? 'switch organization',
          ),
          open.value
            ? h(
                'div',
                { class: 'briven-auth-org-switcher-dropdown' },
                [
                  ...orgs.value.map((org) =>
                    h(
                      'button',
                      {
                        key: org.id,
                        type: 'button',
                        onClick: () => handleSwitch(org.id),
                        class:
                          org.id === activeOrg.value?.id
                            ? 'briven-auth-org-switcher-item briven-auth-org-switcher-item-active'
                            : 'briven-auth-org-switcher-item',
                      },
                      org.name,
                    ),
                  ),
                  h(
                    'button',
                    { type: 'button', onClick: () => { showCreate.value = true; }, class: 'briven-auth-org-switcher-create' },
                    '+ create organization',
                  ),
                ],
              )
            : null,
          showCreate.value
            ? h(CreateOrganization, {
                key: 'create',
                onCreate: handleCreate,
                onCancel: () => { showCreate.value = false; },
              })
            : null,
        ],
      );
    };
  },
};

// ─── CreateOrganization ───────────────────────────────────────────────────

export interface CreateOrganizationProps {
  onCreate(name: string, slug: string): Promise<unknown>;
  onCancel(): void;
}

export const CreateOrganization = {
  name: 'CreateOrganization',
  props: {
    onCreate: { type: Function as PropType<(name: string, slug: string) => Promise<unknown>>, required: true },
    onCancel: { type: Function as PropType<() => void>, required: true },
  },
  setup(props: CreateOrganizationProps) {
    const name = ref('');
    const slug = ref('');
    const pending = ref(false);
    const error = ref<string | null>(null);

    const handleSubmit = async (e: Event) => {
      e.preventDefault();
      pending.value = true;
      error.value = null;
      const result = await props.onCreate(name.value, slug.value);
      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        error.value = (result as { message?: string }).message ?? 'create failed';
      }
      pending.value = false;
    };

    return () =>
      h(
        'div',
        { class: 'briven-auth-create-org' },
        [
          h('h3', { class: 'briven-auth-heading' }, 'create organization'),
          h(
            'form',
            { class: 'briven-auth-form', onSubmit: handleSubmit },
            [
              h('input', {
                type: 'text',
                required: true,
                placeholder: 'organization name',
                value: name.value,
                onInput: (e: Event) => { name.value = (e.target as HTMLInputElement).value; },
                class: 'briven-auth-input',
              }),
              h('input', {
                type: 'text',
                required: true,
                placeholder: 'slug (lowercase-hyphens)',
                value: slug.value,
                onInput: (e: Event) => { slug.value = (e.target as HTMLInputElement).value; },
                pattern: '[a-z0-9-]{1,64}',
                class: 'briven-auth-input',
              }),
              h(
                'button',
                { type: 'submit', disabled: pending.value, class: 'briven-auth-submit' },
                pending.value ? 'creating…' : 'create',
              ),
            ],
          ),
          error.value ? h('p', { class: 'briven-auth-error', role: 'alert' }, error.value) : null,
          h(
            'button',
            { type: 'button', onClick: props.onCancel, class: 'briven-auth-cancel' },
            'cancel',
          ),
        ],
      );
  },
};

// ─── OrganizationProfile ──────────────────────────────────────────────────

export interface OrganizationProfileProps {
  orgId: string;
  className?: string;
}

export const OrganizationProfile = {
  name: 'OrganizationProfile',
  props: {
    orgId: { type: String, required: true },
    className: { type: String, default: undefined },
  },
  setup(props: OrganizationProfileProps) {
    const auth = useBrivenAuth();
    const members = ref<OrgMember[]>([]);
    const invites = ref<OrgInvite[]>([]);
    const inviteEmail = ref('');
    const isLoading = ref(true);
    const error = ref<string | null>(null);

    const load = async () => {
      isLoading.value = true;
      const [mResult, iResult] = await Promise.all([
        auth.organization.listMembers(props.orgId),
        auth.organization.listInvites(props.orgId),
      ]);
      if (mResult.ok) members.value = mResult.data;
      if (iResult.ok) invites.value = iResult.data;
      isLoading.value = false;
    };

    onMounted(() => {
      void load();
    });

    const handleInvite = async (e: Event) => {
      e.preventDefault();
      error.value = null;
      const result = await auth.organization.createInvite(props.orgId, { email: inviteEmail.value });
      if (result.ok) {
        inviteEmail.value = '';
        await load();
      } else {
        error.value = result.message;
      }
    };

    const handleRemove = async (userId: string) => {
      const result = await auth.organization.removeMember(props.orgId, userId);
      if (result.ok) await load();
      else error.value = result.message;
    };

    return () =>
      h(
        'div',
        { class: props.className ?? 'briven-auth-org-profile', 'data-briven-auth': 'org-profile' },
        [
          h('h3', { class: 'briven-auth-heading' }, 'members'),
          isLoading.value
            ? h('p', { class: 'briven-auth-message' }, 'loading…')
            : h(
                'ul',
                { class: 'briven-auth-member-list' },
                members.value.map((m) =>
                  h(
                    'li',
                    { key: m.id, class: 'briven-auth-member-item' },
                    [
                      h('span', { class: 'briven-auth-member-role' }, m.role),
                      h('span', { class: 'briven-auth-member-id' }, m.userId),
                      m.role !== 'owner'
                        ? h(
                            'button',
                            {
                              type: 'button',
                              onClick: () => handleRemove(m.userId),
                              class: 'briven-auth-member-remove',
                            },
                            'remove',
                          )
                        : null,
                    ],
                  ),
                ),
              ),
          h('h3', { class: 'briven-auth-heading' }, 'invites'),
          h(
            'form',
            { class: 'briven-auth-form', onSubmit: handleInvite },
            [
              h('input', {
                type: 'email',
                required: true,
                placeholder: 'email to invite',
                value: inviteEmail.value,
                onInput: (e: Event) => { inviteEmail.value = (e.target as HTMLInputElement).value; },
                class: 'briven-auth-input',
              }),
              h('button', { type: 'submit', class: 'briven-auth-submit' }, 'send invite'),
            ],
          ),
          invites.value.length > 0
            ? h(
                'ul',
                { class: 'briven-auth-invite-list' },
                invites.value.map((i) => h('li', { key: i.id, class: 'briven-auth-invite-item' }, [`${i.email} · ${i.role}`])),
              )
            : null,
          error.value ? h('p', { class: 'briven-auth-error', role: 'alert' }, error.value) : null,
        ],
      );
  },
};

// ─── TwoFactorSetup ───────────────────────────────────────────────────────

export interface TwoFactorSetupProps {
  className?: string;
  onEnabled?: () => void;
}

export const TwoFactorSetup = {
  name: 'TwoFactorSetup',
  props: {
    className: { type: String, default: undefined },
    onEnabled: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props: TwoFactorSetupProps) {
    const auth = useBrivenAuth();
    const step = ref<'idle' | 'enabling' | 'verify'>('idle');
    const code = ref('');
    const backupCodes = ref<string[]>([]);
    const error = ref<string | null>(null);

    const handleEnable = async () => {
      step.value = 'enabling';
      error.value = null;
      const result = await auth.twoFactor.enable();
      if (result.ok) {
        step.value = 'verify';
      } else {
        error.value = result.message;
        step.value = 'idle';
      }
    };

    const handleVerify = async (e: Event) => {
      e.preventDefault();
      error.value = null;
      const result = await auth.twoFactor.verify(code.value);
      if (result.ok) {
        const codes = await auth.twoFactor.generateBackupCodes();
        if (codes.ok) backupCodes.value = codes.codes;
        props.onEnabled?.();
      } else {
        error.value = result.message;
      }
    };

    return () =>
      h(
        'div',
        { class: props.className ?? 'briven-auth-2fa-setup' },
        [
          step.value === 'idle'
            ? h(
                'button',
                { type: 'button', onClick: handleEnable, class: 'briven-auth-submit' },
                'enable two-factor',
              )
            : null,
          step.value === 'verify'
            ? h(
                'form',
                { onSubmit: handleVerify, class: 'briven-auth-form' },
                [
                  h('p', { class: 'briven-auth-message' }, 'enter the 6-digit code from your authenticator app'),
                  h('input', {
                    type: 'text',
                    required: true,
                    placeholder: '6-digit code',
                    value: code.value,
                    onInput: (e: Event) => { code.value = (e.target as HTMLInputElement).value; },
                    pattern: '\\d{6}',
                    maxlength: 6,
                    class: 'briven-auth-input',
                  }),
                  h('button', { type: 'submit', class: 'briven-auth-submit' }, 'verify'),
                ],
              )
            : null,
          backupCodes.value.length > 0
            ? h(
                'div',
                { class: 'briven-auth-backup-codes' },
                [
                  h('p', { class: 'briven-auth-message' }, 'save these backup codes:'),
                  h('ul', {}, backupCodes.value.map((c) => h('li', { key: c, class: 'briven-auth-code' }, c))),
                ],
              )
            : null,
          error.value ? h('p', { class: 'briven-auth-error', role: 'alert' }, error.value) : null,
        ],
      );
  },
};

// ─── PasskeyButton ────────────────────────────────────────────────────────

export interface PasskeyButtonProps {
  className?: string;
  mode?: 'register' | 'sign-in';
}

export const PasskeyButton = {
  name: 'PasskeyButton',
  props: {
    className: { type: String, default: undefined },
    mode: { type: String as PropType<'register' | 'sign-in'>, default: 'register' },
  },
  setup(props: PasskeyButtonProps) {
    const auth = useBrivenAuth();
    const pending = ref(false);
    const error = ref<string | null>(null);

    const handleClick = async () => {
      pending.value = true;
      error.value = null;
      if (props.mode === 'register') {
        const result = await auth.passkey.register();
        if (!result.ok) error.value = result.message;
      } else {
        const result = await auth.passkey.signIn();
        if (!result.ok) error.value = result.message;
      }
      pending.value = false;
    };

    return () =>
      h(
        'div',
        { class: props.className ?? 'briven-auth-passkey' },
        [
          h(
            'button',
            {
              type: 'button',
              onClick: handleClick,
              disabled: pending.value,
              class: 'briven-auth-passkey-button',
            },
            props.mode === 'register' ? 'register passkey' : 'sign in with passkey',
          ),
          error.value ? h('p', { class: 'briven-auth-error', role: 'alert' }, error.value) : null,
        ],
      );
  },
};

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
