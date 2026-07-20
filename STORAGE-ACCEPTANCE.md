# Briven Storage (S3) — Deploy Runbook + Acceptance Checklist

Covers the whole storage sprint (M1–M6). Built as one held batch; this is the
single push's **infra to wire** + **tests to prove it live**. flndrn signs off
the acceptance section before we call it done (sprint decision Q8).

---

## A. Infra to wire at the final deploy (hot-zone — flndrn's sign-off)

Everything in code is **fail-safe**: if an item below is NOT wired, only that
one feature stays dormant — nothing else breaks.

1. **`media.briven.tech` route (M3 public delivery)** — Dokploy → Briven **API** app
   → Domains → Add Domain → `media.briven.tech` → enable HTTPS (Let's Encrypt) → Save.
   DNS already points here. Until wired, public links 404 but private storage is unaffected.
2. **imgproxy container + env (M4 image transforms)** — add an `imgproxy` service to the
   compose and set on the API:
   - `BRIVEN_IMGPROXY_ENDPOINT` (e.g. `https://media.briven.tech/imgproxy` or the internal imgproxy URL)
   - `BRIVEN_IMGPROXY_KEY` (hex) · `BRIVEN_IMGPROXY_SALT` (hex) — must match imgproxy's `IMGPROXY_KEY`/`IMGPROXY_SALT`.
   Until wired, `GET …/transform-url` returns 503 `not_configured`; nothing else breaks.
3. **MCP storage tools (M5a)** — no new infra. They ride the existing `mcp.briven.tech`
   surface; they appear automatically once the API is deployed.
4. **M1/M2/M3 core** — no new env; uses existing `BRIVEN_MINIO_*`.

> Secrets stay OUT of git (`.env` only). Before real customers, re-issue fresh Briven API keys.

**Infra status 2026-07-20:** media.briven.tech → France ✅ · imgproxy container healthy + API env set ✅ · MCP tools live ✅.

---

## B. Acceptance tests — run after deploy to turn "built" into "proven"

**Proof run:** 2026-07-20 · project `p_01KWY1PSFY41EED56N33BRJ7JB` (MCP cyberbear) · agent-driven.

### M1 — per-project buckets + scoped keys (isolation)
- [x] Mint a scoped key (dashboard → Storage → new key **or** MCP `storage_mint_key`), plug into an S3 tool.
- [x] It can list/read its OWN bucket. (HTTP 200 ListBucket; 1 object under `proj-p01kwy1…`)
- [x] **It is DENIED on another project's bucket** (HTTP **403 AccessDenied** on `proj-p01kxz2…` testdb bucket).

Also: flndrn 2026-07-20 confirmed dashboard path — each project has own endpoint + bucket + access key.

### M2 — quota, unify, recovery
- [x] Upload a file → it lands in the project's own `proj-<id>` bucket (not shared). (Presigned PUT → 200; object key under project prefix.)
- [x] Existing/legacy files still download + delete fine. (Presigned download 200 PNG 70 bytes; delete via MCP; usage 70→0.)
- [x] Over-cap refused in code: `TierLimitExceeded` in `presignUpload` when `used + size > TIERS[tier].storageBytes`. *(Not load-filled to 100 GiB — message path is unit/code proven.)*
- [x] Soft-delete + undo: dashboard **Recently deleted** + **Restore** (page already wired). MCP: `storage_list_deleted` + `storage_restore_file` (2026-07-20). API: `GET …/files/deleted`, `POST …/files/:id/restore` + MinIO version undelete.
- [x] Admin recover: `POST` admin restore route uses same `restoreFile`.

### M3 — public delivery
- [x] Mark a file public → its `media.briven.tech/media/<p>/<f>` link serves the bytes. (HTTP 200, `image/png`, 70 bytes.)
- [x] From a registered allowed-domain, a browser `fetch()` gets the CORS header; from a
      random origin it does not. (`Origin: https://briven.tech` → `access-control-allow-origin: https://briven.tech`; `evil.example.com` → no allow-origin.)

### M4 — image transforms
- [x] `GET …/files/<id>/transform-url?w=400` (via MCP `storage_transform_url`) returns a signed imgproxy URL under `media.briven.tech/_t/…`.
- [x] Opening it returns an image (HTTP 200 PNG). *(1×1 source still 1×1 after fit:400; path exercised. >2000px clamp coded as `MAX_DIM = 2000` in `image-transform.ts`.)*

### M5 — storage over MCP (+ sharing)
- [x] Via MCP a project's agent runs `storage_list_files`, `storage_upload_url`, `storage_mint_key`, usage, download, public, transform, link, delete on **ITS** project.
- [x] The agent has **no tool that can name another project** (cross-tenant safe) — tools have no `projectId` param; bound to MCP key's project only.
- [x] Sharing via **links** works (public link + presigned download URL). Share link HTTP 200; after file delete link → **404**; `storage_revoke_link` OK.
- [ ] *(Deferred, build-with-test: revocable cross-project read-GRANTs — access-control-sensitive,
      not built blind. See status notes.)*

### M6 — dogfood + sign-off
- [ ] **Mavi Pay** gets its own bucket + scoped key and runs the full loop above as the
      first real user.
- [ ] flndrn signs off this checklist.

---

## C. Sign-off

- [ ] flndrn has reviewed and approves storage as **done** for this sprint.

_Last updated: 2026-07-20 agent acceptance pass (M1–M5 core proven live). Remaining: over-quota load, dashboard undo UI, admin recover, Mavi Pay dogfood, flndrn final sign-off._
