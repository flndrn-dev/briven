# auth-pilot

Smallest trustworthy **Briven Auth** setup for a real browser test (dogfood kit).

**For humans:** follow repo root `AUTH-GO-LIVE-CHECKLIST.md` + `BETA-V1-NEXT-STEPS.md`.  
**For agents:** follow the `briven-auth` skill.

## What you get

Not a full product UI — a **wiring kit**:

1. Next-style `middleware.ts` that forwards `/api/auth/*` to Briven  
2. `lib/auth.ts` using `@briven/auth`  
3. Env template for project id + `pk_briven_auth_…`  
4. One hosted sign-in button pattern  

Email + password only is enough for a pilot. Turn on Google/magic link later in the dashboard.

**If you enable two-factor:** after password sign-in, users may hit the hosted
`/auth/<projectId>/two-factor` step (authenticator code **or** a backup recovery
code). In React apps use `TwoFactorChallenge` from `@briven/auth/react`.

**For CI/e2e:** mint a testing token in the dashboard (or admin API) and call
`auth.signIn.testToken(process.env.BRIVEN_AUTH_TEST_TOKEN!)`.

## 10-minute dogfood path (recommended)

```sh
# 0. Platform awake (or ask an agent)
#    curl -s https://api.briven.tech/ready   → redis: ok

# 1. Copy this kit
cp -r examples/auth-pilot ~/Desktop/auth-pilot-dogfood
cd ~/Desktop/auth-pilot-dogfood

# 2. One command: sign in + new or existing project + wire folder
#    NEW project:
briven setup --name auth-pilot
#    OR attach an EXISTING project:
# briven setup --project p_YOUR_ID

# 3. Auth scaffold (middleware + lib/auth + env template)
briven auth scaffold
pnpm add @briven/auth

# 4. Dashboard: project → Auth → Enable (if needed) → API keys → create
#    pk_briven_auth_…  (browser only — never brk_)

# 5. Paste into .env.local (do not commit)
#    NEXT_PUBLIC_BRIVEN_PROJECT_ID=p_…
#    NEXT_PUBLIC_BRIVEN_API_ORIGIN=https://api.briven.tech
#    NEXT_PUBLIC_BRIVEN_AUTH_KEY=pk_briven_auth_…
#    BRIVEN_AUTH_PUBLIC_KEY=pk_briven_auth_…   # same value

# 6. Run your Next host, open /sign-in
# 7. Complete AUTH-GO-LIVE-CHECKLIST rows 3, 4, 7 (sign-up, wrong password, refresh)
```

### Manual key path (if you already have a key)

```sh
briven login --project p_… --key brk_…   # server/cli key only
briven link
briven auth scaffold
```

## Files in this folder

```
auth-pilot/
├─ briven.json          # name only until setup/link
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
- https://docs.briven.tech/connect  
- Repo: `AUTH-GO-LIVE-CHECKLIST.md`, `BETA-V1-NEXT-STEPS.md`, `docs/S6-RELIABILITY.md`
