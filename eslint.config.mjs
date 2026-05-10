// Flat ESLint config for the briven monorepo. Intentionally narrow — we
// only assert the rules that have caught real regressions in code review,
// and we lean on TypeScript's `--noEmit` for everything ESLint would
// otherwise duplicate.
//
// Why flat config:
//   - eslint v9+ defaults to flat; `eslintrc` is on its way out
//   - one file at the root drives every workspace; no per-package
//     copies to keep in sync
//
// Why we don't enable @typescript-eslint/recommended-type-checked:
//   - it requires `parserOptions.project` which makes lint orders of
//     magnitude slower and forces every `tsconfig.json` to opt in
//   - the rules it adds are largely redundant with TS strict mode

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  // Ignore generated artefacts before any rule loads — saves multi-second
  // walks of node_modules / .next / dist on every invocation.
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/dist/**',
      '**/dist-pack/**',
      '**/build/**',
      '**/coverage/**',
      '**/.pnpm-store/**',
      '**/*.d.ts',
      // Generated drizzle-kit migration snapshots — don't touch.
      '**/drizzle/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Globals — apply to every JS/TS file. node + browser is intentional;
  // briven ships server-side (node/bun) and browser SDKs from the same
  // tree, and our shared utilities target both.
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // TS-specific overrides — the recommended set is conservative; we tighten
  // the things that bit us during phase 0 and loosen the ones that produce
  // friction without catching bugs.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      // Enforce import-name correctness without forcing the type-checked
      // ruleset.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // we use `any` deliberately at boundary types where zod
      // post-transform shapes are awkward — prefer `unknown` everywhere
      // else, but warn rather than error so we can ship.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow `@ts-ignore` etc. with a justification.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': 'allow-with-description', 'ts-expect-error': 'allow-with-description' },
      ],
      // `no-empty-object-type` triggers on Hono's standard `{ Variables: {...} }` pattern.
      '@typescript-eslint/no-empty-object-type': 'off',
      // Allow `require()` only in JS config files (next.config, etc.).
      '@typescript-eslint/no-require-imports': 'error',
    },
  },

  // CommonJS / config files — relax module rules.
  {
    files: ['**/*.{js,cjs}', '*.config.{js,ts,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },

  // Tests — slightly looser; allow `any` for fixture shapes.
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/test-utils/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
