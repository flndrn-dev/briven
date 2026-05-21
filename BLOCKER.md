# BLOCKER — Phase 2 (studio fork into briven repo)

**Phase**: 2 — copy `_reference/supabase/apps/studio/` → `apps/studio/`, register in pnpm workspace, make `pnpm install` succeed.

**Status**: BLOCKED. Awaiting J decision.

**Date raised**: 2026-05-21.

---

## What the brief assumed

`BACKEND_FORK_BRIEF.md` §5 Phase 2:

> - Copy `_reference/supabase/apps/studio/` into `apps/studio/` at the repo root (a copy, not a symlink, not a submodule)
> - Add to the pnpm workspace config
> - Resolve dependency conflicts with the existing control plane (likely React/Next.js version alignment)
> - Do not modify content yet beyond what's required to make `pnpm install` succeed
> - File in scope: workspace config files only; the copied tree is bulk-created in this phase but its contents are not edited

This wording presumed Studio is a self-contained Next.js app whose only external constraints are React/Next versions.

## What's actually true

Studio is not a self-contained app. It is the consumer end of a 17-package monorepo. Inside `_reference/supabase/apps/studio/`:

- `tsconfig.json` extends `tsconfig/nextjs.json` — a sibling workspace package.
- Cross-package imports (counted from `.ts` + `.tsx` source):
  - `from 'ui'` — **1,298** imports
  - `from 'common'` — **802**
  - `from 'ui-patterns'` — **233**
  - `from '@supabase/pg-meta'` (sibling at `packages/pg-meta/`) — **294** (across three subpath forms)
  - `from 'api-types'` — **117**
  - `from 'icons'` — **50**
  - `from 'shared-data'` — **37**

  Total ~2,830 import sites pointing at upstream workspace siblings.

- Studio's `package.json` references `catalog:` versions, which only work if `pnpm-workspace.yaml` defines the same catalog block (upstream defines `next: 16.2.6`, `react: ^19.2.6`, `@supabase/supabase-js: 2.106.0`, etc.).
- Upstream workspace also includes `blocks/*` and `e2e/*` globs and a `patches/react-data-grid.patch` referenced via `patchedDependencies`.
- Upstream lists `onlyBuiltDependencies: [node-pty, supabase]` — the second one is the supabase CLI itself, which would need a fork or a wrapper.

**`pnpm install` will fail immediately** with "workspace package not found" for `ui`, `common`, `ui-patterns`, `api-types`, `icons`, `shared-data`, `tsconfig`, and the catalog references.

## Directory collision (not name collision)

Briven already has its own `packages/` workspace:

```
packages/
  auth                   (@briven/auth)
  cli                    (@briven/cli)
  client-react           (@briven/client-react)
  client-svelte          (@briven/client-svelte)
  client-vanilla         (@briven/client-vanilla)
  client-vue             (@briven/client-vue)
  config                 (@briven/config)
  schema                 (@briven/schema)
  shared                 (@briven/shared)
  ui                     (@briven/ui)
```

Briven's packages are all **scoped** under `@briven/`. Upstream Studio siblings use **bare, unscoped names** (`ui`, `common`, `config`, `icons`, `shared-data`, `pg-meta`, `tsconfig`, `api-types`, `ui-patterns`).

That means there's no **name** collision in the pnpm sense — both `@briven/ui` and `ui` can co-exist in a single workspace because pnpm keys on full package name. But there is a **directory** collision: upstream's `packages/ui/` would overwrite briven's `packages/ui/` directory if dropped flat.

The fix is purely structural: land upstream siblings at a deeper path (`packages/studio/<name>/`), not at `packages/<name>/`.

We cannot mass-rename the upstream packages in this phase — the brief says "contents are not edited". A rename forces edits to ~2,830 import sites in Studio. That's a Phase 3 (rebrand) operation, not a Phase 2 (install) operation.

## Why this matters

Phase 2 demo per brief: from a clean clone, `pnpm install && pnpm --filter studio dev` starts the Studio on a local port. Without sibling packages on disk and resolvable, the demo never passes. Continuing without resolving this means landing 4,028 broken files at `apps/studio/` that can't compile.

---

## Three options for J

### Option A — copy siblings into a scoped subdir (recommended)

Land the upstream Studio dependency tree at `packages/studio/<sibling-name>/`, one level deeper than briven's own packages:

