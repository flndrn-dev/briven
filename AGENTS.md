# CLAUDE.md — Briven (project root)

Agent instructions for this repo. **Hard rules never break.**

---

## HARD RULE — Auth work: open SuperTokens knowledge base first (never break)

**Owner intent (flndrn, 2026-07-26):** Agents were guessing Auth instead of using the SuperTokens library. That ends here.

### Before **any** Auth change

This includes: magic link, OTP, SMS, OAuth / social / Konnos, sessions, MFA, passkeys, FDI proxy, IdP/OIDC, SSO, multitenancy, branding, providers UI, secrets, allowed domains, disable/enable Auth, or anything under `apps/api/src/**/auth*`, `apps/api/src/services/auth-core/**`, `packages/auth/**`, Auth dashboard routes, or Auth docs.

You **must**:

1. **Open and read** [`docs/knowledge-base.md`](docs/knowledge-base.md) (the SuperTokens + Doltgres library cabinet for this project).
2. Open the **matching SuperTokens section/URL** for the feature (passwordless, thirdparty, sessions, FDI, multitenancy, etc.).
3. If the work touches the database or SQL: also open the **Doltgres** section of that file (and `AI_DOCS/dolt-reference/` when present).
4. **State in one plain sentence** what SuperTokens (or the KB) says the correct behavior is — then implement Briven-branded on Doltgres.
5. **Do not invent** login shapes, magic-link hosts, OAuth flows, or cookie rules from memory alone.

### Forbidden

- Shipping Auth changes without reading `docs/knowledge-base.md` first.
- “Looks reasonable” / assume / guess when SuperTokens already documents the flow.
- Abandoning briven-engine / architecture after one SQL error without Doltgres docs + notifying flndrn.

### After Auth changes

- Prefer prove on a real project path (e.g. mavi pay / ISY) with evidence — not “code looks fine.”

**Library path:** `docs/knowledge-base.md`  
**Purpose:** SuperTokens as product/architecture map; Briven stays Briven-branded on Doltgres.

---

## Other standing notes

- Product walls, multi-tenant isolation, `pk_briven_auth_` public keys, no inventing Clerk/Firebase as the platform engine.
- Infra compose logging caps and Docker rules: see `infra/CLAUDE.md` and `docs/DOCKER.md` when editing `infra/`.
- Deploy: France Briven compose + `scripts/safe-redeploy-service.sh`; batch deploys when possible.
