# Briven Auth — 100% SuperTokens feature-to-feature build plan (Doltgres)

**Owner:** flndrn  
**Filed:** 2026-07-22  
**Status:** PLAN ONLY — **no build starts until flndrn says OK for a named phase**  
**Libraries (mandatory):**
1. `knowledge-base.md` → SuperTokens section (**492** official URLs)  
2. `knowledge-base.md` → Official DoltGres section (**51** `www.doltgres.com` URLs)  
3. `AI_DOCS/dolt-reference/00-doltgres-truth.md` + siblings  
4. `DOLTGRES-FIRST.md`  

---

## 0. Plain words (what this plan is)

You want **Briven Auth** to do **everything SuperTokens does as a product**, running on **Briven’s Doltgres** stack, so apps (mavi pay, handlr, konnos, pando, katsuro, …) can log in again and stay on platform.

This plan is **honest**:
- **100% feature-to-feature** means walking SuperTokens’ published surface (recipes + FDI/CDI + plugins + integrations) against a **live** Briven Auth — not “similar vibes.”
- Doltgres is **Postgres-family** (same wire family). If SuperTokens works on Postgres, we **make it work on Doltgres** using official Doltgres docs — we do **not** quit after one SQL error and rewrite in silence.
- Previous failure: Core hit `SET SESSION CHARACTERISTICS` → path abandoned without your clear OK → native reimplementation. **That is forbidden under this plan.**

---

## 1. Non‑negotiable rules

| # | Rule |
|---|------|
| R1 | **Notify flndrn before every phase start, architecture change, wipe, or deploy.** No quiet pivots. |
| R2 | **Primary engine path = SuperTokens Core + Briven product layer**, on Doltgres (or a documented, flndrn-approved temporary bridge if Core cannot run). |
| R3 | On any Doltgres/SQL error: open `knowledge-base.md` Doltgres URLs + `00-doltgres-truth.md` → try workarounds → **report options A/B/C to flndrn** → wait for OK. |
| R4 | Phase is **not done** until: (a) code, (b) **live** proof, (c) **security smoke**, (d) **you say OK**. |
| R5 | Local scripts alone ≠ done. |
| R6 | Old Better Auth **customer** Auth product stays retired for product login; do not rebuild on it. Platform operator login (briven.tech) can stay Better Auth until you say otherwise. |
| R7 | Branding = **Briven Auth** — not SuperTokens logo. Accent = butter yellow **`#FFFD74`**. |
| R8 | Every phase maps to SuperTokens URLs in `knowledge-base.md` **and** Doltgres constraints. |
| R9 | **UI = same Briven dashboard design language** as overview + projects (see §1b). No foreign “control room” skin. |

---

## 1b. UI design law (Briven dashboard — mandatory)

**flndrn 2026-07-22:** Keep the **existing Briven dashboard UI design** for the whole Auth rebuild.  
Auth is a **section of the same product**, not a different app.

### What to match (live references in code)

| Pattern | Reference | Auth must follow |
|---------|-----------|------------------|
| Overview home | `apps/web/.../dashboard/page.tsx` | Greeting/muted mono line + big sans title; card grid + quick actions + list sections |
| Projects list | `apps/web/.../dashboard/projects/page.tsx` + `projects-list.tsx` | `font-mono` page title + count; filter; **card grid**; primary CTA button style |
| Project tabs | `project-tabs.tsx` | Compact tabs + **developer mode** for advanced tools; active underline |
| Sidebar | `dashboard-sidebar.tsx` | Auth row uses butter yellow **`#FFFD74`** when active/hover — same shape as other nav rows |
| Empty states | projects empty | Dashed border card, plain mono copy, one clear next step |
| Tokens | CSS vars | `var(--color-surface)`, `border-subtle`, `text-muted`, `primary` (green for platform CTAs) |

### Visual rules (do / don’t)

