# Discord setup for briven beta

**Owner:** J. **Audience:** operator setting up the briven private-beta Discord.

This runbook covers how to create the briven Discord, the channel layout that matches BUILD_PLAN.md's beta posture, the bots to install, and the briven-side env vars to wire so the existing alertmanager → Discord pipeline and account-confirmation emails point at the right channels.

---

## 1. Create the server

In the Discord desktop app:

1. Click the **+** icon at the bottom of the server list → **Create My Own** → **For a club or community**.
2. **Server name:** `briven` (lowercase per BRAND.md §0).
3. **Icon:** upload `/assets/icon.svg` from the repo (Discord auto-rasterises to PNG).
4. **Region:** leave on auto-detect.

After creation, open **Server Settings** → **Overview** and set:

- **System Messages Channel:** none (we'll route join messages manually).
- **Default Notification Settings:** Only @mentions (so beta users aren't bombarded by every alert).

---

## 2. Channel layout

Create channels in this order. Right-click each category to set permissions.

### `#welcome` category — public to verified members

| Channel | Type | Purpose |
|---|---|---|
| `#welcome` | text · read-only for members | landing message + the four rules + link to /support |
| `#announcements` | text · post-only (j) | release notes (mirrors docs.briven.tech/changelog), migration windows, planned maintenance |

### `#help` category — public to verified members

| Channel | Type | Purpose |
|---|---|---|
| `#help-general` | text | usage questions, design questions, "is this a bug?" |
| `#help-migrations` | text | source-specific migration threads (convex / supabase / drizzle / prisma / firebase / mongo). pin the matching /migration/<source> page. |
| `#help-ai` | text | questions about ai-schema / ai-function / ai-explain / ask the docs |
| `#feedback` | text | feature requests, papercuts, "this is weird" |

### `#alerts` category — operator-only (just j today)

| Channel | Type | Purpose |
|---|---|---|
| `#briven-alerts` | text · webhook-only | alertmanager P0/P1 — service down, postgres connections high, error rate spike |
| `#briven-deploys` | text · webhook-only | every build / restart from Dokploy + every release tag |
| `#briven-usage` | text · webhook-only | Polar meter pushes that 4xx, abuse reports, suspension events |

### `#offtopic` category — public

| Channel | Type | Purpose |
|---|---|---|
| `#off-topic` | text | non-briven chat |
| `#showcase` | text | beta users posting what they built |

---

## 3. Roles

Create these under **Server Settings → Roles** (top to bottom = priority order):

1. **`@founder`** — j. Full admin. Hex `#00e87a` (briven green).
2. **`@core`** — future team members. Manage messages + manage channels.
3. **`@beta`** — invited beta users. Read everything in `#welcome`, `#help`, `#offtopic`. NO access to `#alerts`.
4. **`@verified`** — anyone who joined via the dashboard "join discord" button (which carries a token tied to their briven account). One step below `@beta` — same channel access today, but the role distinction lets you grant `@beta` only to handpicked accounts.

Under `#alerts` category → **Edit Category** → **Permissions** → remove `@everyone` view permission and grant view to `@founder` + `@core` only.

---

## 4. Webhooks (alertmanager + dokploy + briven api)

For each of the three operator channels, **Edit Channel** → **Integrations** → **Webhooks** → **New Webhook**:

- `#briven-alerts` webhook → name "alertmanager", paste avatar `/assets/icon.svg`. Copy URL.
- `#briven-deploys` webhook → name "dokploy", copy URL.
- `#briven-usage` webhook → name "briven-api", copy URL.

The three URLs go into Dokploy environment on the api host:

```
BRIVEN_DISCORD_WEBHOOK_ALERTS=https://discord.com/api/webhooks/...
BRIVEN_DISCORD_WEBHOOK_DEPLOYS=https://discord.com/api/webhooks/...
BRIVEN_DISCORD_WEBHOOK_USAGE=https://discord.com/api/webhooks/...
```

The existing alertmanager-discord bridge (`infra/observability/alertmanager/`) reads the first one. Dokploy's "Discord notifications" feature reads the second. The briven api worker (TBD — see SLA enforcement task) reads the third.

---

## 5. Discord login on briven.tech

briven already supports Discord OAuth (`BRIVEN_DISCORD_CLIENT_ID` / `_SECRET` are wired in env.ts). To complete the bridge so signing in via Discord auto-joins the briven server with the `@verified` role:

1. **Discord Developer Portal** → your application → **OAuth2** → **Redirects**: add `https://api.briven.tech/auth/discord/callback`.
2. Under **OAuth2 → URL Generator**, check scopes: `identify`, `email`, `guilds.join`. The `guilds.join` scope is what lets briven add the user to the server post-login.
3. **Bot** tab → **Add Bot** → copy the bot token, give it the **Server Members Intent** (required for `guilds.join`).
4. Invite the bot to the server with the **Manage Roles** + **Create Instant Invite** permissions.
5. Add to Dokploy env on the api host:
   ```
   BRIVEN_DISCORD_BOT_TOKEN=<bot token>
   BRIVEN_DISCORD_GUILD_ID=<your server id, right-click server icon → Copy Server ID, requires Developer Mode in Discord settings>
   BRIVEN_DISCORD_VERIFIED_ROLE_ID=<right-click @verified role → Copy Role ID>
   ```
6. On the briven side, the Better Auth Discord provider needs a follow-up handler that calls `PUT /guilds/{guild.id}/members/{user.id}` with the access token to add the user. This is queued as a Phase-3 follow-up — not built today; the OAuth login itself works without it, but auto-server-join doesn't fire yet.

---

## 6. Invite UX

For the private-beta cohort:

- **Generate a vanity invite**: Server Settings → Invites → create a permanent invite with **Max Uses: 25**, **Expire: never**. Custom URL: `discord.gg/briven` (requires Level 3 boosting — defer until you have a few boosts).
- Each beta user gets the invite in their welcome email when their dashboard invitation is accepted. The mittera email template (`apps/api/src/services/mittera.ts` or similar) is where to wire it.

---

## 7. Moderation defaults

- Enable **Server Settings → Safety Setup → AutoMod** with the "Mention spam" + "Suspicious user activity" presets.
- Enable **2FA Requirement for Moderation** — only accounts with 2FA on can use `@core` powers.
- Pin a `#welcome` rules message: (1) be nice, (2) post code with ``` fences, (3) DM j for anything sensitive (security, billing, account access), (4) #help-* channels are public — don't paste real secrets, redact first.

---

## 8. After launch (Phase 4)

When briven moves from private beta to public beta:

- Flip `@everyone` view permission back on for `#help-*` channels.
- Promote the invite link to `briven.tech/community` (a new marketing page) and the docs footer.
- Add a `#contributors` channel for people working on briven-core via the AGPL surface.
- Consider a `#self-host` channel separate from `#help-general` once self-host installs > 10.

---

## 9. Quick checklist

- [ ] Server created with `briven` name + icon
- [ ] All channels created per §2
- [ ] Roles created per §3 + permissions set on `#alerts` category
- [ ] Three webhooks created + URLs in Dokploy env
- [ ] Discord Developer Portal app + bot + redirects + scopes per §5
- [ ] Bot invited with Manage Roles + Create Instant Invite
- [ ] Vanity invite generated (or open invite created for the cohort)
- [ ] Welcome rules pinned in `#welcome`
- [ ] AutoMod + 2FA-for-moderation enabled

Once §1–§4 are done the operator-side alerting works. §5 is the polish layer for user-facing OAuth + auto-join.

---

## 10. Smoke test the webhook routing (Phase 0 exit criterion §0.2)

Don't kill production containers to test alert delivery — push a synthetic alert directly into alertmanager instead. Two routes, two smoke tests.

### `#briven-alerts` — `severity=critical` path

```bash
ssh root@187.124.64.116 '
docker run --rm --network dokploy-network curlimages/curl:8.10.1 \
  -sS -XPOST http://alertmanager:9093/api/v2/alerts \
  -H "content-type: application/json" \
  -d "$(cat <<JSON
[{
  "labels": {"alertname":"BrivenSmokeTest","service":"smoketest","severity":"critical"},
  "annotations": {"summary":"phase 0.2 webhook smoke test","description":"verifying #briven-alerts wiring; safe to ignore"},
  "startsAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "endsAt":"$(date -u -d "+2 minutes" +%Y-%m-%dT%H:%M:%SZ)"
}]
JSON
)"'
```

Expect a red embed in `#briven-alerts` within 60 s (alertmanager `group_wait: 30s` + bridge round-trip).

### `#briven-deploys` — info path

```bash
ssh root@187.124.64.116 '
docker run --rm --network dokploy-network curlimages/curl:8.10.1 \
  -sS -XPOST http://alertmanager:9093/api/v2/alerts \
  -H "content-type: application/json" \
  -d "$(cat <<JSON
[{
  "labels": {"alertname":"BrivenDeploySmokeTest","service":"smoketest","severity":"info"},
  "annotations": {"summary":"phase 0.2 deploys webhook smoke test","description":"verifying #briven-deploys wiring; safe to ignore"},
  "startsAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "endsAt":"$(date -u -d "+2 minutes" +%Y-%m-%dT%H:%M:%SZ)"
}]
JSON
)"'
```

Capture both message timestamps as Phase 0 close-out ADR evidence.

If nothing arrives:

```bash
docker logs alertmanager --tail=50
docker logs alertmanager-discord-alerts --tail=20
docker logs alertmanager-discord-deploys --tail=20
```

Common failure modes:

- `BRIVEN_DISCORD_WEBHOOK_*` env empty in the bridge container → restart the observability project after pasting the URL in Dokploy.
- Webhook URL revoked from the Discord side (channel deleted, integration removed) → regenerate per §4 and update Dokploy env.
- alertmanager unreachable from the curl helper → confirm both are on `dokploy-network`.
