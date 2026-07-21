# Handoff: Briven for other projects (Auth + S3 + Doltgres)

**Who this is for:** flndrn and agents on **other apps** (konnos, mavi-pay, …) that should use **hosted Briven**.  
**Who this is not for:** editing the Briven monorepo · platform off-site vault backup (owner ops later).

**Date:** 2026-07-21  
**Platform:** `https://api.briven.tech` · dashboard `https://briven.tech` · docs `https://docs.briven.tech`

---

## 0. Product DNA (read first)

**Briven.tech is Doltgres-first.** See monorepo `DOLTGRES-FIRST.md`.

| Layer | What it is |
|--------|------------|
| **SQL databases** | **Doltgres** only — control brain + each project’s data (Postgres wire, version history) |
| **Auth** | Hosted Briven Auth (`@briven/auth`, `pk_briven_auth_…`) |
| **Files** | MinIO S3 API (`s3.briven.tech`, per-project `proj-…` buckets) |
| **Agents** | MCP at `https://api.briven.tech/mcp` with `pk_briven_mcp_…` |

Your app **does not** run Doltgres itself. You call Briven’s API / Auth / Storage / MCP.

**Gate status: OPEN** (Auth + project S3 product paths ready). Platform DB backup off-site is **not** required for this handoff.

---

## 1. Three kinds of keys (do not mix)

| Key | Looks like | Where it goes | Purpose |
|-----|------------|---------------|---------|
| **Auth public** | `pk_briven_auth_…` | Browser / `NEXT_PUBLIC_*` | Sign-up / sign-in |
| **Server / data** | `brk_…` | Server env only | Functions, HTTP data API |
| **MCP** | `pk_briven_mcp_…` | Agent config only | AI tools on **one** project |
| **Storage S3** | `brvn…` access + secret | Server / S3 tools | File upload/download to **one** bucket |

Never put `brk_…` or storage secrets in the browser.  
Never use project Storage keys as “platform backup” keys.

---

## 2. CLI (correct split — 2026-07)

```bash
# NEW cloud project + S3 default key + wire this folder
briven setup my-app
# or interactive: briven setup

# EXISTING project + S3 + wire this folder
briven connect p_01HZ...
# or: briven connect --project p_01HZ...
# or interactive pick: briven connect

# After the folder is linked — Auth files for Next-style apps
briven auth scaffold
pnpm add @briven/auth
```

| Command | Does |
|---------|------|
| `briven setup` | **Create new** project only (not attach) |
| `briven connect` | **Attach existing** project (+ platform sign-in) |
| `briven connect status` / `logout` | Session hygiene |
| `briven deploy` / `dev` | Push schema + functions |

---

## 3. Env template (per app)

```bash
# Core
NEXT_PUBLIC_BRIVEN_API_ORIGIN=https://api.briven.tech
NEXT_PUBLIC_BRIVEN_PROJECT_ID=p_YOUR_PROJECT_ID

# Auth (browser)
NEXT_PUBLIC_BRIVEN_AUTH_KEY=pk_briven_auth_…
BRIVEN_AUTH_PUBLIC_KEY=pk_briven_auth_…   # same value; middleware

# Optional files (from dashboard → Storage → new key; secret shown once)
BRIVEN_STORAGE_ENDPOINT=https://s3.briven.tech
BRIVEN_STORAGE_BUCKET=proj-…
BRIVEN_STORAGE_ACCESS_KEY=brvn…
BRIVEN_STORAGE_SECRET_KEY=…
# or AWS_* aliases if your S3 client prefers them
```

---

## 4. Auth (minimal — Clerk-simple)

**One path:** Enable Auth once → starter pack turns **magic + OTP + passkey ON** → mint `pk_briven_auth_…` → Allowed Domains → scaffold → deploy the **app**.

Do **not** spend hours re-toggling providers if they already show ON. Do **not** invent Clerk.  
If the repo is fixed but the live site is broken → **redeploy the app** (GitHub ≠ browser JS).

Full audit: `AUTH-CLERK-SIMPLE-AUDIT.md`. Agent skill: `.claude/skills/briven-auth/SKILL.md`.

```ts
import { createBrivenAuth } from '@briven/auth';

export const auth = createBrivenAuth({
  projectId: process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID!,
  publicKey: process.env.NEXT_PUBLIC_BRIVEN_AUTH_KEY!,
});

// Fastest pilot UI
window.location.assign(auth.hostedPageURL('sign-in', '/dashboard'));
```