| Do | Don’t |
|----|--------|
| Dark dashboard surfaces + mono labels | New fonts or light “docs” chrome for Auth only |
| Card grids like projects | Dense engineer “control room” dumps |
| Developer mode for advanced Auth tools | Dump every ST admin screen in default tabs |
| Butter yellow **`#FFFD74`** as Auth accent only | SuperTokens branding, random golds, rainbow |
| Short lowercase product copy | “Phase 1 · Live”, rebuild essays, internal plan names |
| Same header hierarchy as projects/overview | One-off hero banners that break layout rhythm |

### Blank-page phase (before SuperTokens product UI)

When Auth is wiped / waiting on Core:

- **One blank page** under `/dashboard/auth` inside the **same** dashboard shell (sidebar, layout gap, tokens).
- Title style like projects: **Auth** + one muted line (e.g. “sign-in product — building”).
- **No** fake feature tabs until a phase is live-OK.
- No leftover Better Auth or half-built engine screens.

### When features ship

Rebuild UI **feature-by-feature** still using:

1. Overview-style pages for “at a glance”  
2. Projects-style cards for “projects with Auth on”  
3. Project-tabs pattern (simple + developer mode) for Auth sub-nav  
4. Butter yellow only as Auth identity accent  

Detail notes also live in: `apps/web/src/app/(dashboard)/dashboard/auth/UI-DESIGN.md`

---

## 2. Architecture (target — Path A corrected)

```text
Customer app (mavi, handlr, konnos, …)
  → first-party /api/auth/*  (cookies on APP domain)
  → Briven API (product: tenants=projects, keys, domains, billing, yellow UI)
  → SuperTokens Core  (ALL recipes / FDI / CDI logic — real SuperTokens)
  → Doltgres  (briven_engine or Core’s DB name ON THE DOLTGRES CLUSTER — not stock Postgres product line)
```

**Doltgres duties (from knowledge-base):**
- Prefer `www.doltgres.com` docs for Postgres-flavored behavior  
- Driver: `pg` (not postgres.js)  
- Port 5432  
- Missing Postgres feature → fix/workaround using sql-support + server troubleshooting docs  

---

## 3. Honesty: current baseline (not 100%)

| Layer | Reality today | ~% of target |
|-------|----------------|--------------|
| SuperTokens Core running | Removed; package may exist unused | **~0%** |
| SuperTokens feature surface (492) | Checklist only; native partial mimic | **~10–15%** |
| Doltgres Auth storage usable | Native `briven_engine` tables live | **partial** (not ST Core schema) |
| Apps login unblocked | Not complete | **~15–25%** |

This plan **starts from almost zero SuperTokens runtime** and aims at **100%**.

---

## 4. Gates every phase must pass

### G-LIVE (live testing)
- Hit **production or staging identical to prod**  
- Record: URL, request, response, timestamps  
- At least one **real project** path (not only local Docker)

### G-DEBUG (code debugging)
- Failures get: stack + SQL + which Doltgres doc URL was used + next attempt  
- No “unsupported → rewrite product” without flndrn

### G-SEC (security testing)
Minimum smoke each phase as relevant:
- Authn required where expected  
- No cross-project user leak  
- Rate limit / captcha hooks when in scope  
- Secrets not logged  
- Session cookie flags / host correct for app domain  

### G-DOLT (Postgres → Doltgres)
- Core (or any ST component) SQL against Doltgres verified  
- Incompatibilities logged in a living file: `BRIVEN-AUTH-DOLTGRES-COMPAT.md`  
- Each gap: status, doc URL, workaround, owner  

### G-OK
- flndrn explicit **OK** for phase  

---

## 5. Phase map — 100% SuperTokens coverage

Phases 1–8 = SuperTokens product.  
**Phase 0** = Doltgres compatibility (was missing before).  
**Phase 9** = app unblocks + security + launch (was missing as hard gate).

---

### PHASE 0 — Doltgres ↔ SuperTokens Core compatibility (MANDATORY FIRST)

