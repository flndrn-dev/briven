# Contributing to briven

Thanks for considering a contribution. briven is open-core (AGPL-3.0 for the
engine, MIT for CLI/SDKs) and lives at <https://code.konnos.org/flndrn/briven>.
This guide is short on purpose: we want you to spend your time on code, not on
process.

## Quick start

```sh
git clone https://code.konnos.org/flndrn/briven.git
cd briven
pnpm install
pnpm dev          # starts api, web, docs, runtime, realtime in parallel
```

The first run downloads ~1 GB of toolchain (deno, bun, postgres client,
turborepo cache). Subsequent runs are instant.

## Before you open a PR

- `pnpm typecheck` passes everywhere
- `pnpm test` passes for the package(s) you touched
- new public APIs have at least one test
- commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (e.g. `feat(api): add bulk-delete to studio`). The commit hook will refuse
  anything else.

## What to work on

- The repo's TODO list is internal — the public-facing one is
  [`docs.briven.cloud/roadmap`](https://docs.briven.cloud/roadmap). Anything
  on that page is fair game.
- Issues tagged `good first issue` on Gitea are scoped for first-time
  contributors and have a paragraph of context attached.
- For larger ideas (new language SDK, new self-host target, new tier), open
  an issue first so we can align before you sink hours in.

## Tests

We use [vitest](https://vitest.dev) for unit tests, and the api integration
tests use a real Postgres. Bring one up locally with:

```sh
pnpm dlx briven-dev-postgres   # starts postgres in docker on :15432
BRIVEN_DATABASE_URL=postgres://postgres:postgres@localhost:15432/briven_test \
  pnpm --filter @briven/api test
```

Mocking the database is forbidden — every test that touches the DB hits a
real Postgres. Mocked tests have masked enough production breakage in the
past (migrations, lock orderings, JSON shape drift) that we don't allow it.

## Sign-offs

If you're adding code AGPL bits and you wrote it on the clock for an employer,
get sign-off before opening the PR. If your PR includes >100 LOC of code you
didn't author yourself, link the source.

## Filing a security issue

Don't open a public issue. Email `flandriendev@hotmail.com` with the details
and a proof of concept. We'll acknowledge within 48 hours and disclose
publicly once a fix is shipped.

## Releases

`main` is always shippable. Tagged releases (`v0.x.0`) are cut by the maintainer
when feature batches converge. Self-hosters tracking releases should pin to a
tag in their compose file; production users on briven.cloud always get `main`.
