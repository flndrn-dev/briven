# Briven — Implementation Spec (v1)

> The official document we build from. Written 2026-06-15 from an interview with Jürgen + a code survey of the existing repo (~70–80% built).
> **Rule:** this is a spec, not a build order. No code changes flow from this doc until a decision below is confirmed.

---

## 1. One-line headline

**Briven — the database anyone can use, with a full undo button. Git for your data, no coding required.**

## 2. What it is

A hosted, version-controlled SQL database service. Built on **Dolt** (open-source, MySQL-compatible, github.com/dolthub/dolt) — which gives every customer's data git-style superpowers: commit, branch, diff, and **undo**. Briven wraps that in a point-and-click experience so non-technical people can create, fill, manage, and safely experiment with a real database.

Think: **Neon/Supabase power, but for people who can't code — with an undo button those products don't offer.**

## 3. Who it's FOR

- People who need a solid, reliable database but are **not developers** and have **zero coding experience**.
- People burned by "3 free databases, then surprise traffic/bandwidth bills."
- Non-coders who want to experiment fearlessly because **nothing is ever truly lost** (Dolt version history).

## 4. Who it's NOT for (v1)

- Hardcore developers who want every advanced knob and serverless-Postgres tuning — they'll stay on Neon/Supabase. **We do not chase them in v1.**
- We will not out-feature the giants on developer turf. We win the lane they ignore.

## 5. Why people pick Briven (the edge)

1. **No coding needed** — genuine point-and-click, not a dev console.
2. **Full undo / version history** — Dolt's git-for-data: snapshot, branch, see what changed, roll back. The big brands don't give non-coders this.
3. **Honest, generous limits — no surprise bills.** Enabled by the tech: Dolt is open-source and self-hosted on our own France server, so we have **no per-seat upstream cost** to pass on. The architecture *is* the pricing promise.

## 6. What "success" looks like

- **~€5,000/month steady recurring revenue** — enough to (A) pay all running costs and (B) put money on the household table.
- Rough shape: ~250 customers @ ~€20/mo, or ~50 @ ~€100/mo, or a mix. Sustainability, not a unicorn.

## 7. Current state (the ~70–80% already built)

Monorepo at `apps/*`. Survey findings:

| Area | Status | Notes |
|---|---|---|
| **Engine: Dolt** | ✅ chosen + wired | MySQL-compatible, version-controlled. `infra/dokploy/compose.yml` runs `briven-dolt`. |
| **Auth** (`apps/api/src/lib/auth.ts`) | ✅ ~95% | better-auth; email+password, magic link, Google/GitHub/Discord/Konnos OAuth; multi-tenant orgs; invite-only gate. |
| **Billing** (`apps/api/src/services/billing.ts`) | ✅ ~90% | Polar.sh live; tiers Free/Pro/Team (€0/€29/€99); usage metering; EU VAT check. mavi-pay = planned (swappable interface). |
| **Storage** (`apps/api/src/lib/s3-presign.ts`) | ✅ ~80–95% | MinIO + presigned URLs; per-project file API; tier quotas defined. Internal use today. |
| **Infra** (`infra/dokploy/`) | ✅ ~90% | docker-compose, 6+ services (api/runtime/realtime/web/docs + dolt/redis/minio), Traefik+TLS, Dokploy template. |
| **Table & data editing** (`apps/studio`) | ✅ ~80% | Airtable-like grid: create tables, edit schema visually, add/edit/delete rows, filter/sort. **This is the genuinely no-code part.** |
| **Branching/version UI** | 🟡 ~70% | Works but exposes git/Dolt concepts that confuse non-coders. |
| **SQL editor, functions, API keys, webhooks** | ✅ built but ⚠️ **developer-only** | Not no-code; fine to keep, but not the v1 audience's path. |

## 8. ⚠️ The strategic gap (most important section)

**Briven is currently ~75% of a *developer* platform (a Supabase-style toolkit), but it is positioned for *non-coders*.** The backend/engine is strong and largely done. **The missing 30% is the "anyone can use it" experience layer — and that layer is the entire differentiator + SEO lane.**

Concretely missing for the non-coder audience:
- **Templates / quickstarts** ("Start a CRM / Blog / Project Tracker / Inventory") — currently ~0%.
- **Guided onboarding** with demo data and a "create your first row" moment — currently lands on an empty editor.
- **Visual query/filter builder** (no SQL) — partial.
- **Automation / workflows** ("when a row is added, send an email") — 0%.
- **Forms** to collect data from the public without code — 0%.
- **Undo/version history presented as plain "undo/snapshots"**, not git "branches/merges" — needs a non-coder reskin.
- **Social-login / auth setup as a 1-click wizard** — currently requires OAuth client setup.

**Build the right 30% (the skin), not more of the 70% (the engine).**

## 9. In scope (v1) vs Out of scope (later)

