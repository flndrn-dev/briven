# Handoff: Briven Auth + project S3 for other projects

**Who this is for:** you (flndrn) and any agent working on **another app** (konnos, mavi-pay, etc.) **after** Briven product Auth + project S3 are in order.  
**Who this is not for:** platform off-site database backup (Phase 0.1) — that stays **out of** this handoff forever; do it later as owner ops.

**Date:** 2026-07-20  
**Platform:** live at `https://api.briven.tech` · dashboard `https://briven.tech`

---

## Release gate (when may other projects use this?)

**Handoff is only “open” when both product tracks below are OK.**  
Platform backup (Phase 0.1) is **not** part of the gate.

| Gate | Meaning | Status to flip handoff OPEN |
| --- | --- | --- |
| **Briven Auth** | Other apps can sign users up/in with `pk_briven_auth_…` + `@briven/auth` | Human go-live on one pilot (checklist 1–4 + 7) **and** live API healthy |
| **Briven project S3** | Each project has own endpoint/bucket/key; dashboard mint works | Per-project keys + isolation proven (see `STORAGE-ACCEPTANCE.md` / product path) |
| **Not required** | Off-site control-plane backup to R2/B2/AWS | Explicitly **deferred** — do not block other projects on this |

**Current rule (flndrn 2026-07-20):** treat this file as the **future handoff package**.  
**Do not** send other projects off to integrate until you (or a Briven session) mark the gate **OPEN** below.

### Gate status

| Item | Status |
| --- | --- |
| Auth product path | **Pending final OPEN** — engineering largely ready; confirm live checklist + any pending deploy of latest Auth-related code if needed |
| Project S3 product path | **Pending final OPEN** — product mint/isolation proven in session; confirm live dashboard still good |
| Platform backup 0.1 | **Out of scope for handoff** (deferred) |
| **Handoff to other projects** | **CLOSED until Auth + S3 both marked OPEN** |

When both are ready, change the last row to **OPEN — other projects may follow §7 prompt** and tell flndrn.

---

## 1. Plain picture (read this first)

| Piece | What it is | Example |
| --- | --- | --- |
| **Project** | One app’s space on Briven | `p_01…` |
| **Auth on** | Sign-in turned on for that project | Dashboard → project → **Auth** → Enable |
| **Front-door key** | Browser-safe key for login | `pk_briven_auth_…` only |
| **Server key** | Machine-only key for data/API | `brk_…` — **never** in the browser |
| **SDK** | JS package apps use | `@briven/auth` |
| **Sessions** | Cookies set by Briven (httpOnly) | Not “token in localStorage” |

**Project Storage keys** (`s3.briven.tech`, `proj-…`, `brvn…`) are for **files**, not login. Do not mix them with Auth keys.

**Platform backup (Phase 0.1)** is deferred — not needed to wire Auth in other apps.

---

## 2. What changed / what to assume (2026-07)

Engineering for beta Auth is largely **done**. Product claim still has optional human checks (isolation, friends).

**Use this path — do not invent Clerk or a side auth server:**

1. Briven project exists  
2. Auth enabled in dashboard  
3. Create `pk_briven_auth_…` (scope **read-write** for full sign-in)  
4. App installs `@briven/auth` and points at `https://api.briven.tech`  
5. Optional: `briven auth scaffold` for Next.js middleware + `lib/auth.ts`  
6. Optional: project **Storage** keys if the app needs file uploads  

**CLI (new vs existing project):**

```bash
briven setup my-app          # brand-new Briven project + S3 + wire folder
briven connect p_01…         # attach an existing project + S3 + wire folder
briven auth scaffold         # Next-style auth files (after project is linked)
```

(`briven connect` alone is no longer “login only” — it attaches an **existing** project. Platform login is part of setup/connect.)

---

## 3. Env vars every other project needs

Put in **that app’s** `.env.local` (never commit real keys):

```bash
NEXT_PUBLIC_BRIVEN_API_ORIGIN=https://api.briven.tech
NEXT_PUBLIC_BRIVEN_PROJECT_ID=p_YOUR_PROJECT_ID
NEXT_PUBLIC_BRIVEN_AUTH_KEY=pk_briven_auth_YOUR_KEY
BRIVEN_AUTH_PUBLIC_KEY=pk_briven_auth_YOUR_KEY
```

Same `pk_briven_auth_…` value in both auth key lines is normal.

**If the app needs files too:**

