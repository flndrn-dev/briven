# Doltgres - knowledge base
 



# Briven Auth rebuild — SuperTokens knowledge base

**Purpose:** Library cabinet for LLM agents building **new Briven Auth**.
These are **reference docs from SuperTokens** — borrow good product/architecture ideas.
Briven Auth stays **Briven-branded**, multi-tenant on **Briven Doltgres**, not a raw SuperTokens install.

**Date filed:** 2026-07-22
**URL count:** 492 unique

## How agents should use this

### HARD RULE (flndrn, 2026-07-26 — never break)

**Before any Auth change** (magic link, OTP, OAuth/Konnos, sessions, MFA, passkeys, FDI, IdP, SSO, providers, secrets, allowed domains, enable/disable Auth, or any code under Auth surfaces):

1. You **must open this file first**.
2. You **must open the matching SuperTokens section/URL** below for that feature.
3. You **must not guess** login behavior. SuperTokens is the product map; Briven implements Briven-branded on Doltgres.
4. State in one plain sentence what the SuperTokens/KB behavior is, then code.

Also written into project root **`CLAUDE.md`**. Skipping this step is a rule violation, not a style preference.

### Always

1. Prefer Briven product rules (Doltgres-first, project isolation, `pk_briven_auth_`, no inventing Clerk).
2. For **any database / Doltgres / Postgres-wire problem**, open the **Doltgres / Dolt official knowledge base** section at the bottom of this file first (URLs from `AI_DOCS/dolt-reference/`). Also read `AI_DOCS/dolt-reference/00-doltgres-truth.md`.
3. When stuck on a login feature (sessions, passwordless, MFA, etc.), open the matching SuperTokens section below **and** keep Doltgres constraints from the Doltgres section.
4. Translate Supabase/MySQL examples to **Briven Doltgres** using official Doltgres docs — do not invent.
5. Do not paste SuperTokens branding into Briven UI — yellow Auth sub-dashboard, Briven styling.
6. **Never** abandon SuperTokens Core or change Auth architecture after one SQL error without reading Doltgres docs and **notifying flndrn**.

## Quickstart

- https://supertokens.com/docs/quickstart/introduction
- https://supertokens.com/docs/quickstart/frontend-setup
- https://supertokens.com/docs/quickstart/backend-setup
- https://supertokens.com/docs/quickstart/next-steps
- https://supertokens.com/docs/quickstart/example-applications
- https://supertokens.com/docs/quickstart/build-with-ai-tools

## Quickstart integrations

- https://supertokens.com/docs/quickstart/integrations/overview
- https://supertokens.com/docs/quickstart/integrations/aws-lambda/quickstart-guide
- https://supertokens.com/docs/quickstart/integrations/aws-lambda/session-verification
- https://supertokens.com/docs/quickstart/integrations/aws-lambda/appsync-integration
- https://supertokens.com/docs/quickstart/integrations/graphql
- https://supertokens.com/docs/quickstart/integrations/hasura
- https://supertokens.com/docs/quickstart/integrations/nestjs
- https://supertokens.com/docs/quickstart/integrations/netlify
- https://supertokens.com/docs/quickstart/integrations/nextjs/app-directory/about
- https://supertokens.com/docs/quickstart/integrations/nextjs/app-directory/init
- https://supertokens.com/docs/quickstart/integrations/nextjs/app-directory/setting-up-frontend
- https://supertokens.com/docs/quickstart/integrations/nextjs/app-directory/setting-up-backend
- https://supertokens.com/docs/quickstart/integrations/nextjs/app-directory/protecting-route
- https://supertokens.com/docs/quickstart/integrations/nextjs/app-directory/protecting-backend/session-verification-session-guard
- https://supertokens.com/docs/quickstart/integrations/nextjs/app-directory/protecting-backend/session-verification-middleware
- https://supertokens.com/docs/quickstart/integrations/nextjs/app-directory/server-components-requests
- https://supertokens.com/docs/quickstart/integrations/nextjs/app-directory/next-steps
- https://supertokens.com/docs/quickstart/integrations/nextjs/pages-directory/about
- https://supertokens.com/docs/quickstart/integrations/nextjs/pages-directory/init
- https://supertokens.com/docs/quickstart/integrations/nextjs/pages-directory/setting-up-frontend
- https://supertokens.com/docs/quickstart/integrations/nextjs/pages-directory/setting-up-backend
- https://supertokens.com/docs/quickstart/integrations/nextjs/pages-directory/protecting-route
- https://supertokens.com/docs/quickstart/integrations/nextjs/pages-directory/protecting-backend/in-api
- https://supertokens.com/docs/quickstart/integrations/nextjs/pages-directory/protecting-backend/in-ssr
- https://supertokens.com/docs/quickstart/integrations/nextjs/pages-directory/next-steps
- https://supertokens.com/docs/quickstart/integrations/supabase(Needs — *Map to Briven Doltgres (not Supabase) when implementing.*
- https://supertokens.com/docs/quickstart/integrations/vercel

## Authentication recipes

