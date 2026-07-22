# Briven Auth UI — match the rest of the dashboard

**Rule:** Every Auth screen must feel like **briven.tech/dashboard** and **projects**, not a separate product skin.

## Copy these patterns

| Pattern | Where it already lives | Auth must do |
|---------|------------------------|--------------|
| Page header | `/dashboard/projects` | `font-mono text-xl` title + muted count line |
| Home hero | `/dashboard` | greeting (optional) + `font-sans text-2xl` title |
| Cards | project list / overview | `rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)]` |
| Grid | projects list | `grid` 1→2→3→4 cols |
| Primary button | “new project” | green `var(--color-primary)` for platform actions |
| Auth accent | sidebar Auth row | butter yellow **`#FFFD74`** for Auth identity only |
| Tabs | `project-tabs.tsx` | underline active tab + **developer mode** for advanced |
| Empty state | projects empty | dashed border + short plain copy |
| Type | all dashboard | mono for labels/body; sans for big titles |
| Tone | all dashboard | lowercase product copy, short sentences, no engineer “phase” text |

## Do not

- SuperTokens branding or third-party logos as the product name  
- Yellow “control room / phase” banners  
- A different layout language than projects/overview  
- Walls of internal rebuild text for users  
- **Fork SuperTokens** (or reimplement Core as a Briven fork named “engine”) — UI is Briven; Auth brain stays official SuperTokens  

## What we will not do (locked)

1. SuperTokens branding in the product UI  
2. A different visual system only for Auth  
3. Engineer “phase / rebuild” text in the UI  
4. **Forking SuperTokens** (most important)

## Blank phase (until SuperTokens product is ready)

- One blank Auth page inside the same dashboard shell (sidebar + layout tokens).  
- Same header style as projects: title **Auth** + one calm muted line.  
- No fake feature tabs until a phase is live-OK.  
