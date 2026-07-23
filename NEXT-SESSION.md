# Next session — pick up here

**Saved:** 2026-07-23  
**Owner:** flndrn  
**Rule:** Briven platform work only in a Briven session; Konnos app auth only in a Konnos session.

---

## One-line status

**Phase 9 (Konnos browser login on live konnos.org) is done.**  
MCP guidance updated for briven-engine.  
**Next build block:** product polish — **SMS steps 1–5 done in code** (UI + honest delivery + test send + `sms-polish-proof.mjs`). Still open: **live Twilio prove + deploy** when you say go; then branding; then stronger email; then IdP / M2M / audit.

---

## Where code lives (HEADs)

| Repo | Local path | Commit | Remote push |
|------|------------|--------|-------------|
| **Briven** | `/Users/flndrn/Desktop/briven` | `4fcb9ff` *fix(mcp): teach briven-engine FDI…* | **Not on origin** — laptop ahead **16** commits (code.konnos.org auth broken) |
| **Konnos** | `/Users/flndrn/Desktop/konnos` | `17a5733` *docs(auth): Phase 9 handoff…* | **Not on GitHub** (token invalid / no SSH) |

**Live France** (`root@187.124.64.116` — “ollama-kvm4”):

| App | Server folder | Live service | Notes |
|-----|---------------|--------------|-------|
| Briven | `/etc/dokploy/compose/briven-brivenfrance-uilsk6/code` | `briven-brivenfrance-uilsk6-api-1` | API **healthy**, `buildSha` **4fcb9ff**, MCP text live |
| Konnos web | `/etc/dokploy/applications/app-back-up-haptic-circuit-58nwnf/code` | swarm `app-back-up-haptic-circuit-58nwnf` | Rebuilt from rsync; login + OTP OK |

Deploy path when git push fails: **rsync Mac → server folder → docker compose / service update** (done last session).

---

## What was finished this stretch

1. **Option B / briven-engine** live (not SuperTokens Core).  
2. **Dashboard OAuth** multi-provider UI + save via `/api/dashboard/auth-core` proxy; dual secret names.  
3. **Phase 9 Konnos:** first-party `/api/auth` → FDI; OTP → cookies → mint `konnos_session` **proved live**.  
4. **MCP** `auth_docs_ask` / `auth_config_get` / `briven_ask` teach `/v1/auth-core/fdi/*` (not auth-tenant 410).  
5. **Handoff for Konnos agent:** `konnos/docs/auth-handoff.md`.  
6. **Sync + deploy from server local folders** (not only git remote).

---

## Open gaps vs SuperTokens (short)

**Next (product polish):**
- SMS productized (Twilio secrets + UX + live proof)
- Branding (email look, dashboard branding tab)
- Delivery hardening (SMTP stronger than mittera-only)

**Then (deep ST):**
- Briven as **IdP** (OAuth2/OIDC provider for other apps)
- **M2M** client credentials
- **Audit** trail (security events export)

**Ongoing / human:**
- Multi-OAuth save: hard-refresh dashboard, save 2nd/3rd provider, check Security tab
- Real inbox OTP on konnos.org (you click login with your email)
- Konnos “Continue with Konnos” needs OAuth secrets in Briven Providers
- Optional `KONNOS_COOKIE_DOMAIN=.konnos.org` for code.konnos.org sharing
- Re-auth git remotes: `gh auth login` + code.konnos.org push for Briven’s 16 commits

Full gap table was given in chat; feature audit: `BRIVEN-AUTH-FEATURE-AUDIT.md`.

---

## Key IDs & paths (do not reinvent)

| Item | Value |
|------|--------|
| Konnos Briven project | `p_01KW5RC84WZXBF3EE8ZCK9X8EX` |
| Engine tenant | `proj-p-01kw5rc84wzxbf3ee8zck9x8ex` |
| Live FDI | `POST /v1/auth-core/fdi/signinup/code` + `…/consume` |
| Session me | `GET /v1/auth-core/session/me` |
| Auth-tenant | **410 Gone** — never wire new apps |
| Konnos proxy | `apps/web/src/app/api/auth/[...path]/route.ts` |
| Konnos helpers | `apps/web/src/lib/briven-auth.ts` |
| Briven MCP bridge | `apps/api/src/services/mcp-auth-bridge.ts` |

---

## How to start next session (copy-paste)

**Default Briven session:**
```
Resume from NEXT-SESSION.md. Phase 9 done. SMS polish code + sms-polish-proof.mjs
done (steps 1–5). Next: live Twilio prove (your secrets) then deploy when OK;
then branding. Not IdP/M2M yet. France = rsync+compose if git push broken.
```

**Konnos-only session:**
```
Read docs/auth-handoff.md. Adjust Authentication model app-side only.
Do not edit Briven monorepo. Live project p_01KW5RC84WZXBF3EE8ZCK9X8EX.
```

**If remotes matter first:**
```
Help me re-auth git push: Briven → code.konnos.org (16 commits ahead),
Konnos → GitHub. Then optional mirror sync.
```

---

## Verify still green (30 seconds)

```bash
curl -sS https://api.briven.tech/info | head -c 200
curl -sS -X POST https://konnos.org/api/auth/signinup/code \
  -H 'content-type: application/json' \
  -d '{"email":"probe@example.com","flowType":"USER_INPUT_CODE"}'
# expect engine: briven-engine
```

---

## Related docs

| Doc | Why |
|-----|-----|
| `NEXT-SESSION.md` | **This file** — resume pointer |
| `AUTH-BLANK-STATE.md` | Phase table + not-yet list |
| `BRIVEN-AUTH-FEATURE-AUDIT.md` | SuperTokens checklist Y/P/N |
| `AUTH-SUPERTOKENS-COMPARE.md` | Older architecture compare (Option B chosen) |
| `konnos/docs/auth-handoff.md` | Konnos agent auth model |
| `HANDOFF-BRIVEN-AUTH-V2.md` | Older platform handoff |

---

## Success when you return

You open this file, run the two curls, and either:

1. Start **SMS + branding**, or  
2. Re-auth **git remotes**, or  
3. Hand a **Konnos agent** `docs/auth-handoff.md`.