**Why:** SuperTokens is Postgres-shaped; Briven is Doltgres-first. Same family → workarounds first.

| ID | Work | Knowledge-base / docs |
|----|------|------------------------|
| 0.1 | Install Core against **Doltgres** (not stock Postgres product line) | doltgres intro/install/getting-started; Core self-host docs |
| 0.2 | Reproduce any SQL errors (e.g. `SET SESSION CHARACTERISTICS`) | doltgres `supported-commands`, `supported-functions`, `system-catalog-schema`, `server/troubleshooting` |
| 0.3 | For each error: try config, version, init SQL, proxy/session bootstrap, driver, Core flags | `00-doltgres-truth.md` + sql-support refs |
| 0.4 | Write **compat matrix** (works / workaround / blocked) | `BRIVEN-AUTH-DOLTGRES-COMPAT.md` (create when phase starts) |
| 0.5 | **Report to flndrn** with options: A Core on Doltgres ready · B needs X days more · C needs flndrn decision | — |
| 0.6 | Live: Core hello/version/health on France | deployment + live |

**Done when:** Core **healthy on Doltgres** **or** you approve a written exception.  
**Days (focused):** **3–5**  
**Forbidden:** silent switch to native-only.

---

### PHASE 1 — Blank product shell + Core online + wipe old customer Auth

**SuperTokens KB:** platform-configuration, deployment, CDI core hello/version/config  

| ID | Work |
|----|------|
| 1.1 | Core multi-instance on Briven (Doltgres-backed) |
| 1.2 | API keys, base path, SSL/Traefik, IP policy |
| 1.3 | ProjectId → ST appId/tenantId map (hyphen-safe ids) |
| 1.4 | Retire old Better Auth **customer** routes permanently (no dual product) |
| 1.5 | Yellow Auth UI: Core version + “not ready for app login yet” only |
| 1.6 | G-LIVE + G-SEC (no open customer Auth holes) + G-OK |

**Days:** **2–3** after Phase 0 green  

---

### PHASE 2 — Sessions 100% + first-party proxy + SDKs

