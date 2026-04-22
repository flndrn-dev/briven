# @briven/config

Shared TypeScript, ESLint, Prettier, and Tailwind v4 config for the briven monorepo.

## Usage

**tsconfig** — extend one of the presets from each app / package:

```json
{
  "extends": "@briven/config/tsconfig/next.json"
}
```

Presets:

| Preset | Use for |
|--------|---------|
| `base.json` | library-level base; other presets extend it |
| `next.json` | Next.js apps (App Router) |
| `node.json` | Node 20 LTS services and scripts |
| `bun.json` | `apps/api` and anything running on Bun |
| `react-library.json` | `packages/client-react`, `packages/ui` |

**eslint** — in each app's `eslint.config.js`:

```js
import next from '@briven/config/eslint/next';
export default next;
```

Presets:

| Preset | Use for |
|--------|---------|
| `base` | any TypeScript code |
| `react` | React + hooks |
| `next` | Next.js apps |

**tailwind** — in each app's global stylesheet:

```css
@import "@briven/config/tailwind/theme.css";
```

This imports `tailwindcss` and declares all brand tokens from `BRAND.md §3.2`. Do not redeclare these tokens locally.
