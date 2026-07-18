# Sprint Plan: Close the Clerk Gap — Trustworthy Briven Auth

**Date:** 2026-07-18  
**Owner:** Briven Auth  
**Status:** Planning — **do not implement until flndrn agrees**

---

## 1. What this plan is (plain words)

You asked for a **sprint plan** so Briven Auth becomes a product people can **rely on** — not just “has a long feature list,” but:

- Sign-in works every day  
- People don’t get locked out of their own accounts  
- Bad actors are slowed down  
- Admins can fix problems  
- Agents and humans can set it up without guessing  
- We can prove it in a browser, not only in CI  

**Clerk** is the comparison target (the well-known login product). We match what matters for trust; we do **not** clone Clerk’s UI or add SMS.

---

## 2. Who this is for / not for

| For | Not for |
| --- | --- |
| Real apps on Briven that need email/password, social, passkeys, 2FA | Replacing Clerk for companies that only want a standalone auth SaaS with no Briven DB |
| Founders / agents shipping a pilot that must not break login | SMS phone codes (explicitly out of scope forever in this plan) |
| Closing **trust** and **parity** gaps that block “we’d put customers on this” | Open-ended polish with no verification |

**Success looks like:** a non-engineer can complete `AUTH-GO-LIVE-CHECKLIST.md` on a pilot project **and** the remaining “would Clerk save me here?” moments (lost 2FA phone, new laptop email, password force-reset, GDPR export) work without support heroics.

**Out of scope:** SMS OTP; redesigning Briven’s look to match Clerk; rewriting auth off better-auth.

---

## 3. Honest baseline (2026-07-18)

Older plans mark many items “Pending.” A code scan shows a lot of that work **already exists in the repo**. The real problem is often **finish + prove + ship**, not invent from zero.

### 3.1 Already in code (treat as “build complete — prove live”)

| Area | Evidence in repo | Clerk equivalent |
| --- | --- | --- |
| Email + password, magic link, OTP, OAuth, passkeys, 2FA (TOTP) | Tenant pool + plugins | Core sign-in |
| JWT claims + named templates | `auth-jwt-templates.ts`, SDK `jwt.getToken` | Custom JWT |
| Username sign-in | `auth-usernames.ts`, SDK `signIn.username` | Username login |
| Avatar upload | SDK avatar presign/update routes | Profile image |
| Testing tokens (E2E) | `auth-test-tokens.ts`, `/test-token` | Testing tokens |
| Email template overrides | `auth-email-templates.ts` | Email customization |
| Account linking (auto on same email) | `auth-account-linking.ts` | Account linking |
| Device / new-device alert hooks | `auth-device-tracking.ts` wired in session create | Device alerts |
| Rate limit Redis + memory fallback | `auth-rate-limit.ts`; prod `/ready` → `redis: ok` | Rate limiting |
| Password policy tables + routes | `auth-password-policy.ts` | Password policy |
| Backup codes (schema + SDK UI surface) | Better Auth `backupCodeOptions`, SDK generate/verify | 2FA backup codes |
| React metadata/email hooks | `useUserMetadata`, `useUserEmails` in `@briven/auth/react` | React DX |
| GDPR export service | `auth-gdpr-export.ts` | Data export |
| Go-live checklist + agent path | `AUTH-GO-LIVE-CHECKLIST.md`, skill `briven-auth`, `examples/auth-pilot` | Onboarding |

### 3.2 Still weak / unproven (this plan’s real work)

| Gap | Why users can’t “rely” yet | Severity |
| --- | --- | --- |
| **End-to-end proof** | Checklist not signed off; features may exist but never proven on prod project | **Critical** |
| **2FA backup codes end-to-end** | Schema/SDK exist; risk of half-wired enroll / recover / regenerate UX | **Critical** |
| **Device tracking end-to-end** | Service exists; may be incomplete table/fingerprint/email path | **Critical** |
| **Password policy enforcement** | Tables/routes exist; force-reset / history on live sign-in may be incomplete | **High** |
| **Account linking edge cases** | Auto-link exists; manual link + admin repair + “two people same email” policy | **High** |
| **Security polish from gap audit** | Email normalize, DNS domain verify, SAML RelayState, publicKey scopes, admin session revoke | **High** |
| **Auth unit tests + better-auth upgrade deploy** | Local fixes done; **not all shipped** to production | **Critical** |
| **OIDC enterprise flow** | Claimed incomplete vs “table only” in older audits — re-verify | **High** (enterprise) |
| **SCIM** | No real product yet | **Later** (enterprise only) |
| **Trust surface** | Uptime, incidents, status page clarity, “what if auth is down” | **High** |
| **Agent / docs truth** | Docs and skills must match what is actually live | **Medium** |

