# Case study template — briven migration stories

**Use this for every migrated product.** Three completed case studies are the Phase-4 publishable goal. Each lives at `briven.tech/case-studies/<product-slug>` once the migration clears.

The template is opinionated about structure because we want consistent "what was the actual change" framing — not the marketing-speak case studies that talk about "transformative ROI" and never mention a concrete metric.

---

## Template

```markdown
# <product name> on briven

**Migrated:** YYYY-MM-DD
**Migration time:** X days (calendar) · Y hours (focused work)
**Migration source:** <convex / supabase / firebase / prisma / drizzle / mongo / raw postgres>
**Briven tier:** <Pro / Team>

---

## The product

<2-3 sentences. What does this product do? Who uses it? Roughly how big is it (MAU / queries-per-day / db-size — pick whatever the operator is willing to share)?>

## What was running before

<concrete stack — language, framework, hosted services, db. include cost order-of-magnitude if disclosed.>

**Why move?** <one sentence — the specific pain that triggered the migration.>

## What changed

<3-5 bullet points. The CONCRETE things. Examples:>
- Schema port: <N tables, X foreign keys, Y embedded jsonb columns>
- Function port: <N functions — Z queries, M mutations, K actions>
- Data move: <pg_dump | mongoexport size, parallel-run window length>
- Auth port: <old auth → better-auth via briven, X users carried over>
- Cost: <before €X/mo → after €Y/mo, ratio>

## What didn't change

<important. counters the "rewrite everything" narrative.>
- <e.g. "the react client kept using the same generated types; only the import changed from `@convex/react` to `@briven/react`">
- <e.g. "stripe webhooks kept hitting the same URL — we just re-routed inside briven">

## The hardest part

<the honest one. every migration has a friction point. examples:>
- Convex's `v.union(v.literal(...))` doesn't have a direct briven equivalent — every union field became text + an app-level validator. Took two passes to catch every case.
- Firestore's document IDs were embedded in URLs and couldn't change. Kept them as ObjectId-styled strings; new rows get ULIDs.
- RLS policies on Supabase had to be re-expressed as function-code guards. Two policies were redundant; one was a bug we'd been carrying.

## The win

<one specific operational improvement that's not "it's faster". examples:>
- Local dev now runs against a local postgres docker — no more "wait for the cloud project to wake up" on every PR.
- Backup is `pg_dump | tee s3 | tee local`. We can grep production data; we couldn't before.
- The reactive query that drove dashboard refresh used to live in three places (server polling, client websocket reconnect logic, manual cache invalidate). Now it's one `useQuery` hook.

## What I'd tell someone considering the same migration

<2-3 sentences. honest.>

## Operator quote (optional)

> "<one or two sentences from the operator about the migration experience. ideally something specific — 'the schema port was a day; the function port was three days' beats 'the team was great'.>"
> — <name, title, product>

---

## Numbers (where comfortable)

| Metric | Before | After |
|---|---|---|
| Monthly backend cost | €X | €Y |
| Avg query latency p50 | Xms | Yms |
| Avg query latency p99 | Xms | Yms |
| Deployment time | Xs | Ys |
| Lines of code in `<old-backend>/` | X | (deleted) |
| Lines of code in `briven/` | — | Y |

(only fill the rows you have honest numbers for. don't invent.)

---

## What we'd do differently next time

<one or two items. counters the "everything was perfect" framing.>
```

---

## Three case-study slots to fill

Per BUILD_PLAN.md Phase 4 exit criteria. Suggested order:

1. **handlr.sh** — first to migrate (Phase 2 slot #4). Low-stakes, useful platform soak before higher-stakes products. The case study lands once the migration has 30 days of clean uptime — sets the precedent.
2. **cyclingtravel.eu** (or whichever's next in the sequence) — seasonal, shipped during the off-season migration window. Highlights "migrate when traffic is low" as a tactic.
3. **ghostbot.dev** — complex (multi-LLM, agents, RAG). Highlights briven handling a non-trivial code base.

mavi finans is explicitly NOT in the launch case-study set. It's the regulated-fintech migration that lands only after 60 days clean on everything else. If it migrates successfully it becomes the marquee case study post-launch, but it's not a launch-day asset.

---

## Distribution

Each case study, when finalised:

1. Lives at `briven.tech/case-studies/<slug>` (new marketing page route — needs to be built; one tsx page per case study).
2. Linked from the marketing footer under "case studies".
3. Linked from the docs.briven.tech /migration/<source> page if the source matches (so a convex-mover lands on the convex migration page and sees a real case-study link there).
4. Cross-posted as a longform on dev.to / hashnode with a "this is also on briven.tech/case-studies/<slug>" attribution.
5. Tweeted with a graphic — pull the "what changed" table as a render.

---

## Operator buy-in

For each case study, get the operator's written sign-off on:

- The product name + description as published.
- The numbers in the metrics table (or which rows to remove).
- The "hardest part" framing.
- The optional quote (with attribution).

A signed permission email is enough — solicitor sign-off only needed if the operator is bound by their own legal/marketing process. Keep these emails in `docs/launch/permissions/<slug>.eml`.

---

*end of case study template.*
