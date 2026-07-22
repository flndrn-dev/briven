/**
 * briven-engine recipe catalog (documentation + status only).
 * Implementation is Doltgres-native — not SuperTokens Core recipes at runtime.
 */

export type AuthCoreRecipePhase = 2 | 3 | 4 | 5 | 6;

export const BRIVEN_ENGINE_RECIPE_CATALOG = [
  { id: 'session', phase: 2, title: 'Sessions', sms: false },
  { id: 'emailpassword', phase: 3, title: 'Email + password', sms: false },
  { id: 'passwordless', phase: 3, title: 'Passwordless (email + SMS)', sms: true },
  { id: 'thirdparty', phase: 3, title: 'Social / third-party', sms: false },
  { id: 'emailverification', phase: 3, title: 'Email verification', sms: false },
  { id: 'webauthn', phase: 3, title: 'Passkeys (WebAuthn)', sms: false },
  { id: 'multifactorauth', phase: 4, title: 'Multi-factor auth', sms: true },
  { id: 'totp', phase: 4, title: 'TOTP (authenticator app)', sms: false },
  { id: 'userroles', phase: 4, title: 'Roles + permissions', sms: false },
  { id: 'usermetadata', phase: 5, title: 'User metadata', sms: false },
  { id: 'accountlinking', phase: 5, title: 'Account linking', sms: false },
  { id: 'dashboard', phase: 5, title: 'Engine dashboard API', sms: false },
  { id: 'multitenancy', phase: 6, title: 'Multitenancy (projects)', sms: false },
  { id: 'oauth2provider', phase: 6, title: 'OAuth2 / IdP', sms: false },
  { id: 'openid', phase: 6, title: 'OpenID', sms: false },
  { id: 'jwt', phase: 6, title: 'JWT', sms: false },
  { id: 'saml', phase: 6, title: 'SAML', sms: false },
] as const;

export function getRecipePhase(): AuthCoreRecipePhase {
  const raw = process.env.BRIVEN_AUTH_CORE_RECIPE_PHASE;
  if (raw === '2' || raw === '3' || raw === '4' || raw === '5' || raw === '6') {
    return Number(raw) as AuthCoreRecipePhase;
  }
  return 3;
}

/** No SuperTokens recipe list — Doltgres-native engine. */
export async function buildRecipeList(): Promise<{
  recipes: never[];
  phase: AuthCoreRecipePhase;
  names: string[];
  engine: 'briven-engine';
  smsIncluded: boolean;
  storage: 'doltgres';
}> {
  const phase = getRecipePhase();
  const names = BRIVEN_ENGINE_RECIPE_CATALOG.filter((r) => r.phase <= phase).map(
    (r) => r.id,
  );
  return {
    recipes: [],
    phase,
    names,
    engine: 'briven-engine',
    smsIncluded: names.includes('passwordless'),
    storage: 'doltgres',
  };
}
