# Sprint Plan: Close Clerk Auth Gap for Beta (L1/L2)

**Date:** 2026-07-19  
**Owner:** flndrn + agent  
**Status:** Engineering complete — product claim waits on human proof  
**Scope level:** **L1 beta trust + L2 dogfood/polish**  
**Enterprise (S7):** SCIM + group→org maps + compliance sales kit + OIDC PKCE polish shipped 2026-07-19. See `docs/ENTERPRISE-PACK.md`.  

---

## 1. Goal (plain words)

Make Briven Auth something people can **rely on** for a **beta pilot** — same *trust* as day-to-day Clerk for normal apps — without becoming Clerk-the-company.

**Success:**  
1. One real project passes AUTH-GO-LIVE rows **1–4 + 7**  
2. Second project shows **no user leak**  
3. Production API build matches the commit we care about (manual deploy once)  
4. Soft gaps improved enough for confidence (auth-pilot path, isolation tooling, mail notes)  
5. You can say **“friends can use this”**  

**Not success:** SCIM, SMS, looking like Clerk, pure auth SaaS outside Briven.

---

## 2. What’s already done (do not re-build)

- Email/password, magic link, OTP, OAuth, passkeys, 2FA (TOTP)  
- Backup codes, devices, sessions, password policy, account linking  
- Rate limits (Redis + memory), key scopes, hardening  
- S5 DX: docs, scaffold, auth-pilot, testing tokens  
- S6 code: reliability metrics, admin snapshot, tests, status story, `scripts/s6-auth-verify.sh`  

---

## 3. Sprint work breakdown

### Workstream A — Human proof (product claim)

| # | Work | Owner | Done when |
| --- | --- | --- | --- |
| A1 | AUTH-GO-LIVE rows 1–4 + 7 on one pilot project | **Human (flndrn)** | Sign-off table filled |
| A2 | Second-project isolation (user on A never on B) | **Human** + agent tooling | Sign-off + script evidence |
| A3 | Optional: magic link / Google / 2FA backup / rate-limit burst | Human if advertised | Checklist rows or N/A |
| A4 | Product claim: “friends can use this” | **Human** | Written in this file §8 |

**Agent support for A:** checklists, dogfood kit, isolation verify script, evidence template — **cannot click your dashboard for you**.

### Workstream B — Production freshness (ops)

| # | Work | Owner | Done when |
| --- | --- | --- | --- |
| B1 | Keep **GitHub auto-deploy OFF** (push does not rebuild) | Agent | Workflow inert + secrets not auto-firing |
| B2 | Turn off **Dokploy** git auto-deploy if still on | Agent via API if possible; else human UI | `autoDeploy` false |
| B3 | **One manual** deploy of latest API (and needed services) | Agent (SSH/webhook once) | `/info` buildSha matches target commit |
| B4 | Re-run `./scripts/s6-auth-verify.sh` after deploy | Agent | All platform probes PASS |

### Workstream C — Soft product gaps (build)

| # | Work | Owner | Done when |
| --- | --- | --- | --- |
| C1 | Auth-pilot dogfood path crystal clear (`briven setup` + checklist) | Agent | README + scaffold aligned |
| C2 | Isolation verify script (documents how to prove A≠B) | Agent | `scripts/auth-isolation-verify.md` + shell helper |
| C3 | Pen-test suite docs + local unit coverage (live CI optional) | Agent | Tests pass; env-gated integration documented |
| C4 | Mail deliverability notes for custom domains | Agent | Short ops section in S6 or auth docs |
| C5 | Light auth analytics: keep S6 counters; no big new UI required | Agent | Admin health panel + `/v1/admin/auth-reliability` |

### Workstream D — Explicitly deferred (no build this sprint)

| Item | Why deferred |
| --- | --- |
| SCIM | Enterprise deal only |
| Full DPA/compliance sales kit | Sales-driven |
| Deeper OIDC/SAML polish beyond current | When customer requires |
| SMS OTP | Never in this program |
| Pixel-perfect Clerk UI | Never |

---

## 4. Definition of done (this sprint)

### Code/ops (agent must complete)

- [x] This plan written  
- [x] Dokploy auto-deploy disabled (`autoDeploy: false`)  
- [x] Manual deploy once → prod `buildSha` = `2e81f23…` (S6)  
- [x] `s6-auth-verify.sh` PASS on production  
- [x] Isolation tooling + auth-pilot + mail notes shipped  
- [x] Evidence file updated (`docs/CLERK-GAP-EVIDENCE.md`)  

### Human (required for product claim)

- [ ] AUTH-GO-LIVE 1–4 + 7  
- [ ] Isolation A vs B  
- [ ] “Friends can use this” in §8  

**Sprint “complete” for engineering** = agent checklist green ✅ (2026-07-19).  
**Sprint “complete” for product claim** = engineering + human §8.

---

## 5. Risks

| Risk | Mitigation |
| --- | --- |
| Dokploy still auto-deploys on git | Disable in Dokploy; GitHub workflow already inert |
| Deploy overloads France | Single manual deploy only; no push-trigger |
| Human checklist delayed | Agent finishes everything else; claim stays gated |
| Secrets in memory.md | Do not print in chat; rotate when practical |

---

## 6. Status board (update as we go)

| Stream | Status | Notes |
| --- | --- | --- |
| Plan | **Engineering done** | 2026-07-19 |
| A Human proof | **Waiting on flndrn** | Tools ready |
| B Prod freshness | **Done** | API on `2e81f23` |
| C Soft gaps | **Done** | scripts + runbook + pilot README |
| D Enterprise | **Out of scope** | |

---

## 7. Target commit / prod

| Field | Value |
| --- | --- |
| Deployed API | `2e81f239bdada4b191dfb4c0dac514d31492e9f3` (S6) |
| Sprint docs tip | `main` after this sprint’s commits (docs only — no re-deploy required) |
| Prod check | `curl -s https://api.briven.tech/info` |

---

## 8. Product claim sign-off (human)

> I confirm pilot AUTH-GO-LIVE (1–4+7) and second-project isolation.  
> **Friends can use Briven Auth for beta.**

Date: ________  Name: ________  Pilot project id: ________  Isolation project id: ________

---

*End of plan. Implementation proceeds immediately under this document.*