**SuperTokens KB:** session-management/*, session-verification/*, FDI/CDI session, quickstart FE/BE  

| ID | Work |
|----|------|
| 2.1 | Full session recipe: create, refresh, regenerate, verify, revoke, list |
| 2.2 | Cookie + header modes; app-domain cookies via **mandatory** first-party proxy |
| 2.3 | Protect API / SSR / basic claims |
| 2.4 | `@briven/auth` session wrappers (Briven-branded ST usage) |
| 2.5 | loginmethods + JWKS/OIDC plumbing start |
| 2.6 | G-LIVE on **one** customer app domain + G-SEC + G-OK |

**Days:** **4–6**  
**High value:** session that survives refresh on a real app host  

---

### PHASE 3 — Primary login recipes 100%

**SuperTokens KB:** email-password/*, passwordless/*, social/*, passkeys/*, prebuilt-ui, email/sms delivery  

| ID | Work |
|----|------|
| 3.1 | EmailPassword complete (hash, reset, username option, disable signup, forms/hooks as ST) |
| 3.2 | Passwordless: magic **on app URL**, email OTP, **SMS OTP**, invite/allow-list |
| 3.3 | ThirdParty: all built-ins ST supports that we enable + custom providers; secrets per project |
| 3.4 | WebAuthn complete (register/signin/recover/credentials) |
| 3.5 | Prebuilt UI (Briven theme) for above |
| 3.6 | Email + SMS delivery (Mittera/SMTP/Twilio as platform allows) |
| 3.7 | G-LIVE each method + G-SEC + G-OK |

**Days:** **6–10**  
**High value:** password + magic + Google/GitHub unblocks most apps  

---

### PHASE 4 — MFA + email verify + captcha + attack suite + roles 100%

**SuperTokens KB:** mfa/*, email-verification/*, captcha, attack-protection-suite/*, user-roles/*  

| ID | Work |
|----|------|
| 4.1 | Email verification complete |
| 4.2 | MFA complete (TOTP, secondary factors, backup codes, step-up) |
| 4.3 | Captcha plugins |
| 4.4 | Attack protection suite |
| 4.5 | Roles + permissions + route protection |
| 4.6 | G-LIVE + G-SEC + G-OK |

**Days:** **4–7**  

---

### PHASE 5 — Users + linking + impersonation + dashboard product 100%

**SuperTokens KB:** user-management/*, account-linking/*, dashboard/*, profile/ban/progressive plugins  

| ID | Work |
|----|------|
| 5.1 | Full user management |
| 5.2 | Account linking complete |
| 5.3 | Impersonation + audit |
| 5.4 | Progressive profiling / ban plugins as ST |
| 5.5 | Yellow Briven Auth dashboard = full product control room (users, sessions, tenants, config) |
| 5.6 | G-LIVE + G-SEC + G-OK |

**Days:** **5–8**  

---

### PHASE 6 — Enterprise + OAuth2 IdP + M2M + AI auth 100%

**SuperTokens KB:** enterprise/*, multitenancy, oauth, openid, jwt, m2m, AI auth  

| ID | Work |
|----|------|
| 6.1 | Multitenancy (apps/tenants/domains/assignment) aligned to Briven projects |
| 6.2 | SAML + OIDC enterprise |
| 6.3 | Briven Auth as OAuth2/OIDC provider |
| 6.4 | M2M client credentials |
| 6.5 | AI auth features ST documents |
| 6.6 | G-LIVE + G-SEC + G-OK |

**Days:** **6–12** (heavy; can sequence after apps unblocked if you prioritize)  

---

### PHASE 7 — Migration + bulk import + compatibility 100%

**SuperTokens KB:** migration/*, CDI import/*, updating, compatibility-table  

| ID | Work |
|----|------|
| 7.1 | Account / session / MFA migration |
| 7.2 | Bulk import API complete |
| 7.3 | Import from any legacy Briven Better Auth data if still needed |
| 7.4 | Core ↔ SDK compatibility table for Briven hosts |
| 7.5 | G-LIVE import users can sign in + G-OK |

**Days:** **3–6**  

---

### PHASE 8 — Integrations + plugins + scale + full 492-URL audit

**SuperTokens KB:** all quickstart integrations, remaining plugins, testing-and-debugging, deployment scale  

| ID | Work |
|----|------|
| 8.1 | Framework integrations (Next app+pages, Vercel, Nest, Lambda, GraphQL, Hasura, Netlify, …) |
| 8.2 | Remaining plugins (OpenTelemetry, tenant discovery, …) |
| 8.3 | Full FE/BE override/hook systems |
| 8.4 | Rate limits, multi-instance Core, telemetry |
| 8.5 | API testing + troubleshooting docs |
| 8.6 | **Master parity audit:** every SuperTokens URL area in knowledge-base → **pass / N/A with reason / fail** — fail list must be empty for “100%” |
| 8.7 | G-LIVE + G-SEC full pass + G-OK |

**Days:** **7–14**  

---

### PHASE 9 — App unblocks + sellable Briven product (HIGH VALUE)

**Not optional for your shop.**

| ID | Work |
|----|------|
| 9.1 | Enable Auth + keys + domains for: **mavi pay, handlr, konnos, pando, katsuro** |
| 9.2 | First-party proxy on each app; one happy path login each |
| 9.3 | Billing/metering hooks if required |
| 9.4 | Handoff doc for each app project |
| 9.5 | G-LIVE each app + G-SEC + **you sign “I can code again”** |

**Days:** **3–6** (can start **as soon as Phase 2–3 are green** — parallel track with 4–8 if you OK)

---

## 6. SuperTokens knowledge-base → phase coverage

| knowledge-base.md section | Phases |
|---------------------------|--------|
| Quickstart + integrations | 2, 3, 8 |
| Authentication recipes | 3, 4 |
| Additional verification (MFA, roles, captcha, attack) | 4 |
| Post-authentication (users, dashboard, sessions advanced) | 2, 5 |
| Migration | 7 |
| Platform configuration | 0, 1 |
| Deployment | 0, 1, 8 |
| References FDI/CDI/SDKs/plugins/testing | 2–8 (audit in 8.6) |

| Doltgres knowledge-base section | Phases |
|---------------------------------|--------|
| Introduction / install / getting-started | 0, 1 |
| Concepts git/sql/rdbms | 0, all data work |
| Guides (cheat-sheet, replication-from-postgres) | 0, 1, 8 |
| Reference server/* | 0, 1, 8 ops |
| Reference version-control/* | optional Briven extras; Core DB ops |
| sql-support/* (types, functions, commands, catalog) | **0 every SQL failure** |
| supported-clients, benchmarks | 0, 8 |

---

## 7. Timeline (honest, focused days)

| Block | Days | Cumulative | What you get |
|-------|------|------------|--------------|
| Phase 0 | 3–5 | 3–5 | Core proven on Doltgres or clear decision |
| Phase 1 | 2–3 | 5–8 | Core online product shell |
| Phase 2 | 4–6 | 9–14 | Real sessions + proxy |
| Phase 3 | 6–10 | 15–24 | Main login methods |
| Phase 9 early (apps) | 3–6 | **~18–30** | **You can code on the five apps again** |
| Phase 4 | 4–7 | 22–37 | MFA/security depth |
| Phase 5 | 5–8 | 27–45 | Full dashboard product |
| Phase 6 | 6–12 | 33–57 | Enterprise |
| Phase 7 | 3–6 | 36–63 | Migration |
| Phase 8 | 7–14 | **43–77** | **100% audit green** |

**Calendar reality:** with one focused builder + your OKs, **~6–11 weeks** to claim 100%.  
**High-value unblock (apps login):** aim **~3–4 weeks** after Phase 0 starts (Phases 0–3 + early 9).

If Core cannot run on Doltgres after Phase 0: **stop and ask you** — options only with your OK (not silent native rewrite).

---

## 8. Definition of “100% feature-to-feature SuperTokens”

All of the following true:

1. SuperTokens Core is the recipe brain (not a dead dependency).  
2. Every SuperTokens product area in `knowledge-base.md` SuperTokens list is **Pass** or **N/A (documented why, you agreed)**.  
3. Fail list for Phase 8.6 is **empty**.  
4. Doltgres is the storage/hosting plane for Auth data (DOLTGRES-FIRST).  
5. Live tests + security smokes exist for each phase.  
6. **You** sign: *“Briven Auth is complete SuperTokens functionality for me.”*  
7. The five apps can log in and you can keep coding.

---

## 9. What we discard / quarantine (when you OK Phase 1)

- Treating **native briven-engine** as “SuperTokens Path A” (it is not SuperTokens).  
- Leaving dual product doors (old Better Auth customer enable vs new Core) without clear routing.  
- Claiming phase done without G-LIVE / G-SEC / G-OK.

Native code may be **reference or temporary bridge only** if you approve — never the silent final product under a SuperTokens label.

---

## 10. Start sequence (nothing runs until you pick)

Reply with one:

| Code | Meaning |
|------|---------|
| **START-0** | Begin **only Phase 0** (Core on Doltgres spike + report; no further without OK) |
| **START-0+1** | Phase 0 then 1 after your OK on 0 report |
| **PAUSE** | Plan only; no work |

---

## 11. Standing promise

I will **not** build, wipe, deploy, or change Auth architecture without:

1. Naming the phase  
2. Telling you what I will do  
3. Waiting for your OK  

Libraries for every stuck moment:
- SuperTokens: `knowledge-base.md` (top)  
- Doltgres: `knowledge-base.md` (bottom, www.doltgres.com) + `AI_DOCS/dolt-reference/`  

---

*End of plan.*