- https://supertokens.com/docs/authentication/overview
- https://supertokens.com/docs/authentication/email-password/introduction
- https://supertokens.com/docs/authentication/email-password/customize-the-sign-in-form
- https://supertokens.com/docs/authentication/email-password/customize-the-sign-up-form
- https://supertokens.com/docs/authentication/email-password/hooks-and-overrides
- https://supertokens.com/docs/authentication/email-password/password-hashing
- https://supertokens.com/docs/authentication/email-password/implement-username-login
- https://supertokens.com/docs/authentication/email-password/password-reset
- https://supertokens.com/docs/authentication/email-password/disable-signup
- https://supertokens.com/docs/authentication/email-password/password-managers
- https://supertokens.com/docs/authentication/passwordless/introduction
- https://supertokens.com/docs/authentication/passwordless/initial-setup
- https://supertokens.com/docs/authentication/passwordless/customize-the-magic-link
- https://supertokens.com/docs/authentication/passwordless/customize-the-otp
- https://supertokens.com/docs/authentication/passwordless/hooks-and-overrides
- https://supertokens.com/docs/authentication/passwordless/configure-email-and-sms-behavior
- https://supertokens.com/docs/authentication/passwordless/invite-link-flow
- https://supertokens.com/docs/authentication/passwordless/allow-list-flow
- https://supertokens.com/docs/authentication/social/introduction
- https://supertokens.com/docs/authentication/social/initial-setup
- https://supertokens.com/docs/authentication/social/built-in-providers-config
- https://supertokens.com/docs/authentication/social/custom-providers
- https://supertokens.com/docs/authentication/social/hooks-and-overrides
- https://supertokens.com/docs/authentication/social/add-multiple-clients-for-the-same-provider
- https://supertokens.com/docs/authentication/social/custom-invite-flow
- https://supertokens.com/docs/authentication/enterprise/introduction
- https://supertokens.com/docs/authentication/enterprise/important-concepts
- https://supertokens.com/docs/authentication/enterprise/initial-setup
- https://supertokens.com/docs/authentication/enterprise/common-domain-login
- https://supertokens.com/docs/authentication/enterprise/subdomain-login
- https://supertokens.com/docs/authentication/enterprise/tenant-discovery
- https://supertokens.com/docs/authentication/enterprise/manage-tenants
- https://supertokens.com/docs/authentication/enterprise/tenant-management-plugin
- https://supertokens.com/docs/authentication/enterprise/manage-apps
- https://supertokens.com/docs/authentication/enterprise/saml
- https://supertokens.com/docs/authentication/enterprise/legacy-saml
- https://supertokens.com/docs/authentication/unified-login/introduction
- https://supertokens.com/docs/authentication/unified-login/oauth2-basics
- https://supertokens.com/docs/authentication/unified-login/quickstart-guides/multiple-frontends-with-a-single-backend
- https://supertokens.com/docs/authentication/unified-login/quickstart-guides/multiple-frontends-with-separate-backends
- https://supertokens.com/docs/authentication/unified-login/quickstart-guides/reuse-website-login
- https://supertokens.com/docs/authentication/unified-login/work-with-scopes
- https://supertokens.com/docs/authentication/unified-login/verify-tokens
- https://supertokens.com/docs/authentication/unified-login/add-custom-claims-in-tokens
- https://supertokens.com/docs/authentication/m2m/introduction
- https://supertokens.com/docs/authentication/m2m/client-credentials
- https://supertokens.com/docs/authentication/m2m/legacy-flow
- https://supertokens.com/docs/authentication/passkeys/introduction
- https://supertokens.com/docs/authentication/passkeys/important-concepts
- https://supertokens.com/docs/authentication/passkeys/initial-setup
- https://supertokens.com/docs/authentication/passkeys/customization
- https://supertokens.com/docs/authentication/ai-authentication

## Additional verification (sessions, MFA, roles, captcha)

- https://supertokens.com/docs/additional-verification/session-verification/protect-api-routes
- https://supertokens.com/docs/additional-verification/session-verification/protect-frontend-routes
- https://supertokens.com/docs/additional-verification/session-verification/ssr
- https://supertokens.com/docs/additional-verification/session-verification/with-websocket
- https://supertokens.com/docs/additional-verification/session-verification/claim-validation
- https://supertokens.com/docs/additional-verification/mfa/introduction
- https://supertokens.com/docs/additional-verification/mfa/important-concepts
- https://supertokens.com/docs/additional-verification/mfa/initial-setup
- https://supertokens.com/docs/additional-verification/mfa/totp/totp-for-all-users
- https://supertokens.com/docs/additional-verification/mfa/totp/totp-for-opt-in-users
- https://supertokens.com/docs/additional-verification/mfa/email-sms-otp/otp-for-all-users
- https://supertokens.com/docs/additional-verification/mfa/email-sms-otp/otp-for-opt-in-users
- https://supertokens.com/docs/additional-verification/mfa/webauthn-setup
- https://supertokens.com/docs/additional-verification/mfa/backup-codes
- https://supertokens.com/docs/additional-verification/mfa/step-up-auth
- https://supertokens.com/docs/additional-verification/mfa/embed-the-prebuilt-ui
- https://supertokens.com/docs/additional-verification/mfa/protect-routes
- https://supertokens.com/docs/additional-verification/mfa/hooks-and-overrides
- https://supertokens.com/docs/additional-verification/mfa/migration/legacy-to-new
- https://supertokens.com/docs/additional-verification/mfa/migration/old-sdk-to-new
- https://supertokens.com/docs/additional-verification/mfa/legacy-mfa/legacy-vs-new
- https://supertokens.com/docs/additional-verification/mfa/legacy-mfa/how-it-works
- https://supertokens.com/docs/additional-verification/mfa/legacy-mfa/backend-setup/first-factor
- https://supertokens.com/docs/additional-verification/mfa/legacy-mfa/backend-setup/second-factor
- https://supertokens.com/docs/additional-verification/mfa/legacy-mfa/backend-setup/protecting-api
- https://supertokens.com/docs/additional-verification/mfa/legacy-mfa/frontend-custom
- https://supertokens.com/docs/additional-verification/mfa/legacy-mfa/prebuilt-ui/init
- https://supertokens.com/docs/additional-verification/mfa/legacy-mfa/prebuilt-ui/showing-login-ui
- https://supertokens.com/docs/additional-verification/mfa/legacy-mfa/prebuilt-ui/protecting-routes
- https://supertokens.com/docs/additional-verification/email-verification/introduction
- https://supertokens.com/docs/additional-verification/email-verification/initial-setup
- https://supertokens.com/docs/additional-verification/email-verification/protecting-routes
- https://supertokens.com/docs/additional-verification/email-verification/manual-actions
- https://supertokens.com/docs/additional-verification/email-verification/embed-in-page
- https://supertokens.com/docs/additional-verification/email-verification/changing-style
- https://supertokens.com/docs/additional-verification/email-verification/hooks-and-overrides
- https://supertokens.com/docs/additional-verification/attack-protection-suite/introduction
- https://supertokens.com/docs/additional-verification/attack-protection-suite/initial-setup
- https://supertokens.com/docs/additional-verification/user-roles/introduction
- https://supertokens.com/docs/additional-verification/user-roles/initial-setup
- https://supertokens.com/docs/additional-verification/user-roles/role-management-actions
- https://supertokens.com/docs/additional-verification/user-roles/protecting-routes
- https://supertokens.com/docs/additional-verification/captcha

