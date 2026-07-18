# auth-pilot

Smallest trustworthy Briven Auth setup for a real browser test.

**For humans:** follow `AUTH-GO-LIVE-CHECKLIST.md` in the Briven repo.  
**For agents:** follow the `briven-auth` skill.

## What you get

Not a full product UI — a **wiring kit**:

1. Next-style `middleware.ts` that forwards `/api/auth/*` to Briven  
2. `lib/auth.ts` using `@briven/auth`  
3. Env template for project id + `pk_briven_auth_…`  
4. One hosted sign-in button pattern  

Email + password only is enough for a pilot. Turn on Google/magic link later in the dashboard.

## 10-minute path

```sh
# 0. you already have a Briven project + Auth enabled in the dashboard

# 1. copy this folder into your app monorepo (or start from an empty Next app)
cp -r examples/auth-pilot my-auth-pilot
cd my-auth-pilot

# 2. link to your project (writes projectId into briven.json)
briven link

# 3. generate/refresh scaffold files (safe: will not overwrite existing .env.local)
briven auth scaffold

# 4. install the client
pnpm add @briven/auth
# React UI optional:
# pnpm add @briven/auth   # react hooks live at @briven/auth/react

# 5. paste pk_briven_auth_… into .env.local
#    NEXT_PUBLIC_BRIVEN_AUTH_KEY=pk_briven_auth_…
#    BRIVEN_AUTH_PUBLIC_KEY=pk_briven_auth_…   # same value

# 6. run your Next app, open the sign-in page, complete checklist rows 0–4 + 7
```

## Files in this folder

```
auth-pilot/
├─ briven.json          # name only until `briven link`
├─ middleware.ts        # /api/auth/* → api.briven.tech/v1/auth-tenant/*
├─ lib/
│  └─ auth.ts           # createBrivenAuth client
├─ app/
│  └─ sign-in/
│     └─ page.tsx       # hosted sign-in redirect button
└─ README.md
```

## Security

- Only `pk_briven_auth_…` in the browser.  
- Never commit a filled `.env.local`.  
- Do not paste full keys into chat.

## Docs

- https://docs.briven.tech/auth  
- Briven repo: `AUTH-GO-LIVE-CHECKLIST.md`