### 3.3 Explicit non-goals (do not schedule)

- SMS OTP  
- Pixel-perfect Clerk components  
- Competing with Clerk as a pure standalone auth company outside Briven  

---

## 4. Guiding principles for every sprint

1. **Trust before trophy features.** If it can lock a real user out or leak a session, it ships before “nice to have.”  
2. **Code is not done until proven.** Unit test + one browser (or scripted) path + note in checklist.  
3. **Ship in batches.** Group related auth changes → one deploy (don’t thrash prod).  
4. **Hot zone.** Auth/sessions/keys/Redis: explain blast radius, get OK before prod write.  
5. **No secret pasting** in chat; rotate if leaked.  
6. **Preserve Briven UI** (`briven-auth-*` classes).  
7. **DoltGres:** prefer new auxiliary tables / safe migrations; don’t casually ALTER auth core tables.  

---

## 5. Sprint map (overview)

| Sprint | Name | Goal (plain) | Rough length | Depends on |
| --- | --- | --- | --- | --- |
| **S0** | Baseline & ship | Know truth; land current auth fixes on prod | 2–4 days | — |
| **S1** | Never lock out | 2FA backup codes + password recovery solid | 1–1.5 weeks | S0 |
| **S2** | Suspicious access | Devices, new-device email, session admin tools | 1 week | S0 |
| **S3** | Policy & identity | Password policy live; linking edges; email normalize | 1–1.5 weeks | S1 |
| **S4** | Hardening audit | Domain DNS, SAML RelayState, key scopes, rate-limit proof | 1 week | S0–S2 |
| **S5** | DX & agents | Docs, SDK polish, test tokens, pilot green | 1 week | S1–S4 |
| **S6** | Reliability bar | Load/abuse, monitoring, go-live sign-off | 3–5 days | S1–S5 |
| **S7** | Enterprise later | OIDC complete, SCIM, compliance pack | 2–3 weeks | S6 |

**Default recommendation:** finish **S0 → S6** before any sales claim of “Clerk-level reliability.” **S7** only when an enterprise deal needs it.

---

## 6. Sprint detail

### S0 — Baseline & ship (foundation)

**Why:** Working code on laptop ≠ users relying on it. Production still needs the readiness bar landed.

| # | Work | Why | Verify |
| --- | --- | --- | --- |
| S0.1 | Inventory gap table (this doc §3) vs `main` vs **deployed** sha | No double-build | Diff `api.briven.tech/info` buildSha vs git |
| S0.2 | Commit/push auth unit fixes + better-auth ≥1.6.11 + encrypt-at-rest keys + platform `:ref` auth | Security/foundation already fixed locally | Auth unit tests green; CI scoped gates green |
| S0.3 | Deploy API (batch) | Users get the fixes | `/ready` ready; redis ok; boot time new |
| S0.4 | Run `AUTH-GO-LIVE-CHECKLIST.md` on **one pilot project** | Human proof | Sign-off rows 0–4 + 7 |
| S0.5 | Mark each §3.1 feature **Live / Partial / Broken** after pilot | Honest backlog for S1+ | Updated status table in this file |

**Definition of done:** pilot project signs in on production build; checklist partial sign-off; backlog for S1–S6 is fact-based.

---

### S1 — Never lock out (2FA + recovery)

**Why:** Clerk’s biggest “I trust them” moment: lose phone → still get in with backup codes. Without this, 2FA is a liability.

| # | Work | Why | Verify |
| --- | --- | --- | --- |
| S1.1 | Audit backup codes path end-to-end (enroll MFA → show 10 codes once → store hashed → verify once → burn) | May be partial today | Unit + manual |
| S1.2 | Dashboard: download/print codes on enroll; regenerate invalidates old | Admin UX | Browser |
| S1.3 | Hosted / SDK sign-in: “use backup code” when TOTP required | Recovery UX | Browser |
| S1.4 | Password reset still works with MFA on | Don’t trap users | Browser |
| S1.5 | Docs + checklist section “lost authenticator” | Humans know the path | Doc review |

**Definition of done:** test user with MFA can recover with a backup code; regenerate works; no plaintext codes in DB/logs.

---

### S2 — Suspicious access (devices + sessions)

**Why:** Users trust products that notice “new computer” and let them kill sessions.