```bash
# From dashboard → Storage → new key (shown once)
BRIVEN_STORAGE_ENDPOINT=https://s3.briven.tech
BRIVEN_STORAGE_BUCKET=proj-…
BRIVEN_STORAGE_ACCESS_KEY=brvn…
BRIVEN_STORAGE_SECRET_KEY=…   # only at mint time
```

---

## 4. Minimal code pattern

```ts
// lib/auth.ts
import { createBrivenAuth } from '@briven/auth';

export const auth = createBrivenAuth({
  projectId: process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID!,
  publicKey: process.env.NEXT_PUBLIC_BRIVEN_AUTH_KEY!, // pk_briven_auth_…
});
```

**Fastest UI:** send users to hosted sign-in:

```ts
window.location.assign(auth.hostedPageURL('sign-in', '/dashboard'));
```

**React:** `@briven/auth/react` → `BrivenAuthProvider`, `BrivenSignIn`, `useSession`, `TwoFactorChallenge` if 2FA is on.

**Next proxy:** `briven auth scaffold` writes middleware that forwards `/api/auth/*` to Briven with the public key. Copy pattern from `examples/auth-pilot/`.

---

## 5. Human steps in the dashboard (once per project)

1. Open [briven.tech](https://briven.tech) → your project.  
2. **Auth** → **Enable Auth** if needed.  
3. **Auth → API keys** → Create → name e.g. `pilot web` → scope **read-write**.  
4. Copy `pk_briven_auth_…` immediately into the app’s env.  
5. Optional: enable only the providers you show in the app (email/password is enough for pilot).  
6. Smoke test: sign up, sign out, sign in, wrong password (see `AUTH-GO-LIVE-CHECKLIST.md` rows 3–4).

---

## 6. Security rules (do not break)

| Do | Don’t |
| --- | --- |
| Only `pk_briven_auth_…` in browser / `NEXT_PUBLIC_*` | Put `brk_…` in client code |
| Cookies + `credentials: 'include'` | Put sessions in localStorage as the main plan |
| One Briven project per app (or clear multi-tenant design) | Share one auth key across unrelated apps without thinking |
| Revoke a key if it leaked in chat/screenshots | Paste full secrets into git or public tickets |

---

## 7. Copy-paste prompt for another project’s agent

**Only use this section when the Release gate above says OPEN.**  
If the gate is CLOSED, stop and work in a Briven session first — do not partially wire other apps.

```
Briven handoff is OPEN for Auth + project S3 only (not platform backup).

Read: https://docs.briven.tech/auth
and Briven repo HANDOFF-AUTH-FOR-OTHER-PROJECTS.md (gate must say OPEN).

For this app:
1. Briven project id (p_…) via `briven setup` (new) or `briven connect p_…` (existing).
2. Dashboard: Auth enabled; create pk_briven_auth_… (read-write). Never put brk_ in the browser.
3. Install @briven/auth; Next: `briven auth scaffold` + examples/auth-pilot pattern.
4. Env Auth: NEXT_PUBLIC_BRIVEN_API_ORIGIN=https://api.briven.tech,
   NEXT_PUBLIC_BRIVEN_PROJECT_ID, NEXT_PUBLIC_BRIVEN_AUTH_KEY, BRIVEN_AUTH_PUBLIC_KEY.
5. If the app needs files: dashboard Storage → mint key; BRIVEN_STORAGE_* / AWS_* in .env
   (s3.briven.tech + proj-… bucket). Not the same as Auth keys.
6. Do NOT set up Phase 0.1 platform off-site DB backup. Do NOT edit the Briven monorepo
   from this project session.
```

---

## 8. Deeper links (when you need detail)

| Need | Where |
| --- | --- |
| Human click checklist | `AUTH-GO-LIVE-CHECKLIST.md` |
| Tiny pilot app | `examples/auth-pilot/` |
| Agent skill | `.claude/skills/briven-auth/SKILL.md` |
| Reliability / ops probes | `docs/S6-RELIABILITY.md`, `scripts/s6-auth-verify.sh` |
| Isolation (project A ≠ B users) | `scripts/auth-isolation-check.sh` |
| Docs site | https://docs.briven.tech/auth · https://docs.briven.tech/connect |
| Master queue | `BUILD-GAPS.md` |

---

## 9. Deferred on purpose (do not block other projects)

- Phase **0.1** off-site control-plane backup (R2/B2/AWS) — after Auth + product S3 are settled  
- Auth isolation second-project proof / “friends can use this” product claim — human when ready  
- Full Clerk UI clone — never the goal  

---

*If something in this handoff conflicts with live dashboard labels, trust the dashboard and update this file in a dedicated Briven session.*