## Post-authentication (sessions, users, dashboard)

- https://supertokens.com/docs/post-authentication/post-login-redirect
- https://supertokens.com/docs/post-authentication/session-management/introduction
- https://supertokens.com/docs/post-authentication/session-management/access-session-data
- https://supertokens.com/docs/post-authentication/session-management/session-invalidation
- https://supertokens.com/docs/post-authentication/session-management/share-session-across-sub-domains
- https://supertokens.com/docs/post-authentication/session-management/switch-between-cookies-and-header-authentication
- https://supertokens.com/docs/post-authentication/session-management/advanced-workflows/anonymous-session
- https://supertokens.com/docs/post-authentication/session-management/advanced-workflows/user-impersonation
- https://supertokens.com/docs/post-authentication/session-management/advanced-workflows/customize-error-handling
- https://supertokens.com/docs/post-authentication/session-management/advanced-workflows/multiple-api-endpoints
- https://supertokens.com/docs/post-authentication/session-management/advanced-workflows/disable-frontend-interceptors
- https://supertokens.com/docs/post-authentication/session-management/advanced-workflows/in-iframe
- https://supertokens.com/docs/post-authentication/session-management/advanced-workflows/access-token-blacklisting
- https://supertokens.com/docs/post-authentication/session-management/security
- https://supertokens.com/docs/post-authentication/user-management/introduction
- https://supertokens.com/docs/post-authentication/user-management/common-actions
- https://supertokens.com/docs/post-authentication/user-management/allow-users-to-update-their-data
- https://supertokens.com/docs/post-authentication/user-management/user-metadata
- https://supertokens.com/docs/post-authentication/user-management/user-profile
- https://supertokens.com/docs/post-authentication/user-management/account-deduplication
- https://supertokens.com/docs/post-authentication/user-management/user-banning
- https://supertokens.com/docs/post-authentication/user-management/progressive-profiling
- https://supertokens.com/docs/post-authentication/account-linking/introduction
- https://supertokens.com/docs/post-authentication/account-linking/important-concepts
- https://supertokens.com/docs/post-authentication/account-linking/automatic-account-linking
- https://supertokens.com/docs/post-authentication/account-linking/manual-account-linking
- https://supertokens.com/docs/post-authentication/account-linking/link-social-accounts
- https://supertokens.com/docs/post-authentication/account-linking/add-passwords-to-an-existing-account
- https://supertokens.com/docs/post-authentication/dashboard/introduction
- https://supertokens.com/docs/post-authentication/dashboard/initial-setup
- https://supertokens.com/docs/post-authentication/dashboard/user-management
- https://supertokens.com/docs/post-authentication/dashboard/tenant-management

## Migration

- https://supertokens.com/docs/migration/overview
- https://supertokens.com/docs/migration/account-migration
- https://supertokens.com/docs/migration/session-migration
- https://supertokens.com/docs/migration/legacy/about
- https://supertokens.com/docs/migration/legacy/account-creation/user-creation
- https://supertokens.com/docs/migration/legacy/account-creation/user-id-mapping
- https://supertokens.com/docs/migration/legacy/account-creation/email-verification
- https://supertokens.com/docs/migration/legacy/account-creation/ep-migration-without-password-hash
- https://supertokens.com/docs/migration/legacy/data-migration
- https://supertokens.com/docs/migration/legacy/session-migration
- https://supertokens.com/docs/migration/legacy/mfa-migration
- https://supertokens.com/docs/migration/rownd/migration-steps
- https://supertokens.com/docs/migration/rownd/sdk-integration-guide

## Platform configuration

- https://supertokens.com/docs/platform-configuration/supertokens-core/api-keys
- https://supertokens.com/docs/platform-configuration/supertokens-core/ip-allow-deny
- https://supertokens.com/docs/platform-configuration/supertokens-core/add-ssl-via-nginx
- https://supertokens.com/docs/platform-configuration/supertokens-core/base-path
- https://supertokens.com/docs/platform-configuration/supertokens-core/cli
- https://supertokens.com/docs/platform-configuration/email-delivery
- https://supertokens.com/docs/platform-configuration/sms-delivery

## Deployment

- https://supertokens.com/docs/deployment/self-host-supertokens
- https://supertokens.com/docs/deployment/rate-limits
- https://supertokens.com/docs/deployment/scalability
- https://supertokens.com/docs/deployment/telemetry
- https://supertokens.com/docs/deployment/migrate-from-mysql(Needs — *Map to Migrate from MySQL → Doltgres for Briven.*

## References (SDKs, FDI, CDI, plugins, testing)

