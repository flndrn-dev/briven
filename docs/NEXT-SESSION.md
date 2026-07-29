# Next session — pick up here

**Saved:** 2026-07-27  
**Owner:** flndrn  

---

## One-line status

**Mavi pay login live:** magic link · email OTP · Konnos OAuth.  
**AUTH-HARDEN-90 test phase (T1–T8):** evidence filed 2026-07-29 — FDI lock, proxy, refresh contract, M2M fail path, IdP discovery, migration unit, captcha off.  
**Gold-path app fixes (local):** Mavi legacy proxy remap, Krypco session/me, Konnos JWKS, `@briven/auth` getSession → engine. **Ship Mavi** still needed.  
**Paused:** passkeys human retest · SMS/Twilio (or N/A).  
**Full detail:** [`AUTH-HARDEN-TEST-EVIDENCE-2026-07-29.md`](./AUTH-HARDEN-TEST-EVIDENCE-2026-07-29.md) · [`SESSION-RESUME-2026-07-27-AUTH.md`](./SESSION-RESUME-2026-07-27-AUTH.md)

---

## Read first

1. `docs/SESSION-RESUME-2026-07-27-AUTH.md`  
2. `docs/AUTH-SUPERTOKENS-PARITY-MATRIX.md` (if parity work)  
3. `docs/knowledge-base.md` before any Auth code change  

---

## Quick choices

| If you want… | Do this |
|--------------|---------|
| Continue Auth tests | Resume passkeys **or** SMS from the session resume file |
| Pando login | Pando session + `pando/docs/HANDOFF-BRIVEN-AUTH-FOR-PANDO.md` only |
| Machine auth for any app | `docs/HANDOFF-AUTH-M2M-FOR-ALL-PROJECTS.md` |
| Ship product on mavi | Auth is good enough without SMS/passkeys |

---

## Remotes / deploy notes

- Briven laptop may be **ahead of origin**; France deploys often via rsync + `safe-redeploy-service.sh` when push 403s.  
- Mavi: Dokploy app `app-override-multi-byte-program-hsf4uj` on kvm4 (`187.124.209.17`).  
- Briven France: `187.124.64.116` compose `briven-brivenfrance-uilsk6`.  

---

*Update this file when you close a major block.*
