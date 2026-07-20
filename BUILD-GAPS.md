# Briven — master gap list (single source of truth)

**Rule:** one ordered queue. Work **top → bottom**.  
**Do not re-prove** what is already shipped (Auth day-to-day, project create, SCIM/SSO pack, CLI-auth page fix).  
**Status is only Done / Not done / Blocked (human).**

**Updated:** 2026-07-19  
**Live API tip (check anytime):** `curl -sS https://api.briven.tech/info`

---

## How to use this file

1. Find the first **Not done** or **Blocked** row that is not blocked on flndrn.  
2. Build or wire **only that row**.  
3. Mark **Done** with one-line proof.  
4. Never reopen Phase N+1 features until Phase N is **Done**.

---

## Queue (build / close in this order)

### Wave 0 — CLI that people actually type (product path)

| ID | Task | Status | Notes / proof |
| --- | --- | --- | --- |
| **G0.1** | `briven setup` on your Mac PATH | **Done** | Installed workspace CLI **0.3.2** globally. `briven --help` lists `setup`. |
| **G0.2** | `briven setup <projectname>` (positional name) | **Done** | Bare arg = new name; `p_…` = attach existing. Tests pass. |
| **G0.3** | `briven setup --project …` + `briven connect` | **Done** | On PATH after G0.1. |
| **G0.4** | Project S3 as **required** part of setup | **Done** | `briven setup` always mints bucket+key and writes `.env.local` (fails setup if storage fails). Dashboard create also mints default key. |

**Out of this wave:** re-testing “can create a project in the dashboard” — already proven.

---

### Wave 1 — Phase 0 foundations (platform ops)

Source: `PHASE-0.md` · handoff `infra/backups/BACKUP-OFFSITE.md`.

| ID | Task | Status | Who |
| --- | --- | --- | --- |
| **0.1** | Off-site backup (R2/B2) + successful upload | **Blocked (human)** | flndrn sets up bucket; four `BRIVEN_BACKUP_S3_*` keys. Local dump + timer already OK. |
| **0.2** | Discord ops webhooks (alerts / deploys) | **Deferred — not a build gate** | **Why it was ever listed:** optional “pager” for ops (backup failed / deploy noise) into a chat channel — **not a product feature for customers**. flndrn 2026-07-20: do not care / do not block. Alerts path already works if wanted later; deploys URL can rot. |
| **0.3** | Trademark | **Deferred** | **Not a build gate**. Legal later. |
| **0.4** | Phase 0 sign-off ADR | **Not done** | After **0.1** only. |

---

### Wave 2 — Storage “built → proven live”

Source: `STORAGE-ACCEPTANCE.md`. Code largely shipped; **acceptance** open.

| ID | Task | Status | Who |
| --- | --- | --- | --- |
| **S.M1** | Per-project bucket + scoped key isolation | **Not done** (proof) | Agent can drive API/MCP after keys; flndrn sign-off. |
| **S.M2** | Quota / unify / soft-delete undo | **Not done** (proof) | Same. |
| **S.M3** | `media.briven.tech` public delivery | **Not done** | May need Dokploy domain wire if not already. |
| **S.M4** | imgproxy transform URLs | **Not done** (proof) | Container present on France; verify env. |
| **S.M5** | MCP storage tools isolation | **Not done** (proof) | |
| **S.M6** | Dogfood (e.g. Mavi Pay) + flndrn sign-off | **Blocked (human)** | |

---

### Wave 3 — Auth product claim (not feature build)

Source: `sprint_plan.md` § human. **No new Auth features.**

| ID | Task | Status | Who |
| --- | --- | --- | --- |
| **A.1** | AUTH-GO-LIVE 1–4 + 7 on one pilot project | **Blocked (human)** | Browser fire drill once. |
| **A.2** | Second-project isolation check | **Blocked (human)** | Script ready: `scripts/auth-isolation-check.sh`. |
| **A.3** | “Friends can use this” sign-off | **Blocked (human)** | `sprint_plan.md` §8. |

**Already Done — do not rebuild:** email/password, OAuth, magic link, OTP, passkeys, TOTP, backup codes, devices, account linking, password policy, rate limits (Redis), SCIM, SAML/OIDC, compliance pack, enterprise dashboard tab, auth-pilot docs.

---

### Wave 4 — Remaining Auth polish gaps (only if still real)

Source: `build_plan.md` — **re-audited 2026-07-19**. Stale “Pending” rows that already have code are **Done**.

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| **7.1** | Custom JWT claims / templates | **Not done** | Not built as first-class templates. |
| **7.2** | Profile image / avatar upload | **Not done** | Verify vs me avatar; may be partial. |
| **7.3** | Username authentication | **Not done** | Optional product decision. |
| **7.4** | Testing tokens (E2E) | **Not done** | Partial env-gated tests only. |
| **7.5** | Email template customization (tenant HTML) | **Not done** | Branding exists; full HTML templates unclear. |
| **8.1–8.4** | Backup codes, devices, account linking, password policy | **Done** | Code under `apps/api/src/services/auth-*`. |
| **9.x** | SCIM + sales kit | **Done** | See `docs/ENTERPRISE-PACK.md`. |
| **G15** | GDPR data export endpoint | **Not done** | Confirm vs delete-only paths. |
| **G16** | React `useUserMetadata` / `useUserEmails` | **Not done** | Verify packages/sdk. |
| **G-pricing** | Per-connection SSO pricing hooks | **Not done** | Explicitly sales/metering later. |

**SMS OTP:** never — out of scope forever for this program.

---

### Wave 5 — Platform / ops hygiene (non-feature)

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| **O.1** | Stop Dokploy full-stack thrash (stacked `up --build`) | **Not done** | Keeps killing API/web. Prefer web/api only deploys; keep autoDeploy false. |
| **O.2** | Traefik multi-service warning on `briven-api` labels | **Not done** | Noisy; routing works when API is up. Clean labels when touching compose. |
| **O.3** | Disk headroom on France (~85% used) | **Not done** | Prune build cache when safe. |

---

### Wave 6 — Explicitly deferred (do not start)

- Pixel-perfect Clerk UI  
- Pure Auth SaaS outside Briven  
- Phase 1+ “MVP engine” features from archived road-to-ga until Phase 0 is **Done**  
- Cross-project storage read-GRANTs (security-sensitive; separate design)

---

## Currently working

| Now | Task |
| --- | --- |
| **→** | **0.1** — wait for flndrn S3 bucket keys (only Phase 0 engineering gate left). Agent without wait: **O.1** thrash / **S.M\*** proofs. |

**Closed / deferred:** G0 CLI; Discord ops (0.2) not a gate; trademark (0.3) not a gate; Auth enable fixed.

---

## Proven — never re-open as “build”

| Area | Proof standard met |
| --- | --- |
| Project create / list / dashboard | Prior sprints + live app |
| Briven Auth core + S6 reliability | `docs/CLERK-GAP-EVIDENCE.md` soft gaps Done |
| Enterprise SCIM/SSO/compliance UI | `docs/ENTERPRISE-PACK.md` |
| CLI-auth allow page | Commit `34371c8`; unauth → sign-in |
| Git main = GitHub = Konnos | Same tip when last dual-pushed |

---

*This file replaces thrash. Update status here when a row closes — not in chat memory alone.*