- https://supertokens.com/docs/references/plugins/introduction
- https://supertokens.com/docs/references/plugins/captcha-nodejs
- https://supertokens.com/docs/references/plugins/captcha-react
- https://supertokens.com/docs/references/plugins/opentelemetry-nodejs
- https://supertokens.com/docs/references/plugins/profile-base-react
- https://supertokens.com/docs/references/plugins/profile-details-nodejs
- https://supertokens.com/docs/references/plugins/profile-details-react
- https://supertokens.com/docs/references/plugins/profile-details-shared
- https://supertokens.com/docs/references/plugins/progressive-profiling-nodejs
- https://supertokens.com/docs/references/plugins/progressive-profiling-react
- https://supertokens.com/docs/references/plugins/progressive-profiling-shared
- https://supertokens.com/docs/references/plugins/tenant-discovery-nodejs
- https://supertokens.com/docs/references/plugins/tenant-discovery-react
- https://supertokens.com/docs/references/plugins/tenants-nodejs
- https://supertokens.com/docs/references/plugins/tenants-react
- https://supertokens.com/docs/references/plugins/user-banning-nodejs
- https://supertokens.com/docs/references/plugins/user-banning-react
- https://supertokens.com/docs/references/frontend-sdks/reference
- https://supertokens.com/docs/references/frontend-sdks/function-overrides
- https://supertokens.com/docs/references/frontend-sdks/hooks
- https://supertokens.com/docs/references/frontend-sdks/prebuilt-ui/changing-colours
- https://supertokens.com/docs/references/frontend-sdks/prebuilt-ui/changing-style
- https://supertokens.com/docs/references/frontend-sdks/prebuilt-ui/override-react-components
- https://supertokens.com/docs/references/frontend-sdks/prebuilt-ui/embed-sign-in-up-form
- https://supertokens.com/docs/references/frontend-sdks/prebuilt-ui/shadow-dom
- https://supertokens.com/docs/references/frontend-sdks/prebuilt-ui/toc-privacypolicy
- https://supertokens.com/docs/references/frontend-sdks/prebuilt-ui/translations
- https://supertokens.com/docs/references/frontend-sdks/prebuilt-ui/ui-showcase
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/package
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-emailpassword-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-emailpassword
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-emailverification-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-emailverification
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-multifactorauth-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-multifactorauth
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-multitenancy-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-multitenancy
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-oauth2provider-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-oauth2provider
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-passwordless-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-passwordless
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-session-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-session
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-thirdparty-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-thirdparty
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-totp-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-totp
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-userroles
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-webauthn-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-auth-react/recipe-webauthn
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/package
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-emailpassword-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-emailpassword
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-emailverification-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-emailverification
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-multifactorauth-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-multifactorauth
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-multitenancy-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-multitenancy
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-oauth2provider-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-oauth2provider
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-passwordless-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-passwordless
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-session-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-session
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-thirdparty-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-thirdparty
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-totp-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-totp
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-userroles
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-webauthn-types
- https://supertokens.com/docs/references/frontend-sdks/supertokens-web-js/recipe-webauthn
- https://supertokens.com/docs/references/backend-sdks/reference
- https://supertokens.com/docs/references/backend-sdks/function-overrides
- https://supertokens.com/docs/references/backend-sdks/api-overrides
- https://supertokens.com/docs/references/backend-sdks/user-context
- https://supertokens.com/docs/references/backend-sdks/user-object
- https://supertokens.com/docs/references/backend-sdks/backend-sdk-core-interceptor
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/package
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-emailpassword-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-emailpassword
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-passwordless-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-passwordless
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-thirdparty-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-thirdparty
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-webauthn-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-webauthn
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-emailverification-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-emailverification
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-multifactorauth-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-multifactorauth
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-accountlinking-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-accountlinking
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-jwt-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-jwt
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-multitenancy-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-multitenancy
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-dashboard-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-dashboard
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-oauth2provider-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-oauth2provider
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-openid-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-openid
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-userroles-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-userroles
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-usermetadata-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-usermetadata
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-totp-types
- https://supertokens.com/docs/references/backend-sdks/supertokens-nodejs/recipe-totp
- https://supertokens.com/docs/references/backend-sdks/other-frameworks
- https://supertokens.com/docs/references/fdi/introduction
- https://supertokens.com/docs/references/fdi/email-verification/get-user-email-verify
- https://supertokens.com/docs/references/fdi/email-verification/post-user-email-verify
- https://supertokens.com/docs/references/fdi/email-verification/post-user-email-verify-token
- https://supertokens.com/docs/references/fdi/email-password/get-emailpassword-email-exists
- https://supertokens.com/docs/references/fdi/email-password/post-signin
- https://supertokens.com/docs/references/fdi/email-password/post-signup
- https://supertokens.com/docs/references/fdi/email-password/post-user-password-reset
- https://supertokens.com/docs/references/fdi/email-password/post-user-password-reset-token
- https://supertokens.com/docs/references/fdi/mfa/get-totp-device-list
- https://supertokens.com/docs/references/fdi/mfa/post-totp-device
- https://supertokens.com/docs/references/fdi/mfa/post-totp-device-remove
- https://supertokens.com/docs/references/fdi/mfa/post-totp-device-verify
- https://supertokens.com/docs/references/fdi/mfa/post-totp-verify
- https://supertokens.com/docs/references/fdi/mfa/put-mfa-info
- https://supertokens.com/docs/references/fdi/oauth/get-oauth-auth
- https://supertokens.com/docs/references/fdi/oauth/get-oauth-end_session
- https://supertokens.com/docs/references/fdi/oauth/get-oauth-login
- https://supertokens.com/docs/references/fdi/oauth/get-oauth-logininfo
- https://supertokens.com/docs/references/fdi/oauth/get-oauth-userinfo
- https://supertokens.com/docs/references/fdi/oauth/post-oauth-end_session
- https://supertokens.com/docs/references/fdi/oauth/post-oauth-introspect
- https://supertokens.com/docs/references/fdi/oauth/post-oauth-logout
- https://supertokens.com/docs/references/fdi/oauth/post-oauth-revoke
- https://supertokens.com/docs/references/fdi/oauth/post-oauth-token
- https://supertokens.com/docs/references/fdi/passwordless/get-passwordless-email-exists
- https://supertokens.com/docs/references/fdi/passwordless/get-passwordless-phoneNumber-exists
- https://supertokens.com/docs/references/fdi/passwordless/post-signinup-code
- https://supertokens.com/docs/references/fdi/passwordless/post-signinup-code-consume
- https://supertokens.com/docs/references/fdi/passwordless/post-signinup-code-resend
- https://supertokens.com/docs/references/fdi/session/post-session-refresh
- https://supertokens.com/docs/references/fdi/session/post-signout
- https://supertokens.com/docs/references/fdi/thirdparty/get-authorisationurl
- https://supertokens.com/docs/references/fdi/thirdparty/post-signinup
- https://supertokens.com/docs/references/fdi/thirdparty/post-callback-apple
- https://supertokens.com/docs/references/fdi/webauthn/get-webauthn-email-exists
- https://supertokens.com/docs/references/fdi/webauthn/post-webauthn-credential
- https://supertokens.com/docs/references/fdi/webauthn/post-webauthn-recover-account
- https://supertokens.com/docs/references/fdi/webauthn/post-webauthn-recover-account-token
- https://supertokens.com/docs/references/fdi/webauthn/post-webauthn-register-options
- https://supertokens.com/docs/references/fdi/webauthn/post-webauthn-signin
- https://supertokens.com/docs/references/fdi/webauthn/post-webauthn-signin-options
- https://supertokens.com/docs/references/fdi/webauthn/post-webauthn-signup
- https://supertokens.com/docs/references/fdi/get-loginmethods
- https://supertokens.com/docs/references/fdi/get-jwt-jwks-json
- https://supertokens.com/docs/references/fdi/get-well-known-openid-configuration
- https://supertokens.com/docs/references/fdi/get-example
- https://supertokens.com/docs/references/cdi/introduction
- https://supertokens.com/docs/references/cdi/account-linking/get-accountlinking-user-link-check
- https://supertokens.com/docs/references/cdi/account-linking/get-accountlinking-user-primary-check
- https://supertokens.com/docs/references/cdi/account-linking/post-accountlinking-user-link
- https://supertokens.com/docs/references/cdi/account-linking/post-accountlinking-user-primary
- https://supertokens.com/docs/references/cdi/account-linking/post-accountlinking-user-unlink
- https://supertokens.com/docs/references/cdi/import/get-bulk-import-users
- https://supertokens.com/docs/references/cdi/import/post-bulk-import-import
- https://supertokens.com/docs/references/cdi/import/post-bulk-import-users
- https://supertokens.com/docs/references/cdi/import/delete-bulk-import-users
- https://supertokens.com/docs/references/cdi/import/get-bulk-import-users-count
- https://supertokens.com/docs/references/cdi/core/get-root
- https://supertokens.com/docs/references/cdi/core/get-hello
- https://supertokens.com/docs/references/cdi/core/get-users
- https://supertokens.com/docs/references/cdi/core/get-users-by-accountinfo
- https://supertokens.com/docs/references/cdi/core/get-users-count
- https://supertokens.com/docs/references/cdi/core/get-apiversion
- https://supertokens.com/docs/references/cdi/core/get-ee-featureflag
- https://supertokens.com/docs/references/cdi/core/get-ee-license
- https://supertokens.com/docs/references/cdi/core/get-userid-map
- https://supertokens.com/docs/references/cdi/core/get-requests-stats
- https://supertokens.com/docs/references/cdi/core/get-telemetry
- https://supertokens.com/docs/references/cdi/core/get-user-id
- https://supertokens.com/docs/references/cdi/core/get-user-search-tags
- https://supertokens.com/docs/references/cdi/core/get-users-count-active
- https://supertokens.com/docs/references/cdi/core/get-config
- https://supertokens.com/docs/references/cdi/core/post-hello
- https://supertokens.com/docs/references/cdi/core/post-userid-map
- https://supertokens.com/docs/references/cdi/core/post-userid-map-remove
- https://supertokens.com/docs/references/cdi/core/post-user-remove
- https://supertokens.com/docs/references/cdi/core/put-hello
- https://supertokens.com/docs/references/cdi/core/put-ee-license
- https://supertokens.com/docs/references/cdi/core/put-userid-external-user-id-info
- https://supertokens.com/docs/references/cdi/core/delete-hello
- https://supertokens.com/docs/references/cdi/core/delete-ee-license
- https://supertokens.com/docs/references/cdi/dashboard/get-dashboard-tenant-core-config
- https://supertokens.com/docs/references/cdi/dashboard/get-dashboard-user-sessions
- https://supertokens.com/docs/references/cdi/dashboard/get-dashboard-users
- https://supertokens.com/docs/references/cdi/dashboard/post-dashboard-session-verify
- https://supertokens.com/docs/references/cdi/dashboard/post-dashboard-signin
- https://supertokens.com/docs/references/cdi/dashboard/post-dashboard-user
- https://supertokens.com/docs/references/cdi/dashboard/put-dashboard-user
- https://supertokens.com/docs/references/cdi/dashboard/delete-dashboard-session
- https://supertokens.com/docs/references/cdi/dashboard/delete-dashboard-user
- https://supertokens.com/docs/references/cdi/email-verification/get-user-email-verify
- https://supertokens.com/docs/references/cdi/email-verification/post-user-email-verify
- https://supertokens.com/docs/references/cdi/email-verification/post-user-email-verify-token
- https://supertokens.com/docs/references/cdi/email-verification/post-user-email-verify-token-remove
- https://supertokens.com/docs/references/cdi/email-verification/post-user-email-verify-remove
- https://supertokens.com/docs/references/cdi/email-password/post-signin
- https://supertokens.com/docs/references/cdi/email-password/post-signup
- https://supertokens.com/docs/references/cdi/email-password/post-user-password-reset-token
- https://supertokens.com/docs/references/cdi/email-password/post-user-password-reset-token-consume
- https://supertokens.com/docs/references/cdi/email-password/post-user-passwordhash-import
- https://supertokens.com/docs/references/cdi/email-password/put-user
- https://supertokens.com/docs/references/cdi/mfa/get-totp-device-list
- https://supertokens.com/docs/references/cdi/mfa/post-totp-device-verify
- https://supertokens.com/docs/references/cdi/mfa/post-totp-verify
- https://supertokens.com/docs/references/cdi/mfa/post-totp-device
- https://supertokens.com/docs/references/cdi/mfa/post-totp-device-remove
- https://supertokens.com/docs/references/cdi/mfa/post-totp-device-import
- https://supertokens.com/docs/references/cdi/mfa/put-totp-device
- https://supertokens.com/docs/references/cdi/multitenancy/get-multitenancy-tenant-v2
- https://supertokens.com/docs/references/cdi/multitenancy/get-multitenancy-tenant-list-v2
- https://supertokens.com/docs/references/cdi/multitenancy/get-multitenancy-app-list-v2
- https://supertokens.com/docs/references/cdi/multitenancy/get-multitenancy-connectionuridomain-list-v2
- https://supertokens.com/docs/references/cdi/multitenancy/post-multitenancy-config-thirdparty-remove
- https://supertokens.com/docs/references/cdi/multitenancy/post-multitenancy-tenant-user
- https://supertokens.com/docs/references/cdi/multitenancy/post-multitenancy-tenant-user-remove
- https://supertokens.com/docs/references/cdi/multitenancy/post-multitenancy-tenant-remove
- https://supertokens.com/docs/references/cdi/multitenancy/post-multitenancy-app-remove
- https://supertokens.com/docs/references/cdi/multitenancy/post-multitenancy-connectionuridomain-remove
- https://supertokens.com/docs/references/cdi/multitenancy/put-multitenancy-config-thirdparty
- https://supertokens.com/docs/references/cdi/multitenancy/put-multitenancy-tenant-v2
- https://supertokens.com/docs/references/cdi/multitenancy/put-multitenancy-app-v2
- https://supertokens.com/docs/references/cdi/multitenancy/put-multitenancy-connectionuridomain-v2
- https://supertokens.com/docs/references/cdi/oauth/get-well-known-jwks
- https://supertokens.com/docs/references/cdi/oauth/get-oauth2-auth
- https://supertokens.com/docs/references/cdi/oauth/get-oauth2-consent-request
- https://supertokens.com/docs/references/cdi/oauth/get-oauth2-login-request
- https://supertokens.com/docs/references/cdi/oauth/get-oauth2-client
- https://supertokens.com/docs/references/cdi/oauth/get-oauth2-clients
- https://supertokens.com/docs/references/cdi/oauth/get-oauth2-sessions-logout
- https://supertokens.com/docs/references/cdi/oauth/post-oauth2-client
- https://supertokens.com/docs/references/cdi/oauth/post-oauth2-client-remove
- https://supertokens.com/docs/references/cdi/oauth/post-oauth2-token-introspect
- https://supertokens.com/docs/references/cdi/oauth/post-oauth2-session-revoke
- https://supertokens.com/docs/references/cdi/oauth/get-oauth2-token
- https://supertokens.com/docs/references/cdi/oauth/post-oauth2-token-revoke
- https://supertokens.com/docs/references/cdi/oauth/post-oauth2-tokens-revoke
- https://supertokens.com/docs/references/cdi/oauth/post-oauth2-consent-request-accept
- https://supertokens.com/docs/references/cdi/oauth/post-oauth2-consent-request-reject
- https://supertokens.com/docs/references/cdi/oauth/post-oauth2-login-request-accept
- https://supertokens.com/docs/references/cdi/oauth/post-oauth2-login-request-reject
- https://supertokens.com/docs/references/cdi/oauth/post-oauth2-logout-request-accept
- https://supertokens.com/docs/references/cdi/oauth/post-oauth2-logout-request-reject
- https://supertokens.com/docs/references/cdi/oauth/put-oauth2-client
- https://supertokens.com/docs/references/cdi/passwordless/get-signinup-codes
- https://supertokens.com/docs/references/cdi/passwordless/post-signinup-code
- https://supertokens.com/docs/references/cdi/passwordless/post-signinup-code-check
- https://supertokens.com/docs/references/cdi/passwordless/post-signinup-code-consume
- https://supertokens.com/docs/references/cdi/passwordless/post-signinup-code-remove
- https://supertokens.com/docs/references/cdi/passwordless/post-signinup-codes-remove
- https://supertokens.com/docs/references/cdi/passwordless/put-user
- https://supertokens.com/docs/references/cdi/session/get-session-user
- https://supertokens.com/docs/references/cdi/session/get-session
- https://supertokens.com/docs/references/cdi/session/post-session
- https://supertokens.com/docs/references/cdi/session/post-session-remove
- https://supertokens.com/docs/references/cdi/session/post-jwt
- https://supertokens.com/docs/references/cdi/session/post-session-refresh
- https://supertokens.com/docs/references/cdi/session/post-session-regenerate
- https://supertokens.com/docs/references/cdi/session/post-session-verify
- https://supertokens.com/docs/references/cdi/session/put-jwt-data
- https://supertokens.com/docs/references/cdi/session/put-session-data
- https://supertokens.com/docs/references/cdi/thirdparty/post-signinup
- https://supertokens.com/docs/references/cdi/user-metadata/get-user-metadata
- https://supertokens.com/docs/references/cdi/user-metadata/post-user-metadata-remove
- https://supertokens.com/docs/references/cdi/user-metadata/put-user-metadata
- https://supertokens.com/docs/references/cdi/user-roles/get-role-users
- https://supertokens.com/docs/references/cdi/user-roles/get-user-roles
- https://supertokens.com/docs/references/cdi/user-roles/get-permission-roles
- https://supertokens.com/docs/references/cdi/user-roles/get-role-permissions
- https://supertokens.com/docs/references/cdi/user-roles/get-roles
- https://supertokens.com/docs/references/cdi/user-roles/post-user-role-remove
- https://supertokens.com/docs/references/cdi/user-roles/post-role-permissions-remove
- https://supertokens.com/docs/references/cdi/user-roles/post-role-remove
- https://supertokens.com/docs/references/cdi/user-roles/put-user-role
- https://supertokens.com/docs/references/cdi/user-roles/put-role
- https://supertokens.com/docs/references/testing-and-debugging/api-testing
- https://supertokens.com/docs/references/testing-and-debugging/how-to-troubleshoot
- https://supertokens.com/docs/references/testing-and-debugging/common-issues
- https://supertokens.com/docs/references/updating-supertokens
- https://supertokens.com/docs/references/compatibility-table
- https://supertokens.com/docs/references/cdi/webauthn/get-webauthn-options
- https://supertokens.com/docs/references/cdi/webauthn/get-webauthn-credential
- https://supertokens.com/docs/references/cdi/webauthn/get-webauthn-credentials
- https://supertokens.com/docs/references/cdi/webauthn/post-webauthn-recover
- https://supertokens.com/docs/references/cdi/webauthn/post-webauthn-registration-options
- https://supertokens.com/docs/references/cdi/webauthn/post-webauthn-signin-options
- https://supertokens.com/docs/references/cdi/webauthn/post-webauthn-signin
- https://supertokens.com/docs/references/cdi/webauthn/post-webauthn-signup
- https://supertokens.com/docs/references/cdi/webauthn/post-webauthn-register
- https://supertokens.com/docs/references/cdi/webauthn/post-webauthn-token-recovery
- https://supertokens.com/docs/references/cdi/webauthn/post-webauthn-token-consume
- https://supertokens.com/docs/references/cdi/webauthn/put-webauthn-email
- https://supertokens.com/docs/references/cdi/webauthn/delete-webauthn-options
- https://supertokens.com/docs/references/cdi/webauthn/delete-webauthn-credential

