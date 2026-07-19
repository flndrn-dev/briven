# SCIM 2.0 (Enterprise directory sync)

**What this is (plain words):**  
Your company’s IT system (Okta, Microsoft Entra, Google Workspace, etc.) can **automatically add, update, or remove** app users in Briven Auth — so HR doesn’t have to click “create user” by hand.

**Phase:** 9.1 + 9.3 (Users + Groups + bearer tokens). Group → org-role mapping can deepen later.

---

## Base URL (per project)

```
https://api.briven.tech/v1/projects/<PROJECT_ID>/scim/v2
```

IdPs need:

| Field | Value |
| --- | --- |
| SCIM base URL | `https://api.briven.tech/v1/projects/p_YOUR_ID/scim/v2` |
| Auth | Bearer token `scim_briven_…` |
| Users endpoint | `…/Users` |
| Groups endpoint | `…/Groups` |

---

## Create a SCIM token (dashboard API)

Requires project **admin** session (same as other Auth admin APIs).

```http
POST /v1/projects/:id/auth/scim/tokens
{ "name": "Okta production" }
```

Response includes **`plaintext` once** — paste into the IdP; it never shows again in full.

```http
GET  /v1/projects/:id/auth/scim/tokens
DELETE /v1/projects/:id/auth/scim/tokens/:tokenId
```

---

## Protocol endpoints (Bearer only)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/ServiceProviderConfig` | Capabilities |
| GET | `/ResourceTypes` | User + Group |
| GET/POST | `/Users` | List / create |
| GET/PUT/PATCH/DELETE | `/Users/:id` | Lifecycle |
| GET/POST | `/Groups` | List / create |
| GET/DELETE | `/Groups/:id` | Basic groups |
| GET | `/Schemas` | Minimal |

Filters supported: `userName eq "…"`, `externalId eq "…"`, `emails.value eq "…"`.

Inactive users (`active: false`) are **banned** in Briven Auth; re-activate unbans.

---

## What SCIM does **not** do yet

- Bulk operations  
- Full group → Briven org role auto-mapping polish  
- SMS  
- Compliance sales pack (separate)

---

## Smoke test (after token)

```bash
export P=p_YOUR_PROJECT
export T=scim_briven_…
export B=https://api.briven.tech

curl -sS -H "Authorization: Bearer $T" \
  -H "Content-Type: application/scim+json" \
  -d '{"userName":"pilot@example.com","displayName":"Pilot","emails":[{"value":"pilot@example.com","primary":true}]}' \
  "$B/v1/projects/$P/scim/v2/Users"
```
