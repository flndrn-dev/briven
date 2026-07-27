# Session resume — Auth / mavi / handoffs

**Saved:** 2026-07-27 (end of session)  
**Workspace:** Briven platform + mavi pay (+ Pando handoffs)  
**Owner:** flndrn  

**Start here next time.** Read this file first, then continue.

---

## One-line status

**Mavi pay production login works:** magic link · email OTP · Konnos OAuth.  
**Paused on purpose:** passkeys retest · SMS/Twilio (US address / compliance).  
**Do not claim 100% SuperTokens** — overall ~80–85% surface, ~90%+ day-to-day login.

---

## Projects & IDs

| Project | Path | Notes |
|---------|------|--------|
| Briven platform | `/Users/flndrn/Desktop/briven` | Auth engine; France `187.124.64.116` compose `briven-brivenfrance-uilsk6` |
| Mavi pay | `/Users/flndrn/Desktop/mavi-pay` | Live `https://pay.mavifinans.sh` · Briven project `p_01KWQ37MSQPAZNQCTESBV370NM` |
| Pando | `/Users/flndrn/Desktop/pando` | Project `p_01KWF6KB8G7AT5TE016BYX1X19` · Auth still stub in app |

---

## Guided test scoreboard (the “6”)

| Step | Topic | Status |
|------|--------|--------|
| 1–3 | Setup / ready | Done earlier |
| **4** | Magic link · email code · Konnos | **PASS** (user proved) |
| **5** | Passkeys | **PAUSED** — first-time UX improved; full enroll→signin retest not closed |
| **6** | SMS / Twilio | **PAUSED** — US number `+19382533203`; needs US address / A2P path or different provider later |

**Use in production without 5–6:** magic + email OTP + Konnos.

---

## What shipped this arc (high level)

### Briven
- Konnos OAuth → `konnos.org` (not code.konnos.org)
- Passwordless emails: project brand name, magic-link **button**, OTP without extra magic link
- Auth emails: Platform / device location / time (Europe/Brussels)
- Passkey **rpId** from app host (`pay.mavifinans.sh`), not hard-coded `briven.tech`
- M2M handoff for all projects
- Soft-disable, providers revoke, etc. from earlier in chain

### Konnos (product OAuth)
- Empty `code_challenge` no longer breaks token exchange (PKCE false fail)

### Mavi
- First-party FDI proxy, Konnos callback `/auth/callback`
- Transparent Konnos logo
- Passkey first-time copy + post-login “Add passkey” prompt (deployed; retest open)

### Docs / handoffs
| Doc | Path |
|-----|------|
| **This resume** | `docs/SESSION-RESUME-2026-07-27-AUTH.md` |
| SuperTokens parity matrix | `docs/AUTH-SUPERTOKENS-PARITY-MATRIX.md` |
| M2M all projects | `docs/HANDOFF-AUTH-M2M-FOR-ALL-PROJECTS.md` |
| Auth for any app | `docs/HANDOFF-AUTH-FOR-OTHER-PROJECTS.md` |
| Pando Auth handoff | `/Users/flndrn/Desktop/pando/docs/HANDOFF-BRIVEN-AUTH-FOR-PANDO.md` |
| Pando M2M pointer | `/Users/flndrn/Desktop/pando/docs/HANDOFF-BRIVEN-M2M.md` |
| SMS Twilio checklist | `docs/SMS-TWILIO-LIVE-PROVE.md` |
| SuperTokens KB rule | `docs/knowledge-base.md` + root `CLAUDE.md` |

---

## Parity snapshot (Briven vs SuperTokens)

| Band | ~% |
|------|-----|
| Day-to-day SaaS login | **~90–95%** |
| Full ST-style surface | **~80–85%** |
| Official “100% SuperTokens” claim | **Not claimed** |

**Main gaps:** SMS live ops · IdP human E2E · migration polish · framework pack breadth · captcha · passkey enroll retest.

---

## Twilio / SMS (parked facts)

- Account has US From candidate: **`+19382533203`**
- SID + Auth Token were provided in past sessions (may need **rotate** if leaked in chat)
- **Virtual Phone ≠ From number**
- BE business mobile needs company registration number (user does not have) — abandoned for now
- Cyprus number not available on Twilio for user
- US path asks for **US address** / A2P — user chose to leave SMS as-is

---

## Passkeys (parked facts)

- SuperTokens model: **register while signed in**, then sign in with passkey
- Browser “no passkeys for pay.mavifinans.sh” = none stored for that rpId yet (or enroll didn’t finish as WebAuthn)
- User screenshot of password manager password ≠ WebAuthn passkey
- Doltgres: `ADD COLUMN IF NOT EXISTS` fails for webauthn rp columns (fallback insert works; schema polish open)

---

## Git state at save (approx)

| Repo | Note |
|------|------|
| briven | Often **ahead of origin** (push may 403 without token) |
| mavi-pay | Main pushed for auth fixes in this arc |
| pando | Handoffs may need **commit + push**; other WIP may exist on disk |

---

## Next session options (pick one)

### A. Resume Auth polish (Briven session)
1. Passkey: prove Add passkey → sign out → Continue with passkey  
2. Or SMS when Twilio address/compliance ready  
3. Or IdP human E2E / parity gap sprint  

### B. Pando (Pando session only)
- Read `pando/docs/HANDOFF-BRIVEN-AUTH-FOR-PANDO.md`  
- Wire real Briven Auth (replace login stub)  
- **Never** edit briven monorepo from Pando session  

### C. Product work elsewhere
- Mavi product features with Auth as-is  
- M2M for servers: `docs/HANDOFF-AUTH-M2M-FOR-ALL-PROJECTS.md`  

---

## Copy-paste prompt for next Briven session

```
Resume Briven Auth work from docs/SESSION-RESUME-2026-07-27-AUTH.md

Status: mavi magic link + email OTP + Konnos PASS live.
Paused: passkeys retest, SMS/Twilio (US +19382533203, address/compliance).
Do not claim 100% SuperTokens. Knowledge-base hard rule for Auth.

Next: [user fills: passkeys | SMS | IdP | Pando handoff only | other]
```

---

## Hard rules (still)

1. SuperTokens docs = checklist; no Core on Doltgres.  
2. Before Auth code changes: open `docs/knowledge-base.md` + matching ST section.  
3. Only Briven sessions edit `/Users/flndrn/Desktop/briven` or France Auth deploys.  
4. No Clerk/Firebase side auth for product login.  
5. No secrets in `NEXT_PUBLIC_*` / git.

---

*End of resume. Safe to close the terminal.*