| # | Work | Why | Verify |
| --- | --- | --- | --- |
| S2.1 | Finish device fingerprint storage (`_briven_auth_devices` or equivalent) if incomplete | Dead code → real | Unit + DB row after sign-in |
| S2.2 | New-device email actually sends (template + mailer) | Alert is the product | Receive email |
| S2.3 | User: list sessions / revoke; Admin: revoke one session for a user | Clerk-class control | API + browser |
| S2.4 | Optional: show last devices in dashboard user drawer | Ops | UI smoke |

**Definition of done:** new browser triggers email once; admin can kill a specific session; old device still works until revoked.

---

### S3 — Policy & identity (password + linking)

**Why:** Orgs need “force password change”; users need one identity across Google + password.

| # | Work | Why | Verify |
| --- | --- | --- | --- |
| S3.1 | Password policy live: max age, force reset flag, optional history (no re-use last N) | Clerk policy | Sign-in blocked until reset |
| S3.2 | Admin API + dashboard toggle for policy | Ops | Config round-trip |
| S3.3 | Account linking: auto (same verified email) + manual link/unlink + admin merge tool | Avoid duplicate users | Cases matrix |
| S3.4 | Email normalization for gates (Gmail dots / `+` tags) where intended | Blocklist bypass | Unit tests |
| S3.5 | Clear error copy when link is refused | Support load | UI |

**Definition of done:** policy can force reset; two OAuth providers → one user when email matches; malicious `user+x@gmail` doesn’t dodge blocklist if configured.

---

### S4 — Hardening audit (security trust)

**Why:** Reliability is also “attackers don’t get free wins.”

| # | Work | Why | Verify |
| --- | --- | --- | --- |
| S4.1 | Org domain verification via DNS TXT (not “trust the form”) | B2B spoofing | Real DNS or mocked resolver test |
| S4.2 | SAML RelayState allowlist vs app origins | Open redirect | Negative test |
| S4.3 | Enforce SDK public key **scopes** on auth-tenant routes | Key least privilege | read key can’t do admin-ish actions |
| S4.4 | Re-prove Redis rate limits under burst (auth endpoints) | Prod redis ok ≠ limits wired | Scripted 429s |
| S4.5 | OIDC enterprise start/callback: complete or document “SAML only for now” | No false enterprise claims | Integration or explicit defer |
| S4.6 | Secrets: key reveal audited; no key in logs | Compliance | Grep + audit row |

**Definition of done:** security checklist in this section all green or explicitly deferred with reason.

---

### S5 — DX & agents (setup trust)

**Why:** A strong product people can’t set up is not strong.

| # | Work | Why | Verify |
| --- | --- | --- | --- |
| S5.1 | Docs auth page matches live features (backup codes, policy, devices) | No lying docs | Human pass |
| S5.2 | `briven auth scaffold` + `examples/auth-pilot` + skill stay aligned | Agents | Scaffold dry-run |
| S5.3 | Testing tokens: dashboard create + CI example | E2E without MFA hell | Token signs in once |
| S5.4 | React/Vue/Svelte parity notes (metadata hooks already exist — document) | DX | SDK smoke |
| S5.5 | MCP `auth_docs_ask` answers cover S1–S4 topics | Agents | Sample Qs |

**Definition of done:** new agent following `briven-auth` skill can stand up pilot without inventing off-platform auth.

---

### S6 — Reliability bar (rely-on moment)

**Why:** This is the gate for “users can rely on it.”

| # | Work | Why | Verify |
| --- | --- | --- | --- |
| S6.1 | Full `AUTH-GO-LIVE-CHECKLIST.md` sign-off on pilot + one second project | Multi-tenant isolation | Two projects isolated |
| S6.2 | Chaos lite: kill Redis briefly → fail-open/closed documented; recover | Ops clarity | Observed behavior notes |
| S6.3 | Metrics/alerts: auth 5xx, rate-limit spikes, mailer failures | See pain early | Dashboard or log query |
| S6.4 | Status/comms: what customers see if auth degrades | Trust | Draft status blurb |
| S6.5 | Freeze: changelog “Auth reliability” release notes | Users know | Public notes |
| S6.6 | Update `build_plan.md` statuses to match reality | Stop plan rot | Doc PR |

**Definition of done (product claim allowed):**

- [ ] S0–S5 DoD met  
- [ ] Checklist fully signed for pilot  
- [ ] No open **Critical** items  
- [ ] Owner (flndrn) says “yes, friends can use this”  

---

