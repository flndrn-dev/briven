#!/usr/bin/env tsx
/**
 * scripts/rebrand-strings.ts
 *
 * Phase 3 of BACKEND_FORK_BRIEF.md — mechanical case-sensitive rebrand sweep
 * across the vendored Studio fork. Run before the visual-restyle phases.
 *
 * Usage:
 *   pnpm tsx scripts/rebrand-strings.ts                # default target: apps/studio
 *   pnpm tsx scripts/rebrand-strings.ts apps/studio    # explicit target
 *   pnpm tsx scripts/rebrand-strings.ts --dry-run      # report counts, no writes
 *
 * Replacements (case-sensitive):
 *   Supabase  -> Briven
 *   supabase  -> briven
 *   SUPABASE  -> BRIVEN
 *   SUPA_     -> BRVN_
 *   supa_     -> brvn_
 *
 * Protected tokens (NOT rewritten — would break runtime):
 *   - @supabase/...           (npm scope; published packages we cannot rename)
 *   - @supabase-labs/...      (same)
 *   - supabase.com / .io / .co URLs and subdomains (Phase 4 handles via CSP/link audit)
 *   - .supabase. fragments inside hostnames (e.g. db.fqfdjxabc.supabase.co)
 *
 * Excluded paths:
 *   - node_modules/, .next/, .turbo/, dist/, build/, coverage/
 *   - public/  (Phase 4: brand-asset rebrand)
 *   - lock files (pnpm-lock.yaml, package-lock.json, yarn.lock)
 *   - binary files (by extension)
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targets = args.filter((a) => !a.startsWith('--'));
const rootTargets = targets.length > 0 ? targets : ['apps/studio'];

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.tsup',
  'dist',
  'build',
  'coverage',
  '.git',
  'public',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.webp',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp4',
  '.webm',
  '.mp3',
  '.wav',
  '.ogg',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.wasm',
  '.node',
  '.so',
  '.dylib',
  '.dll',
  '.lock',
  '.snap',
]);

const SKIP_FILENAMES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb']);

const PROTECT_PATTERNS: RegExp[] = [
  /@supabase-labs\/[a-z0-9-]+/g,
  /@supabase\/[a-z0-9-]+/g,
  /\b[a-z0-9-]+\.supabase\.(?:co|com|io)\b[^\s'"\)<>]*/g,
  /\bsupabase\.com\b[^\s'"\)<>]*/g,
  /\bsupabase\.io\b[^\s'"\)<>]*/g,
  /\bsupabase\.co\b[^\s'"\)<>]*/g,
  /\bgithub\.com\/supabase[a-z0-9_-]*\/[^\s'"\)<>]+/g,
  /\bgithub\.com\/orgs\/supabase[^\s'"\)<>]*/g,
  /\bsupabase_(?:admin|auth_admin|storage_admin|functions_admin|realtime_admin|replication_admin|read_only_user)\b/g,
  /\bsupabase_(?:functions|migrations)\b/g,
  /\bclient_connections_supabase_[a-z_]+\b/g,
];

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/Supabase/g, 'Briven'],
  [/SUPABASE/g, 'BRIVEN'],
  [/SUPA_/g, 'BRVN_'],
  [/supa_/g, 'brvn_'],
  [/supabase/g, 'briven'],
];

interface FileResult {
  path: string;
  matches: number;
  protected: number;
}

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (EXCLUDED_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      walk(p, out);
    } else if (e.isFile()) {
      if (SKIP_FILENAMES.has(e.name)) continue;
      if (BINARY_EXTENSIONS.has(extname(e.name).toLowerCase())) continue;
      out.push(p);
    }
  }
}

function rebrand(content: string): { out: string; matches: number; protectedCount: number } {
  const placeholders: string[] = [];
  let working = content;
  let protectedCount = 0;

  for (const pat of PROTECT_PATTERNS) {
    working = working.replace(pat, (m) => {
      const idx = placeholders.length;
      placeholders.push(m);
      protectedCount++;
      return `PROTECT${idx}`;
    });
  }

  let matches = 0;
  for (const [pat, repl] of REPLACEMENTS) {
    working = working.replace(pat, () => {
      matches++;
      return repl;
    });
  }

  working = working.replace(/PROTECT(\d+)/g, (_m, idx) => placeholders[Number(idx)]);

  return { out: working, matches, protectedCount };
}

function main(): void {
  const repoRoot = process.cwd();
  const files: string[] = [];
  for (const t of rootTargets) {
    walk(t, files);
  }

  const results: FileResult[] = [];
  let totalMatches = 0;
  let totalProtected = 0;
  let filesChanged = 0;

  for (const f of files) {
    let raw: string;
    try {
      raw = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const { out, matches, protectedCount } = rebrand(raw);
    totalProtected += protectedCount;
    if (matches === 0) continue;
    results.push({ path: relative(repoRoot, f), matches, protected: protectedCount });
    totalMatches += matches;
    filesChanged++;
    if (!dryRun) {
      writeFileSync(f, out, 'utf8');
    }
  }

  results.sort((a, b) => b.matches - a.matches);
  const topN = 25;
  for (const r of results.slice(0, topN)) {
    process.stdout.write(`${String(r.matches).padStart(5)} ${r.path}\n`);
  }
  if (results.length > topN) {
    process.stdout.write(`  ... ${results.length - topN} more files\n`);
  }
  process.stdout.write(
    `\n${dryRun ? '[dry-run] ' : ''}` +
      `targets=${rootTargets.join(',')}  ` +
      `scanned=${files.length}  ` +
      `changed=${filesChanged}  ` +
      `replacements=${totalMatches}  ` +
      `protected=${totalProtected}\n`,
  );
}

main();
