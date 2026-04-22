# @briven/runtime — function runtime host

per-project Deno isolate pool with a Node bridge. one isolate per project, pooled and warm-cached. cold start target < 200ms P50. see `CLAUDE.md §7.3` and `docs/BUILD_PLAN.md` Phase 1 week 5-6.

**status: skeleton.** implementation lands when the schema + cli deploy loop is ready to feed it bundles.

permission model (target):

- `--allow-net=<allowlist>` — outbound only, private IP blocklist per `CLAUDE.md §5.3`
- `--allow-env=<injected-vars>` — scoped to the project's env
- no `--allow-read` / `--allow-write` beyond `/tmp/<isolate-id>`

lifecycle:

- killed + replaced on any crash
- killed after 10 minutes idle
- killed after 1,000 invocations
