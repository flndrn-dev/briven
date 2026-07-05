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

---

## B. Acceptance tests — run after deploy to turn "built" into "proven"

### M1 — per-project buckets + scoped keys (isolation)
- [ ] Mint a scoped key (dashboard → Storage → new key), plug into an S3 tool.
- [ ] It can list/read its OWN bucket.
- [ ] **It is DENIED on another project's bucket** (the isolation proof).

### M2 — quota, unify, recovery
- [ ] Upload a file → it lands in the project's own `proj-<id>` bucket (not shared).
- [ ] Existing/legacy files still download + delete fine.
- [ ] Fill toward the tier cap → an over-cap upload is **refused** with a clear message.
- [ ] Delete a file → it appears under "recently deleted" → **undo** restores it.
- [ ] Admin storage page shows per-project object usage; admin **recover-a-file** works.

### M3 — public delivery
- [ ] Mark a file public → its `media.briven.tech/media/<p>/<f>` link serves the bytes.
- [ ] From a registered allowed-domain, a browser `fetch()` gets the CORS header; from a
      random origin it does not.

### M4 — image transforms
- [ ] `GET …/files/<id>/transform-url?w=400` returns a signed imgproxy URL.
- [ ] Opening it returns the image resized to 400px (and a >2000px request is clamped).

### M5 — storage over MCP (+ sharing)
- [ ] Via `mcp.briven.tech` a project's agent runs `storage_list_files`, `storage_upload_url`,
      `storage_mint_key` on ITS project.
- [ ] The agent has **no tool that can name another project** (cross-tenant safe).
- [ ] Sharing via **links** works (public link + presigned download URL).
- [ ] *(Deferred, build-with-test: revocable cross-project read-GRANTs — access-control-sensitive,
      not built blind. See status notes.)*

### M6 — dogfood + sign-off
- [ ] **Mavi Pay** gets its own bucket + scoped key and runs the full loop above as the
      first real user.
- [ ] flndrn signs off this checklist.

---

## C. Sign-off

- [ ] flndrn has reviewed and approves storage as **done** for this sprint.

_Last updated: storage sprint held-batch (M1–M6). M5b cross-project grants intentionally
left for a build-with-test pass (security-sensitive access control)._