### S7 — Enterprise later (only when needed)

**Why:** SCIM and full IdP automation are Clerk Enterprise territory. Don’t block consumer/SaaS trust on them.

| # | Work | Notes |
| --- | --- | --- |
| S7.1 | SCIM 2.0 Users CRUD + bearer tokens | Big companies only |
| S7.2 | SCIM Groups → org roles | |
| S7.3 | Compliance pack (DPA, retention docs, subprocessor list) | Sales enablement |
| S7.4 | Per-SSO-connection metering/billing hooks | If monetization needs it |

**Start S7 when:** a real lead requires SCIM **or** S6 is green and capacity remains.

---

## 7. Priority if time is short (80/20)

If only **two weeks** of focus exist after S0:

1. **S1** backup codes (lockout = product death)  
2. **S2.3** session revoke (admin safety)  
3. **S4.4** rate-limit proof  
4. **S6.1** full checklist  

Defer username polish, avatar cosmetics, SCIM, and UI chrome.

---

## 8. Verification standard (every sprint)

Before marking a sprint done:

| Check | Required |
| --- | --- |
| Unit tests for new logic | Yes |
| Typecheck `@briven/api` + `@briven/auth` | Yes |
| At least one **browser** path (or recorded script) | Yes for user-facing |
| Prod deploy only after batch + flndrn OK (auth hot zone) | Yes |
| Update this plan’s status table | Yes |
| No secrets in git or chat | Yes |

---

## 9. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| “Done in code” but broken in prod | S0 inventory + checklist |
| better-auth upgrade surprises | Pin version; run auth tests; canary one project |
| Mailer flaky → no recovery emails | Fallback sender already; monitor delivery |
| Scope creep toward full Clerk clone | Enforce non-goals; 80/20 list |
| Deploy thrash | One auth deploy per sprint batch |

---

## 10. How this relates to existing docs

| Doc | Role |
| --- | --- |
| `build_plan.md` | Long-term phase history + feature encyclopedia — **update after each sprint** |
| `sprint_plan.md` (this file) | **Active** trust-first execution plan |
| `AUTH-GO-LIVE-CHECKLIST.md` | Human proof harness for S0/S6 |
| `.claude/skills/briven-auth` | Agent setup path (S5) |
| `examples/auth-pilot` | Minimal wiring reference |

---

## 11. Decision needed from flndrn

Please pick one so build can start:

| Option | Meaning |
| --- | --- |
| **A (Recommended)** | Approve **S0 → S6** as the reliability program; start with **S0** (inventory + ship current fixes + pilot checklist) |
| **B** | Only **S0 + S1 + S6** (minimum “won’t lock people out + proven”) |
| **C** | Jump to enterprise (**S7**) first — only if a deal requires SCIM now |

Reply with **A**, **B**, or **C** (or changes). **No feature coding under this plan until you choose.**

---

## 12. Status board (update as we go)

| Sprint | Status | Notes |
| --- | --- | --- |
| S0 Baseline & ship | **Mostly done** | Prod API + auto-deploy fixed. **Human:** still finish browser checklist when ready. |
| S1 Never lock out | **Done (code)** | verify-totp path, hosted backup UI, React challenge, tests. Deployed via auto-deploy. |
| S2 Suspicious access | **Done (code)** | Devices + session list/revoke APIs; fingerprint tests; new-device email path already wired. CI overall green again. |
| S3 Policy & identity | **Done (code)** | Password complexity/reuse/expiry + force-reset; Gmail-normalized auto-link; admin unlink; tests. |
| S4 Hardening | Pending | |
| S5 DX & agents | Pending | Skill + pilot + checklist already in `05acab3` |
| S6 Reliability bar | Pending | |
| S7 Enterprise | Deferred | |

### S0 evidence log

| Check | Result |
| --- | --- |
| Prod before | `buildSha` `cebbb2c…`, redis ok |
| Commit | `05acab3` — auth readiness + sprint plan A |
| Push | `main` → `origin/main` |
| GH Deploy workflow | Failed HTTP 301 / `Branch Not Match` (webhook payload) |
| Manual deploy | France `187.124.64.116` pull + `docker compose build/up api` |
| Prod after | API container healthy; confirm `/info` sha = `05acab3…` |
| Auth unit tests | 30 pass (tenant plugins, sdk keys, platform-auth) |
| Human checklist | **Your turn** — `AUTH-GO-LIVE-CHECKLIST.md` |

---

*End of plan. Implementation starts only after explicit approval of option A/B/C (or a written variant).*
