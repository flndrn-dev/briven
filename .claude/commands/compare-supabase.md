---
description: Compare how supabase upstream implements a feature vs how briven implements it (or doesn't yet). Dispatches the ecc:code-explorer subagent against the read-only supabase reference clone at _reference/supabase/, then maps findings onto briven's own tree so you can spot drift, missing parity, or a clean implementation to copy.
allowed-tools: Agent, Read, Grep, Glob
---

You are dispatching the `ecc:code-explorer` subagent to do a side-by-side comparison of how Supabase implements a feature vs how briven implements (or fails to implement) the same thing.

The user wants to compare this feature/area:

$ARGUMENTS

Use the Agent tool with `subagent_type: "ecc:code-explorer"`. Brief the agent with the following:

---

You have read-only access to two parallel monorepos in the working directory:

1. **`_reference/supabase/`** — a 1.3 GB shallow clone of `github.com/supabase/supabase` at a recent commit. This is the source of truth for "how the upstream project does it". Never edit anything in there.
2. **The rest of the repo** (`apps/`, `packages/`, `infra/`, `docs/`) — the briven fork. This is what we actually ship.

Your job is a focused comparison report on the feature/area described above. Do not propose code changes — the parent thread will decide what to implement. Your only job is to surface ground truth.

For the feature/area, produce a report in this exact structure:

## 1. Upstream (supabase) implementation
- Entry-point file(s) and what they export, with `path:line` citations into `_reference/supabase/`.
- Key modules, packages, or services involved — name them and one-line each.
- Data flow / call graph in 3–8 bullets (request enters here → handler X → service Y → DB Z).
- External dependencies relevant to this feature (npm packages, system binaries, env vars).
- Any non-obvious decisions or workarounds (look for comments starting with `TODO`, `HACK`, `NOTE`).

## 2. Briven (our fork) implementation
- Same structure as section 1, but for the briven tree. Cite paths relative to repo root (no `_reference/` prefix).
- If briven does **not** implement this yet, write "**Not implemented in briven.**" and skip the rest of this section.
- If briven implements it but differently, name the difference plainly.

## 3. Delta
A markdown table with three columns: `Aspect | Supabase | Briven`. Rows for every meaningful divergence (file layout, package versions, env vars, runtime base image, dependency choice, naming, missing pieces, etc.). One row per aspect. Keep cells under ~12 words.

## 4. Risks if briven diverges further
3–6 bullets. What breaks, what gets harder to maintain, what compliance/security implications exist, what upstream changes will be hardest to track. Be concrete — name files and packages.

## 5. Pointers for follow-up
Files the parent thread should read next (with `path:line`) to act on this comparison. Order by what's most informative first. Cap at 8 entries.

Constraints:
- **Never pull large amounts of supabase source into your output.** Cite paths + line numbers and quote at most 5 lines per excerpt. The parent thread can Read the file if it needs the full context.
- If the feature spans many files, prefer **breadth over depth** — better to map 20 files at 1 line each than to dump 2 files in full.
- If `_reference/supabase/` is missing or empty, abort with a clear message saying the clone needs to be run first (`git clone --depth=1 --filter=blob:none https://github.com/supabase/supabase.git _reference/supabase`).
- If the feature/area description is ambiguous, pick the most plausible interpretation, name it in one sentence at the top of your report, and proceed.

Return only the structured report. No preamble, no closing remarks.