**OTP wire paths (do not invent):**
- send: `POST /v1/auth-tenant/email-otp/send-verification-otp` `{ email, type: "sign-in" }`
- verify sign-in: `POST /v1/auth-tenant/sign-in/email-otp` `{ email, otp }`

**Dashboard:** project → Auth → Enable → API keys → create **read-write** → copy `pk_briven_auth_…`.

Docs: https://docs.briven.tech/auth · checklist: `AUTH-GO-LIVE-CHECKLIST.md` · pilot: `examples/auth-pilot/`

---

## 5. Project S3 (files)

1. Dashboard → project → **Storage**  
2. **New key** → copy endpoint, bucket, access, secret (secret once)  
3. PUT/GET via presigned URLs or any S3 client against that bucket only  
4. Isolation: key **cannot** list another project’s bucket  

Public files: `https://media.briven.tech/media/<projectId>/<fileId>`  
MCP (if enabled): `storage_*` tools — see §6.

Docs: https://docs.briven.tech/storage · https://docs.briven.tech/connect · https://docs.briven.tech/api

---

## 6. MCP tools agents get (one project only)

No tool accepts another project’s id. Scope = the key’s project.

| Area | Tools (names) |
|------|----------------|
| **DB** | `list_tables`, `describe_table`, `query`, `create_table`, `insert`, `update`, `delete` |
| **DB lifecycle** | `db_health`, `db_recovery_points`, `db_restart`, `db_recover` (+ admin reprovision) |
| **Storage** | `storage_list_files`, `storage_usage`, `storage_upload_url`, `storage_download_url`, `storage_delete_file`, `storage_list_deleted`, `storage_restore_file`, `storage_make_public`, `storage_transform_url`, `storage_mint_key` / `storage_list_keys` / `storage_revoke_key`, share links + grants tools |
| **Auth facts** | `auth_config_get`, `sender_domain_status`, `auth_docs_ask` |
| **Help desk** | `briven_ask` — always answers in 3 parts: how Briven works · what tools give you · what you build |

Config shape:

```json
{
  "mcpServers": {
    "briven": {
      "url": "https://api.briven.tech/mcp",
      "headers": {
        "Authorization": "Bearer pk_briven_mcp_…"
      }
    }
  }
}
```

Engine under MCP data tools: **Doltgres** (Postgres-compatible git-for-data). Not stock Postgres, not MySQL Dolt.

---

## 7. Copy-paste prompt for another project’s agent

```
Briven handoff is OPEN (Auth + project S3). Engine is Doltgres-first — we do NOT run our own Postgres for app data.

Read:
- https://docs.briven.tech/auth
- https://docs.briven.tech/connect
- Briven repo HANDOFF-AUTH-FOR-OTHER-PROJECTS.md and DOLTGRES-FIRST.md

For THIS app:
1. Link project: `briven setup <name>` (new) OR `briven connect p_…` (existing). Never use setup --project for attach.
2. Dashboard Auth → enable → create pk_briven_auth_… (read-write). Never brk_ in the browser.
3. Install @briven/auth; Next: `briven auth scaffold`. Env: NEXT_PUBLIC_BRIVEN_API_ORIGIN, PROJECT_ID, AUTH_KEY, BRIVEN_AUTH_PUBLIC_KEY.
4. If files needed: dashboard Storage → mint key → BRIVEN_STORAGE_* (s3.briven.tech / proj-…).
5. Optional MCP: pk_briven_mcp_… → https://api.briven.tech/mcp (one project only).
6. Do NOT stand up a side database. Do NOT edit the Briven monorepo. Do NOT implement platform off-site backup.
```

---

## 8. Security red lines

- No `brk_` / storage secrets in client bundles  
- No inventing Clerk / Firebase Auth / local Postgres “because MCP didn’t know”  
- No cross-project data access  
- Rotate any key pasted into chat or screenshots  

---

## 9. Deferred (do not block other apps)

- Phase 0.1 off-site platform vault (R2/B2) for Doltgres + MinIO mirrors  
- Second-project auth isolation dogfood / “friends” marketing claim  
- Pixel-perfect Clerk UI  

---

*If live dashboard labels disagree with this file, trust the dashboard and fix this handoff in a dedicated Briven session.*