**In scope — v1 ("aim high on ONE thing"):** make the **database itself world-class for non-coders.**
- Polished point-and-click table + data editing (extend the strong grid).
- Plain-language **undo / version history** (reskin Dolt branching).
- Guided onboarding + a few **templates**.
- Predictable, honest pricing (see §11 decision).
- Reliable provisioning of a Dolt database per customer.

**Out of scope — long run (funded by paying customers, wired via per-project MCPs):**
1. **S3 storage sold as a service** (the storage layer Dolt needs internally, extended outward — cheap because it already exists).
2. **Auth as a service** (let customers use Briven auth as their own login system — scaffolding exists).
3. **mavi-pay** as the billing provider (replace/augment Polar via the existing `BillingProvider` interface).
4. Automation/workflows, forms, deeper dev features.

## 10. Roadmap sequence

1. **v1:** non-coder database experience (the skin on the existing engine). → soft launch → first paying customers.
2. **v1.5 fast-follow:** S3-storage-as-a-service (reuse internal storage).
3. **v2:** Auth-as-a-service.
4. **v2+:** mavi-pay integration; automation/forms; MCP so Briven ↔ mavi-pay ↔ other flndrn apps talk during builds.

## 10b. 🏁 Sprint 1 — finish line (LOCKED 2026-06-15)

**Definition of done:** *A non-coder can sign up → start from a ready-made template → add & edit their data with a friendly Undo → and load money (prepaid) to keep using it.* = launchable, money-taking Briven.

**5 pillars:**
1. Guided onboarding + 1–2 templates (land → succeed in 5 min).
2. "Undo / Snapshots" — reskin Dolt version history (non-scary, the differentiator).
3. "Developer mode" toggle — hide SQL/dev surface from non-coders by default.
4. Prepaid wallet billing — load → draw down → alerts → no surprise bills (HOT ZONE).
5. Polish table/data editing (already ~80%).

**Explicitly post-launch (not this sprint):** automation/workflows, forms, S3-as-service, auth-as-service.

## 11. Key build decisions + my proposed defaults

- **Pricing model — ✅ DECIDED (2026-06-15): PREPAID balance + usage overages + spend-cap/alerts.**
  - **Free tier:** free but limited — no payment, no balance required.
  - **Paid:** strictly **PREPAID** — the customer **loads money first**, then usage (incl. overages €0.30/1M invocations, €1.50/1GB DB, €0.05/1GB storage) draws *down* that balance. **No pay-after / no postpaid / no invoicing.** Running low → alert → top up. Balance empty → service pauses/asks to top up, never silent billing.
  - **Spend-cap + alerts:** YES. The prepaid balance *is* the hard ceiling — a customer can never spend money they haven't loaded, so surprise bills are structurally impossible.
  - **Build implication:** this needs a **wallet/credit-balance system** (load funds, draw down, alerts, pause-on-empty). Polar is subscription-oriented; a prepaid wallet likely points toward **mavi-pay sooner** (or a custom balance ledger). Flag at billing-build time (hot zone).
- **Audience framing default:** keep all the developer features that already exist (SQL editor, functions) but **hide them behind a "Developer mode" toggle** so non-coders never see them. Default surface = simple.
- **Onboarding default:** signup → pick a template (or blank) → land on a database with demo data + a guided first edit.
- **Version history default:** rename/reskin "branches & merges" → "Snapshots & Undo" in the non-coder UI; keep full Dolt power under the hood.
- **Engine default:** stay on Dolt for v1 (a Dolt→Postgres path is documented in `HANDOFF-DOLT.md` but not needed now).

## 12. 🔴 Hot zones (verify-before-build — see protocol)

Before changing anything in these, **state how I'll verify it, ask Jürgen first, and explain the blast radius:**
- **Billing / payments** (`apps/api/src/services/billing.ts`, `routes/billing.ts`) — money. Highest risk.
- **Auth / sessions** (`apps/api/src/lib/auth.ts`, `middleware/session.ts`) — lock people out if wrong.
- **Customer database provisioning + Dolt data** — losing/corrupting a customer's data is fatal.
- **Storage / MinIO + the S3 presigner** (`apps/api/src/lib/s3-presign.ts`).

**Verification rule (all work):** before starting, state how I'll verify it; after finishing, run the checks and report results.

## 13. Open questions for Jürgen

1. Pricing: flat predictable (recommended) or keep usage overages? (§11)
2. Which 3–5 **templates** matter most to your target users? (CRM? Inventory? Bookings? Blog?)
3. Is there a first **dogfood customer** we can aim v1 at (e.g. mavi finans)?

---

*Foundation: Dolt (open-source, self-hosted). Apps: `api` (Hono/Bun control plane), `studio` (dashboard), `web` (marketing), `docs`, `runtime` (Deno functions), `realtime` (websockets). Billing: Polar today → mavi-pay later. Storage: MinIO/S3. Auth: better-auth.*
