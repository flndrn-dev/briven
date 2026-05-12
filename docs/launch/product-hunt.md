# Product Hunt launch — copy + assets checklist

**Status:** draft. Confirm launch date once private beta is ~30 days from public open.
**Launch day target:** Tuesday or Wednesday. PT timezone (PH ranks PST/PDT submissions in their day-1 window).

---

## Listing fields

### Name

`briven`

(lowercase. brand rule per BRAND.md §0.)

### Tagline (max 60 chars)

Options:

1. `Open-core reactive Postgres backend for TypeScript` (52)
2. `Convex-on-Postgres — self-hostable, reactive, owned` (53)
3. `Reactive queries on plain Postgres. AGPL. AI-native.` (53)

Pick (1) — most descriptive, surfaces the three differentiators (open-core, Postgres, TypeScript).

### Description (260 chars max — read aloud test it)

```
Briven is an open-core reactive backend for TypeScript. Postgres underneath, with a typed schema DSL, function wrappers, and a websocket layer that makes any query reactive without changing the function body. Self-host AGPL-3.0 or use briven.tech.
```

(255 chars. fits.)

### First comment (the "maker comment" — required for ranking)

```
hi product hunt — briven is the backend i kept wishing existed every time i picked between a managed reactive service (convex, supabase) and rolling my own on postgres.

what's in the box:
• typed schema dsl + function wrappers (query / mutation / action) — feels like convex
• reactivity via plain postgres LISTEN/NOTIFY — no shadow data layer
• ai features (schema gen, function gen, code explain, docs ask) on a self-hosted qwen 2.5-coder — no third-party ai
• a migration playbook for convex / supabase / firebase / prisma / drizzle / mongo — each its own page
• agpl-3.0 engine, mit cli + sdks, commercial licence for use cases agpl doesn't cover
• one-command self-host via dokploy or coolify; ghcr images available

what briven is NOT:
• not serverless (long-running deno isolate per project)
• not graphql (rest + websocket)
• not multi-region day one

the hosted briven.tech is in private beta — about 25 hand-picked invites at this stage. self-host is open today.

i'll be live in the comments through the day. specifically interested in:
1. what does your current backend pain look like? what would unblock a migration?
2. anything you'd want covered in the migration docs that isn't there
3. honest read on the AGPL stance — does it disqualify briven for what you're building?

thanks for the time.
— j
flndrn limited · limassol, cyprus
```

---

## Assets (1280×720 thumbnail + gallery)

### Thumbnail (1280×720, max 2 MB)

**Concept:** the briven landing page hero on a dark background, with the install command visible. Single screenshot. No collage.

Capture script:
- Open briven.tech in a 1280-wide viewport
- Take a screenshot of just the hero section (logo + tagline + install block + LiveBadge)
- Compress to < 500 KB
- Save as `assets/launch/product-hunt-thumbnail.png`

### Gallery images (up to 8, 1280×720)

In order — Product Hunt shows them carousel-style:

1. **Landing page** — same hero as thumbnail but framed wider
2. **Dashboard project overview** — show the four cards + sparkline. Pick a project with realistic counts (handlr.sh after migration, or a demo project).
3. **Schema editor / studio table view** — shows briven is "real backend", not just a wrapper
4. **AI schema generator in action** — input prompt + generated schema visible
5. **Function code example** — `briven/functions/listPosts.ts` rendered with syntax highlighting (use carbon.now.sh or a screenshot of vscode)
6. **Migration page** — open one of the per-source pages (convex is the most-known reference)
7. **Self-host install block** — terminal screenshot of the three docker compose commands
8. **Status page** — green dots on all four services

Each image needs:
- 1280×720 exactly (PH crops anything else awkwardly)
- < 1 MB (faster carousel load)
- File name pattern: `assets/launch/product-hunt-gallery-NN-name.png`

### Video (optional but boosts ranking)

30–60 seconds. Loom-style screen recording. Script:

> [0:00] "this is briven. a reactive backend that runs on postgres."
> [0:04] *terminal opens, types `npx briven init`*
> [0:10] *briven.config + schema.ts open in the editor side-by-side*
> [0:18] *add a table in schema.ts, save*
> [0:22] *terminal: `briven deploy` — green output*
> [0:30] *browser shows a react component, useQuery hook, data appears*
> [0:36] *open dashboard, ai schema tab*
> [0:40] *type "a blog with posts and comments" → generated schema appears*
> [0:50] *cut to the source repo on konnos*
> [0:55] *card: "open-core. agpl-3.0. self-hostable. briven.tech"*

Render at 1920×1080, downscale to 1280×720 for PH. Keep under 4 MB.

---

## Topics + tags

PH lets you pick 3 topics. Recommended:

1. **Developer Tools** — primary
2. **Databases** — secondary; postgres-anchored
3. **No-Code & Low-Code** — tertiary (debatable; only if the AI features are emphasised heavily — otherwise pick "Open Source" instead)

Hashtags in the description / first comment if Product Hunt has migrated to that surface: `#postgres` `#typescript` `#opensource` `#reactive` `#self-hosted`.

---

## Launch-day tactical plan

**T-7 days:**
- Submit listing as a draft. Get the URL.
- Pre-line up "hunter" — someone with >500 followers willing to launch your product. If you don't have a hunter, launch yourself; ranking is slightly lower but credible.

**T-3 days:**
- Email your beta cohort (the ~25 invited users) with the PH link + a request to upvote IF they're genuinely happy with briven. Never bribe upvotes — PH bans aggressively.
- Pin a tweet from `@brivendev` (or j's personal account) announcing the launch date.

**T-1 day:**
- Final asset review — open every image in fresh tabs, check they look right.
- Status page green.
- Schedule a tweet for 0:01 PT on launch day with the PH link.

**Launch day:**
- 0:01 PT — PH listing goes live. First tweet drops.
- Within the first 30 min — post the maker comment.
- Through 09:00 PT — reply to every comment within 15 minutes. This is where ranking is won.
- After 12:00 PT — reply to remaining comments at a normal pace. The early-engagement window is the leverage point.
- 18:00 PT — wrap-up comment on the listing summarising what you learned + thanking commenters. Drives day-2 ranking.

**T+1 day:**
- Tweet a wrap-up with the final position + main feedback themes.
- Email the beta cohort with the launch result.
- If briven made top-5 of the day → blog post on briven.tech/blog/product-hunt-launch.

---

## Pre-launch checklist

- [ ] briven.tech health check green
- [ ] docs.briven.tech /quickstart works on a fresh browser, mobile + desktop
- [ ] status.briven.tech (or docs.briven.tech/status while DNS lands) green
- [ ] AI features lit up — schema gen works in < 10 s on the live model
- [ ] Self-host install works on a fresh Ubuntu 24.04 VPS (clone → docker compose up → sign in works)
- [ ] GHCR images public + pull-able
- [ ] Discord server up + invite link generated
- [ ] At least one published case study or testimonial visible
- [ ] Thumbnail + 8 gallery images + video uploaded to PH draft
- [ ] First-comment text rehearsed
- [ ] Calendar blocked launch day — no other commitments

---

*end of product hunt launch plan.*
