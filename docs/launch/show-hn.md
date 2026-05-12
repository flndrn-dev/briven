# Show HN draft

**Format:** "Show HN: <title> — <one-line tagline>"
**Publish:** Tuesday or Wednesday 8:00–10:00 AM Pacific (highest hn traffic window).
**Account:** post from j's named account, not a fresh one. fresh accounts get filtered.

---

## Title options (HN ranks title quality heavily)

1. **`Show HN: Briven – Open-core reactive Postgres backend for TypeScript`** — descriptive, mentions licence stance + storage choice
2. **`Show HN: Briven – Convex-on-Postgres, self-hostable, AGPL`** — implies a known reference, comma-rich
3. **`Show HN: Briven – Reactive queries on plain Postgres, no shadow data layer`** — leads with the technical hook

Pick (1) for broadest appeal. (3) for the postgres-heavy audience.

---

## Post body

> *HN body is plain text. no markdown. paragraphs separated by blank lines. max ~1500 chars works best.*

---

briven is an open-core reactive backend for TypeScript apps. Postgres underneath, with a typed schema DSL, function wrappers that handle transactions + validation, and a websocket layer that makes any query reactive without changing the function body. Self-host under AGPL-3.0, or use the hosted briven.tech.

The motivation was the gap between managed reactive backends (Convex, Supabase Realtime, Firebase — great DX, but proprietary storage + lock-in) and rolling reactivity yourself on Postgres (own everything, spend three weekends writing a NOTIFY-trigger generator + websocket bridge + invalidation system).

briven is the third option: Postgres is the storage (yours, accessible via psql / pg_dump), the reactivity is in the platform (auto-generated triggers, a thin websocket service, a TypeScript client that re-runs useQuery on table change). The function wrappers (`query()`, `mutation()`, `action()`) will be familiar from Convex; the storage layer is the standard one you already know.

What I think is non-obvious:

- Postgres is the boundary, not the abstraction. The reactivity uses Postgres's own LISTEN/NOTIFY — no shadow data layer.
- AI features (schema gen, function gen, code explain, docs assistant) run on a self-hosted Qwen 2.5-coder model. No third-party AI provider.
- There's a documented migration playbook for Convex / Supabase / Firebase / Prisma / Drizzle / raw Postgres / Hasura / NextAuth / MongoDB. Each is its own decision matrix, not just a "do these steps" list.
- AGPL-3.0 for the engine, MIT for SDKs + CLI. Commercial licence for use cases AGPL doesn't accommodate.

What briven is NOT:

- Not serverless. Functions deploy to a long-running Deno isolate per project; cold starts are a one-time thing.
- Not GraphQL. REST + websocket only.
- Not multi-region on day one. Self-host anywhere; briven.tech is EU-only through Phase 4.

Try it:

- Docs: https://docs.briven.tech
- Quickstart: https://docs.briven.tech/quickstart
- Source: https://code.konnos.org/flndrn/briven
- Hosted: https://briven.tech (private beta, ~25 hand-picked invites at this stage)

Happy to answer questions.

---

## Comment-section prep (likely first 10 questions)

Pre-write answers to the predictable HN questions so you can respond fast in the first hour (HN ranking heavily weights early engagement):

**"Why not just use Supabase?"**
> Supabase Realtime reads the WAL and re-encodes everything through their API. briven uses Postgres LISTEN/NOTIFY directly — the triggers live in your project's schema, the websocket service is thin, and the function body is the same whether the query is reactive or one-shot. Different trade — Supabase ships more features today, briven owns less of the data path.

**"Why AGPL? GPL kills adoption in companies."**
> Two reasons. (1) The AGPL clause is what makes "you can fork this and not let me run a SaaS on it" credible. (2) The commercial licence is the carve-out for companies that need to bundle or host. The default path is open-core, not source-available — the moment briven goes "you can read it but can't deploy it" it stops being trustworthy.

**"How does it compare to Convex?"**
> Function model is intentionally similar — `query()` / `mutation()` / `action()`. Storage is the big difference: Convex is proprietary; briven is Postgres. Migration off Convex is documented (docs.briven.tech/migration/convex). I'm migrating my own products off Convex onto briven as the dogfood path.

**"What about RLS / row-level security?"**
> briven enforces auth in function code, not at the database level. For new projects this is the right trade — auth lives next to business logic. For migrations from Supabase-with-RLS it's an explicit re-pattern. The migration page covers it.

**"Is there vector search?"**
> pgvector works directly today (Postgres extension, briven leaves it alone). A first-class wrapper SDK is a year-two item.

**"What hardware does the AI run on?"**
> Today it runs against an Ollama-compatible proxy I host. Local DGX coming in a few weeks. Models tested: Qwen 2.5-coder (default), DeepSeek-R1-distill-Qwen-32B for the explain feature, Qwen3:8b for docs Q&A. Operator can override per-feature via env vars (docs/AI.md).

**"What about [my favorite backend]?"**
> Honest answer: briven is opinionated. If you're happy with what you have, stay. The audience is people who hit the convex/supabase/firebase wall and want to move without rewriting everything.

**"How is this funded?"**
> Solo bootstrap. flndrn Limited (Cyprus). Revenue from hosted briven.tech once Phase 4 lands; before that the cost is my own time. No VC, no expansion plans beyond what I can sustain solo.

**"What's the moat?"**
> The migration story. There are many ways to write a reactive Postgres backend; the value is making it cheap to move your existing convex/supabase/firebase project onto one. Five years from now the cost is "we shipped the playbook + tested it ourselves."

**"Why not just Convex Backend (self-host)?"**
> Convex Backend is FSL — source-available but with use restrictions and a four-year clock to Apache 2.0. briven is AGPL-3.0 today. Different licensing posture, similar function model.

---

## Submission checklist

- [ ] Account karma > 50 (HN filters new/low-karma accounts)
- [ ] Title fits HN guidelines (no "the best" / "we built" / clickbait)
- [ ] First comment from j within 5 min of post — "thanks for the early reads, AMA"
- [ ] Reply to every comment in the first 4 hours; cool down after that
- [ ] No auto-vote rings, no asking friends to upvote (HN bans aggressively)
- [ ] briven.tech health check green at submission time
- [ ] docs.briven.tech /quickstart works end-to-end on a fresh browser
- [ ] Status page green
- [ ] HackerNews-friendly hero on briven.tech (no autoplay video, no popups, dark mode survives system preference)

---

*end of show hn draft.*