## Briven-specific mapping notes

| SuperTokens docs say | Briven Auth must do |
|----------------------|---------------------|
| Supabase | Briven Doltgres per project |
| MySQL migrate | Migrate / store on Doltgres |
| Self-host Core | Hosted by Briven platform (users do not run Core) |
| App domain backend SDK | First-party auth on app + Briven Auth control plane |
| Dashboard | Yellow **Briven Auth** sidebar section (sub-dashboard) |



# Briven Pay build

# Briven database — Doltgres / Dolt official knowledge base

**Purpose:** Library cabinet for EVERY Briven build that touches SQL, Auth, backups, or Postgres-family compatibility.
**Source:** (1) **flndrn official www.doltgres.com list** (PRIMARY, complete set below) + (2) URLs from `AI_DOCS/dolt-reference/*` (local notes + often dolthub.com MySQL-Dolt siblings) (already in this repo). Agents must open these — do not guess.
**HARD RULE:** On any Doltgres / Postgres-wire error (including SuperTokens Core or any tool built for Postgres), search **this section** + `AI_DOCS/dolt-reference/00-doltgres-truth.md` **before** changing architecture. Never quit after one SQL error without reading these and **notifying flndrn** with options.

## Local distilled files (always read first)

- `AI_DOCS/dolt-reference/00-doltgres-truth.md` — **authoritative DoltGres facts** (Postgres-flavored)
- `AI_DOCS/dolt-reference/01-intro-install.md`
- `AI_DOCS/dolt-reference/02-use-cases.md`
- `AI_DOCS/dolt-reference/03-concepts-git.md`
- `AI_DOCS/dolt-reference/04-concepts-sql.md`
- `AI_DOCS/dolt-reference/05-rdbms-dolthub.md`
- `AI_DOCS/dolt-reference/06-sqlref-server.md`
- `AI_DOCS/dolt-reference/07-sqlref-version-control.md`
- `DOLTGRES-FIRST.md` — Briven hard product rule

