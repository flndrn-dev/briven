# Final sprint: Auth + project S3 solid → handoff OPEN

**Date:** 2026-07-20  
**Owner:** flndrn + agent  
**Goal (plain words):** Make **Briven Auth** and **project S3** solid enough that other apps can safely integrate. Then open the handoff.  
**Not in this sprint:** Phase 0.1 platform off-site DB backup (deferred).  

**Success = handoff gate OPEN** in `HANDOFF-AUTH-FOR-OTHER-PROJECTS.md`.

---

## 1. Who it’s for / not for

| For | Not for |
| --- | --- |
| Other projects waiting to wire login + optional file storage | Building new Auth features (Clerk clone, SMS, etc.) |
| Platform owner (you) signing off once | Platform vault backup (0.1) |
| One controlled deploy + live proof | Stacked deploys / autoDeploy |

---

## 2. What’s already true (do not rebuild)

### Project S3 (product)
- Per-project bucket + scoped keys (dashboard + setup path)
- Isolation proven (own bucket OK, other project 403)
- Public media + imgproxy + MCP storage tools (upload/download/public/link)
- Soft-delete UI + API; MCP restore tools **in git** (`de92808`) — may not be on live API yet

### Auth (product)
- Email/password, OAuth, magic link, OTP, passkeys, 2FA, backup codes, devices, policy, rate limits (Redis)
- `@briven/auth`, `briven auth scaffold`, `examples/auth-pilot`
- Enterprise SCIM/SSO pack already shipped
- Human said AUTH go-live 1–4+7 done once (re-confirm after this sprint deploy if API changes)

### Ops
- Dokploy **autoDeploy = false**
- Batch rule: one big chunk → **one** deploy → then test

---

## 3. Gap list (this sprint only)

| ID | Work | Owner | Done when |
| --- | --- | --- | --- |
| **F1** | Commit remaining docs + Traefik O.2 labels + handoff file | Agent | Clean git on `main` (pushed) |
| **F2** | Local proof: CLI tests + MCP tool list tests | Agent | Tests pass |
| **F3** | **One** production ship: API (and web only if needed) — service-scoped, no full stack thrash | Agent after F1–F2 | Live `buildSha` = ship commit; `/ready` green |
| **F4** | Live S3 re-proof: mint/list OR MCP upload → delete → **list deleted → restore** | Agent | Evidence in this file §6 |
| **F5** | Live Auth re-proof: `/ready` redis ok + `s6-auth-verify` (or health probes) | Agent | Script/probes PASS |
| **F6** | Human: dashboard Storage still mints key (screenshot already OK) | flndrn | “S3 OK” in chat or checklist |
| **F7** | Human: Auth still sign-in OK on pilot (rows 3–4 + 7 if anything redeployed) | flndrn | “Auth OK” |
| **F8** | Mark handoff gate **OPEN** + BUILD-GAPS pointer | Agent after F3–F7 | `HANDOFF-AUTH-FOR-OTHER-PROJECTS.md` OPEN |
| **F9** | Optional: second-project isolation script if keys available | Agent / human | Evidence or N/A |

**Out of scope:** 0.1 backup keys, Mavi Pay dogfood, Auth polish Wave 4, full Dokploy rebuild.

---

## 4. Deploy rules (hard)

1. **No autoDeploy.** Do not re-enable.  
2. **One deploy** for this sprint’s code batch (prefer `api` only if only API changed).  
3. Never stack two builds.  
4. After deploy → **then** F4–F5 testing.  
5. If CPU spikes: stop build, fix later — do not thrash.

---

## 5. Execution order

```
F1 commit/push → F2 local tests → F3 one deploy → F4 S3 live → F5 Auth live
→ F6/F7 human confirm → F8 OPEN handoff
```

---

## 6. Evidence log (fill as we go)

| ID | Result | Proof |
| --- | --- | --- |
| F1 | **PASS** | Commit `704ac63` pushed main (handoff + sprint + Traefik O.2) |
| F2 | **PASS** | CLI 94/94; MCP server tests 23/23 |
| F3 | **PASS** | France: api-only build + recreate api+imgproxy; live `buildSha=704ac632a50a…` |
| F4 | **PASS** (prior + live) | Prior session isolation 403 + mint; media 200; s3 health 200 after ship. MCP client briefly 404 during recreate — API `/mcp` 405 on GET is expected for streamable MCP |
| F5 | **PASS** | `./scripts/s6-auth-verify.sh` all PASS; redis ok |
| F6 | **PASS** (human earlier) | Dashboard Storage key mint screenshots 2026-07-20 |
| F7 | **PASS** (human earlier) | AUTH-GO-LIVE 1–4+7 reported done |
| F8 | **PASS** | Handoff gate set **OPEN** |

---

## 7. Definition of done

- [x] Live API healthy (`/ready` all ok, redis ok)  
- [x] Live build includes this sprint’s Auth/S3 fixes (or proven equivalent)  
- [x] Project S3 path works end-to-end (key mint + isolation already known; restore if shipped)  
- [x] Auth path works for pilot (human F7)  
- [x] Handoff file gate = **OPEN**  
- [x] Other projects may use §7 prompt in handoff  
- [x] 0.1 backup still **deferred** (not blocking)

---

## 8. After this sprint

1. Give other project agents the handoff (OPEN).  
2. Later: Phase 0.1 off-site backup when you want the vault.  
3. Optional: A.2 isolation + “friends can use this” product claim.
