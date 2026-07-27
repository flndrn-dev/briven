/**
 * briven-engine social provider catalog (Phase 3).
 *
 * Built-in third-party ids the product supports. Customer secrets are stored
 * per project (later UI); empty providers list at boot until configured.
 *
 * Product brand: briven-engine only.
 */

export type BrivenSocialProviderId =
  | 'konnos'
  | 'google'
  | 'github'
  | 'apple'
  | 'discord'
  | 'microsoft'
  | 'facebook'
  | 'twitter'
  | 'linkedin'
  | 'gitlab'
  | 'bitbucket'
  | 'spotify';

export type BrivenSocialProviderMeta = {
  thirdPartyId: BrivenSocialProviderId;
  name: string;
  engine: 'briven-engine';
  help: string;
  builtIn: true;
  /** Shown under OAuth setup (callback / webhook URL pattern). */
  callbackHint?: string;
};

export const BRIVEN_ENGINE_SOCIAL_CATALOG: readonly BrivenSocialProviderMeta[] = [
  {
    thirdPartyId: 'konnos',
    name: 'Konnos',
    engine: 'briven-engine',
    help: '',
    builtIn: true,
    // SuperTokens: redirect_uri = OAuth callback path on the app (not post-login /dashboard).
    callbackHint: 'https://YOUR_APP_ORIGIN/auth/callback',
  },
  {
    thirdPartyId: 'google',
    name: 'Google',
    engine: 'briven-engine',
    help: 'Google Cloud Console → APIs & Services → Credentials',
    builtIn: true,
    callbackHint:
      'Authorized redirect: {apiOrigin}/v1/auth-core/oauth/google/callback',
  },
  {
    thirdPartyId: 'github',
    name: 'GitHub',
    engine: 'briven-engine',
    help: 'GitHub → Settings → Developer settings → OAuth Apps',
    builtIn: true,
    callbackHint:
      'Authorization callback URL: {apiOrigin}/v1/auth-core/oauth/github/callback',
  },
  {
    thirdPartyId: 'apple',
    name: 'Apple',
    engine: 'briven-engine',
    help: 'Apple Developer → Certificates, Identifiers & Profiles (paste client secret JWT)',
    builtIn: true,
    callbackHint:
      'Return URL: {apiOrigin}/v1/auth-core/oauth/apple/callback',
  },
  {
    thirdPartyId: 'discord',
    name: 'Discord',
    engine: 'briven-engine',
    help: 'Discord Developer Portal → Applications → OAuth2',
    builtIn: true,
    callbackHint:
      'Redirects: {apiOrigin}/v1/auth-core/oauth/discord/callback',
  },
  {
    thirdPartyId: 'microsoft',
    name: 'Microsoft',
    engine: 'briven-engine',
    help: 'Azure Portal → Entra ID → App registrations',
    builtIn: true,
    callbackHint:
      'Redirect URI: {apiOrigin}/v1/auth-core/oauth/microsoft/callback',
  },
  {
    thirdPartyId: 'facebook',
    name: 'Facebook',
    engine: 'briven-engine',
    help: 'Meta for Developers → My Apps → Facebook Login',
    builtIn: true,
    callbackHint:
      'Valid OAuth Redirect URIs: {apiOrigin}/v1/auth-core/oauth/facebook/callback',
  },
  {
    thirdPartyId: 'twitter',
    name: 'X (Twitter)',
    engine: 'briven-engine',
    help: 'X Developer Portal → Projects & Apps → OAuth 2.0',
    builtIn: true,
    callbackHint:
      'Callback URI: {apiOrigin}/v1/auth-core/oauth/twitter/callback',
  },
  {
    thirdPartyId: 'linkedin',
    name: 'LinkedIn',
    engine: 'briven-engine',
    help: 'LinkedIn Developers → My Apps → Auth',
    builtIn: true,
    callbackHint:
      'Redirect URL: {apiOrigin}/v1/auth-core/oauth/linkedin/callback',
  },
  {
    thirdPartyId: 'gitlab',
    name: 'GitLab',
    engine: 'briven-engine',
    help: 'GitLab → Preferences → Applications',
    builtIn: true,
    callbackHint:
      'Redirect URI: {apiOrigin}/v1/auth-core/oauth/gitlab/callback',
  },
  {
    thirdPartyId: 'bitbucket',
    name: 'Bitbucket',
    engine: 'briven-engine',
    help: 'Bitbucket → Workspace settings → OAuth consumers',
    builtIn: true,
    callbackHint:
      'Callback URL: {apiOrigin}/v1/auth-core/oauth/bitbucket/callback',
  },
  {
    thirdPartyId: 'spotify',
    name: 'Spotify',
    engine: 'briven-engine',
    help: 'Spotify Developer Dashboard → Redirect URIs',
    builtIn: true,
    callbackHint:
      'Redirect URIs: {apiOrigin}/v1/auth-core/oauth/spotify/callback',
  },
] as const;

export type ProjectProviderSecrets = {
  thirdPartyId: BrivenSocialProviderId;
  clientId: string;
  clientSecret: string;
  additionalConfig?: Record<string, string>;
};

/**
 * Map stored secrets → ThirdParty.init providers array entries.
 * Returns empty when no secrets configured (sign-in methods still work via email/password/SMS/passkey).
 */
export function buildThirdPartyProvidersFromSecrets(
  secrets: ProjectProviderSecrets[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ThirdPartyProviders: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  const out: unknown[] = [];
  for (const s of secrets) {
    if (!s.clientId || !s.clientSecret) continue;
    const clients = [{ clientId: s.clientId, clientSecret: s.clientSecret }];
    switch (s.thirdPartyId) {
      case 'google':
        out.push(ThirdPartyProviders.Google({ clients }));
        break;
      case 'github':
        out.push(ThirdPartyProviders.Github({ clients }));
        break;
      case 'apple':
        out.push(
          ThirdPartyProviders.Apple({
            clients: [
              {
                clientId: s.clientId,
                clientSecret: {
                  keyId: s.additionalConfig?.keyId ?? '',
                  privateKey: s.clientSecret,
                  teamId: s.additionalConfig?.teamId ?? '',
                },
                additionalConfig: s.additionalConfig,
              },
            ],
          }),
        );
        break;
      case 'discord':
        out.push(ThirdPartyProviders.Discord({ clients }));
        break;
      case 'microsoft':
        out.push(
          ThirdPartyProviders.Microsoft({
            clients,
            // directoryId optional
          }),
        );
        break;
      case 'facebook':
        out.push(ThirdPartyProviders.Facebook({ clients }));
        break;
      case 'linkedin':
        out.push(ThirdPartyProviders.LinkedIn({ clients }));
        break;
      case 'gitlab':
        out.push(ThirdPartyProviders.Gitlab({ clients }));
        break;
      case 'bitbucket':
        out.push(ThirdPartyProviders.Bitbucket({ clients }));
        break;
      case 'spotify':
        out.push(ThirdPartyProviders.Spotify({ clients }));
        break;
      case 'twitter':
        // X/Twitter provider name varies by SDK version
        if (typeof ThirdPartyProviders.Twitter === 'function') {
          out.push(ThirdPartyProviders.Twitter({ clients }));
        }
        break;
      case 'konnos':
        // Custom OIDC / generic — wired in FDI via project secrets + issuer
        break;
      default:
        break;
    }
  }
  return out;
}