## Official DoltGres docs (www.doltgres.com) — PRIMARY for Briven

**Filed from flndrn full URL list (2026-07-22).** These are the **real DoltGres product docs** (Postgres-flavored). Prefer these over dolthub.com MySQL-Dolt pages when they overlap.
**Count:** 51 URLs

### Introduction

- https://www.doltgres.com/docs/introduction/
- https://www.doltgres.com/docs/introduction/getting-started/
- https://www.doltgres.com/docs/introduction/installation/

### Concepts — git / version control

- https://www.doltgres.com/docs/concepts/git/branch/
- https://www.doltgres.com/docs/concepts/git/commits/
- https://www.doltgres.com/docs/concepts/git/conflicts/
- https://www.doltgres.com/docs/concepts/git/diff/
- https://www.doltgres.com/docs/concepts/git/log/
- https://www.doltgres.com/docs/concepts/git/merge/
- https://www.doltgres.com/docs/concepts/git/remotes/
- https://www.doltgres.com/docs/concepts/git/working-set/

### Concepts — SQL

- https://www.doltgres.com/docs/concepts/sql/constraints/
- https://www.doltgres.com/docs/concepts/sql/databases/
- https://www.doltgres.com/docs/concepts/sql/functions/
- https://www.doltgres.com/docs/concepts/sql/indexes/
- https://www.doltgres.com/docs/concepts/sql/primary-key/
- https://www.doltgres.com/docs/concepts/sql/procedures/
- https://www.doltgres.com/docs/concepts/sql/schema/
- https://www.doltgres.com/docs/concepts/sql/system-variables/
- https://www.doltgres.com/docs/concepts/sql/table/
- https://www.doltgres.com/docs/concepts/sql/transaction/
- https://www.doltgres.com/docs/concepts/sql/triggers/
- https://www.doltgres.com/docs/concepts/sql/types/
- https://www.doltgres.com/docs/concepts/sql/users-grants/
- https://www.doltgres.com/docs/concepts/sql/views/

