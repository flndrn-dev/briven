# Briven Sprint 1 — Pillar plans (②–⑤)

> Recon by 4 parallel scouts, 2026-06-15. Plans only — NO code yet. Pillar ① backend is already built + typecheck-clean (see SPEC.md §10b + SKILL.md gotcha 10). **Every pillar below needs Briven RUNNING to verify (studio is a Supabase fork, `@ts-nocheck` — tsc can't catch frontend errors).**

---

## Pillar ② — "Snapshots & Undo" (reskin Dolt versioning)
**Approach:** Dolt already exposes version tables (`dolt_log`, `dolt_diff`, `dolt_commits`). Add new API endpoints `GET/POST /v1/projects/:id/studio/snapshots` (+ `/restore`, `/changes`) backed by Dolt SQL (`DOLT_COMMIT`, `DOLT_CHECKOUT`), and a new studio "Snapshots" page that reskins git words → plain language (branch→snapshot, merge→apply, commit→auto-saved, restore→undo).
**Files:** new `apps/api/src/services/snapshot.ts` + routes in `studio.ts`; new `apps/studio/.../SnapshotManagement/*` + `pages/project/[ref]/snapshots/`. Additive, ~1000 lines, no breaking changes.
**Must verify on running stack:** that `DOLT_COMMIT`/`DOLT_CHECKOUT` actually commit + revert data (insert row → does `dolt_log` record it? does checkout revert?). This is the make-or-break assumption.

## Pillar ③ — "Developer mode" toggle
**Approach:** Add a per-user `developerModeEnabled` (default false) on the `users` table, exposed via `/v1/me`. Studio nav filters out developer-only items when off: SQL Editor, Edge Functions, API keys, Webhooks, OAuth-provider setup. Non-coders see a clean Table Editor → Database → Auth → Storage surface.
**Files:** `apps/api/src/db/schema.ts` (+migration), `services/me.ts`, `routes/me.ts`; new `apps/studio/hooks/misc/useDeveloperMode.ts`; edit `NavigationBar.utils.tsx` + `Sidebar.tsx`; small toggle UI in settings.
**Must verify on running stack:** nav shows/hides correctly in both modes; setting persists.

## Pillar ④ — Prepaid wallet billing 🔴 HOT ZONE (money)
**Approach:** New tables `customer_wallet_balance`, `wallet_ledger_entries`, `wallet_low_balance_alerts`. Top-up route → balance; usage draws DOWN the balance (idempotent, keyed by usage_event id); low-balance email alerts; service pauses (402 "top up to continue") at zero. Free tier never touches the wallet.
**Files:** new `services/wallet.ts`, `workers/wallet-monitor.ts`; extend `routes/billing.ts`, `middleware/rate-limit.ts`, `workers/usage-aggregator.ts`, `db/schema.ts`.
**KEY DECISION (Jürgen):** build the wallet **custom now + Stripe top-ups** (unblocks v1; architect behind a `BillingProvider` interface so mavi-pay swaps in later) **OR wait for mavi-pay**. Polar (current) is subscription-only and does NOT do prepaid wallets.
**Also needs Jürgen sign-off:** the price list (€0.30/1M calls, €1.50/GB, €0.05/GB — confirm), min/max top-up, refund policy, PCI/VAT handling. NO billing code until these are locked.

## Pillar ⑤ — Polish table/data editing
**Approach:** API foundation is solid (parameterised, validated, audited). The rough edges are all UX/non-coder: "Add Row" hidden in a dropdown; no clear unsaved-changes warning; jargon filter labels ("gte" vs "≥"); 30+ raw Postgres types in the column picker; no single-operation undo; unhelpful error messages; CSV import only on empty tables.
**Files (tweaks):** `InsertButton.tsx`, `SaveQueueActionBar.tsx`, `Grid.tsx`, `DeleteConfirmationDialogs.tsx`, `OperationQueueSidePanel.tsx`, `ColumnEditor.tsx`, `ColumnDefaultValue.tsx`, filter UI, `useOperationQueueActions.ts`, `SpreadsheetImport*`.
**Prioritised:** Tier 1 = first-run (Add Row button, unsaved-changes guard, demo rows). Tier 2 = row-edit feedback + plain-English delete. Tier 3 = filter clarity. Tier 4 = friendlier column picker. Must verify on running stack.

---

**Common gate:** all four need Briven running to verify (Supabase-fork frontend can't be typechecked). Recommended order once running: finish ① screen → ⑤ polish (quick wins) → ③ dev-mode → ② snapshots → ④ wallet (after the money decisions are locked).
