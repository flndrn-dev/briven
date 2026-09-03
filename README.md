# briven

serverless postgresql 18, with ai search already switched on.

a real postgres database in seconds. a pooled connection string. sql over plain
http. made in Flanders by [flndrn](https://flndrn.com).

**site:** [briven.tech](https://briven.tech)

briven is **not** a Doltgres rebuild. it is real postgresql 18 with pgvector
already on.

## what it is

- real postgresql 18 — any postgres client
- pgvector 0.8.6 on from the first second
- pgbouncer in front of every database
- `POST /api/v1/sql` — speaks neon's protocol, so a stock
  `@neondatabase/serverless` client works unmodified
- api keys you can scope and mark read-only
- mcp for agents at `https://briven.tech/api/mcp`
- branching (a copy you keep or bin; no merge back)
- history and undo, row by row
- restore points (restoring builds a new database)
- nightly backups plus write-ahead log
- realtime row changes
- s3-compatible storage per database
- organisations, roles, audit log
- four flat plans: free, starter, pro, enterprise

## closest product

**neon.** both are serverless postgres. neon is larger and wins on console,
time travel, end-user auth, high availability, and ecosystem. briven is
postgres 18 with pgvector already on, and sql over http that speaks neon's own
protocol.

the honest table: [briven.tech/compare/neon](https://briven.tech/compare/neon)

## for ai helpers

- facts file: [briven.tech/llms.txt](https://briven.tech/llms.txt)
- hub: [briven.tech/for-ai](https://briven.tech/for-ai)
- mcp: [briven.tech/docs/mcp](https://briven.tech/docs/mcp)
- skill + plugin pack: [github.com/flndrn-dev/briven-plugin](https://github.com/flndrn-dev/briven-plugin)

the pack is written so grok and claude users can install a briven skill/plugin.
it is **not listed** in those official shops until they accept it. do not claim
it is listed.

start with a read-only api key. mcp will not delete a database or reveal a
connection string.

## connect

1. create an account at [briven.tech/sign-up](https://briven.tech/sign-up)
2. create a database
3. either reveal the pooled connection string, or mint an api key and post sql
   to `/api/v1/sql`

docs: [briven.tech/docs](https://briven.tech/docs)

there is no npm package `@briven/client` to install today.