### Concepts — RDBMS

- https://www.doltgres.com/docs/concepts/rdbms/backups/
- https://www.doltgres.com/docs/concepts/rdbms/replication/
- https://www.doltgres.com/docs/concepts/rdbms/server/

### Guides

- https://www.doltgres.com/docs/guides/cheat-sheet/
- https://www.doltgres.com/docs/guides/replication-from-postgres/

### Reference — server

- https://www.doltgres.com/docs/reference/server/access-management/
- https://www.doltgres.com/docs/reference/server/backups/
- https://www.doltgres.com/docs/reference/server/branch-permissions/
- https://www.doltgres.com/docs/reference/server/configuration/
- https://www.doltgres.com/docs/reference/server/garbage-collection/
- https://www.doltgres.com/docs/reference/server/troubleshooting/

### Reference — version control

- https://www.doltgres.com/docs/reference/version-control/branches/
- https://www.doltgres.com/docs/reference/version-control/dolt-sql-functions/
- https://www.doltgres.com/docs/reference/version-control/dolt-system-tables/
- https://www.doltgres.com/docs/reference/version-control/dolt-sysvars/
- https://www.doltgres.com/docs/reference/version-control/merges/
- https://www.doltgres.com/docs/reference/version-control/querying-history/
- https://www.doltgres.com/docs/reference/version-control/remotes/
- https://www.doltgres.com/docs/reference/version-control/sql-extensions/

### Reference — SQL support (Postgres-family gaps live here)

- https://www.doltgres.com/docs/reference/sql-support/supported-commands/
- https://www.doltgres.com/docs/reference/sql-support/supported-functions/
- https://www.doltgres.com/docs/reference/sql-support/supported-types/
- https://www.doltgres.com/docs/reference/sql-support/system-catalog-schema/

### Reference — clients

- https://www.doltgres.com/docs/reference/supported-clients/clients/

### Reference — benchmarks

- https://www.doltgres.com/docs/reference/benchmarks/correctness/
- https://www.doltgres.com/docs/reference/benchmarks/latency/
## Official DoltHub docs (Dolt often MySQL-flavored; translate to DoltGres Postgres)

### Introduction / install

- https://www.dolthub.com/docs/introduction/getting-started/
- https://www.dolthub.com/docs/introduction/getting-started/database/
- https://www.dolthub.com/docs/introduction/getting-started/git-for-data/
- https://www.dolthub.com/docs/introduction/getting-started/versioned-mysql-replica/
- https://www.dolthub.com/docs/introduction/installation/
- https://www.dolthub.com/docs/introduction/installation/application-server/
- https://www.dolthub.com/docs/introduction/installation/docker/
- https://www.dolthub.com/docs/introduction/installation/linux/
- https://www.dolthub.com/docs/introduction/installation/mac/
- https://www.dolthub.com/docs/introduction/installation/source/
- https://www.dolthub.com/docs/introduction/installation/upgrading/
- https://www.dolthub.com/docs/introduction/installation/windows/
- https://www.dolthub.com/docs/introduction/what-is-dolt/