```
packages/
  auth                      <- briven (unchanged)
  cli                       <- briven (unchanged)
  ui                        <- briven (unchanged)
  ...
  studio/                   <- NEW: vendored upstream studio siblings
    ui              (was supabase packages/ui)
    common          (was supabase packages/common)
    ui-patterns
    api-types
    icons
    shared-data
    pg-meta
    tsconfig
    config          <- name collision resolved by directory depth, not by rename
    ai-commands
    dev-tools
    generator
    marketing
    build-icons
    eslint-config-supabase   <- rename in Phase 3, leave for now
```

`pnpm-workspace.yaml` adds one extra glob:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "packages/studio/*"   # NEW
```

pnpm resolves `from 'ui'` to upstream's bare `ui` package; `from '@briven/ui'` resolves to briven's own. Scoped vs unscoped — pnpm has no conflict. **No briven-side renames needed.** Directory nesting (`packages/studio/<name>/`) is the only structural change.

Also copies:
- `_reference/supabase/blocks/` → `apps/studio-blocks/` (or `packages/studio/blocks/`)
- `_reference/supabase/patches/react-data-grid.patch` → `patches/` at repo root
- `_reference/supabase/pnpm-workspace.yaml` catalog block — merged into `briven/pnpm-workspace.yaml`'s own catalog

**Cost**: ~150 MB on disk, ~17 new workspace packages. **No briven-side edits** beyond `pnpm-workspace.yaml`.
**Benefit**: Studio's contents are untouched. Phase 3 rebrand sweep then handles all ~2,830 import sites plus the sibling package internals in a single mechanical pass.
**Repo cleanliness**: visible boundary between "briven's own code" (`packages/*`, all `@briven/`-scoped) and "vendored upstream studio deps" (`packages/studio/*`, bare unscoped names).

### Option B — rename upstream siblings now (not recommended)

Bring siblings in at `packages/` directly, but rename each in this phase: `ui` → `studio-ui`, `common` → `studio-common`, etc. This requires editing the contents of the copied tree to fix ~2,830 import sites in Phase 2.

**Violates brief**: "contents are not edited" in Phase 2.

**Cost**: large diff in Phase 2 PR review. Effort that belongs to Phase 3.

### Option C — strip Studio's sibling imports

Resolve sibling imports by inlining or stubbing — e.g., copy only the symbols Studio actually uses from each sibling into Studio itself, then drop the siblings.

**Cost**: cannot be done mechanically. Each of the 14 packages exports a different surface area. Estimated effort: 1-2 weeks of manual work, with high regression risk.

**Recommended only if**: J wants a permanently lean Studio fork that's never going to track upstream supabase changes. Tradeoff: future upstream patches can't be merged.

---

## Recommended path

**Option A**, with the following sequence:

1. In this Phase 2 session (after J approval):
   1. Copy `_reference/supabase/apps/studio/` → `apps/studio/`.
   2. Copy `_reference/supabase/packages/{ui,common,ui-patterns,api-types,icons,shared-data,pg-meta,tsconfig,config,ai-commands,dev-tools,generator,marketing,build-icons,eslint-config-supabase}` → `packages/studio/`.
   3. Copy `_reference/supabase/blocks/` → `packages/studio/blocks/` (or `apps/studio-blocks/` — decide based on `blocks/*` content; likely apps-grade).
   4. Copy `_reference/supabase/patches/react-data-grid.patch` → `patches/react-data-grid.patch`.
   5. Update `briven/pnpm-workspace.yaml`:
      - Add `- "packages/studio/*"` glob.
      - Merge upstream's `catalog:` block (`next`, `react`, `react-dom`, `tailwindcss`, `typescript`, etc.).
      - Merge upstream's `overrides:` block.
      - Merge upstream's `patchedDependencies` reference.
   6. Run `pnpm install` from repo root. Resolve any version conflicts surface-by-surface. Document each in this file.
2. Demo: `pnpm --filter studio dev` starts Studio on its configured port (8082). Browser loads unmodified Supabase UI.

Files modified in this phase (workspace config only):

- `pnpm-workspace.yaml`
- `patches/react-data-grid.patch` (new)

All `apps/studio/**` and `packages/studio/**` contents remain **unedited** from upstream. Briven's existing `packages/*` are untouched.

---

## J's decision

- [ ] **Option A** (recommended): proceed with sibling vendoring at `packages/studio/`, rename briven's `ui` + `config` packages to `briven-ui` + `briven-config`.
- [ ] **Option B**: rename upstream siblings during Phase 2. Accepts the brief violation.
- [ ] **Option C**: strip Studio's sibling imports. Defer permanently from upstream tracking.
- [ ] **Other**: J writes in.

Until one is checked, Phase 2 does not proceed.