### Use cases

- https://www.dolthub.com/docs/introduction/use-cases/
- https://www.dolthub.com/docs/introduction/use-cases/audit/
- https://www.dolthub.com/docs/introduction/use-cases/configuration-management/
- https://www.dolthub.com/docs/introduction/use-cases/data-and-model-quality/
- https://www.dolthub.com/docs/introduction/use-cases/data-sharing/
- https://www.dolthub.com/docs/introduction/use-cases/manual-data-curation/
- https://www.dolthub.com/docs/introduction/use-cases/offline-first/
- https://www.dolthub.com/docs/introduction/use-cases/vc-your-app/
- https://www.dolthub.com/docs/introduction/use-cases/versioned-replica/

### Concepts — overview + git / version control

- https://www.dolthub.com/docs/concepts/dolt/
- https://www.dolthub.com/docs/concepts/dolt/git/
- https://www.dolthub.com/docs/concepts/dolt/git/branch/
- https://www.dolthub.com/docs/concepts/dolt/git/commits/
- https://www.dolthub.com/docs/concepts/dolt/git/conflicts/
- https://www.dolthub.com/docs/concepts/dolt/git/diff/
- https://www.dolthub.com/docs/concepts/dolt/git/log/
- https://www.dolthub.com/docs/concepts/dolt/git/merge/
- https://www.dolthub.com/docs/concepts/dolt/git/remotes/
- https://www.dolthub.com/docs/concepts/dolt/git/working-set/

### Concepts — SQL

- https://www.dolthub.com/docs/concepts/dolt/sql/
- https://www.dolthub.com/docs/concepts/dolt/sql/constraints/
- https://www.dolthub.com/docs/concepts/dolt/sql/databases/
- https://www.dolthub.com/docs/concepts/dolt/sql/indexes/
- https://www.dolthub.com/docs/concepts/dolt/sql/primary-key/
- https://www.dolthub.com/docs/concepts/dolt/sql/procedures/
- https://www.dolthub.com/docs/concepts/dolt/sql/schema/
- https://www.dolthub.com/docs/concepts/dolt/sql/system-variables/
- https://www.dolthub.com/docs/concepts/dolt/sql/table/
- https://www.dolthub.com/docs/concepts/dolt/sql/transaction/
- https://www.dolthub.com/docs/concepts/dolt/sql/triggers/
- https://www.dolthub.com/docs/concepts/dolt/sql/types/
- https://www.dolthub.com/docs/concepts/dolt/sql/users-grants/
- https://www.dolthub.com/docs/concepts/dolt/sql/views/

### Concepts — RDBMS + DoltHub product

- https://www.dolthub.com/docs/concepts/dolt/rdbms/
- https://www.dolthub.com/docs/concepts/dolt/rdbms/backups/
- https://www.dolthub.com/docs/concepts/dolt/rdbms/replication/
- https://www.dolthub.com/docs/concepts/dolt/rdbms/server/
- https://www.dolthub.com/docs/concepts/dolthub/
- https://www.dolthub.com/docs/concepts/dolthub/forks/
- https://www.dolthub.com/docs/concepts/dolthub/issues/
- https://www.dolthub.com/docs/concepts/dolthub/permissions/
- https://www.dolthub.com/docs/concepts/dolthub/prs/

### SQL reference — server ops

- https://www.dolthub.com/docs/sql-reference/server/
- https://www.dolthub.com/docs/sql-reference/server/access-management/
- https://www.dolthub.com/docs/sql-reference/server/backups/
- https://www.dolthub.com/docs/sql-reference/server/branch-permissions/
- https://www.dolthub.com/docs/sql-reference/server/configuration/
- https://www.dolthub.com/docs/sql-reference/server/garbage-collection/
- https://www.dolthub.com/docs/sql-reference/server/hardware-requirements/
- https://www.dolthub.com/docs/sql-reference/server/metrics/
- https://www.dolthub.com/docs/sql-reference/server/replication/
- https://www.dolthub.com/docs/sql-reference/server/troubleshooting/

### SQL reference — version control API

- https://www.dolthub.com/docs/sql-reference/version-control/branches/
- https://www.dolthub.com/docs/sql-reference/version-control/dolt-sql-functions/
- https://www.dolthub.com/docs/sql-reference/version-control/dolt-sql-procedures/
- https://www.dolthub.com/docs/sql-reference/version-control/dolt-system-tables/
- https://www.dolthub.com/docs/sql-reference/version-control/dolt-sysvars/
- https://www.dolthub.com/docs/sql-reference/version-control/merges/
- https://www.dolthub.com/docs/sql-reference/version-control/querying-history/
- https://www.dolthub.com/docs/sql-reference/version-control/remote-authentication/
- https://www.dolthub.com/docs/sql-reference/version-control/remotes/
- https://www.dolthub.com/docs/sql-reference/version-control/saved-queries/
- https://www.dolthub.com/docs/sql-reference/version-control/sql-extensions/

## Blogs (product state / calling conventions)

- https://www.dolthub.com/blog/2024-07-30-re-introducing-dolt-functions/
- https://www.dolthub.com/blog/2025-04-16-doltgres-goes-beta/
- https://www.dolthub.com/blog/2025-10-16-state-of-doltgres/

## GitHub install (Dolt sibling — only if needed for concept)

- https://github.com/dolthub/dolt/releases/latest/download/install.sh

## Agent workflow when something fails on Doltgres

1. Read `AI_DOCS/dolt-reference/00-doltgres-truth.md` and the matching URL group above.
2. Doltgres = **Postgres family** (port 5432, `pg` driver). Missing feature ≠ abandon the product.
3. Prefer workarounds (SQL rewrite, session settings, driver, version, config) over stock Postgres.
4. **Notify flndrn** with: error text, which doc URL you used, options A/B/C — **before** switching architecture.
