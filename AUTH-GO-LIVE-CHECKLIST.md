# Briven Auth — Manual Go-Live Checklist

Plain-language proof that sign-in works for real people (not just automated tests).

**Who this is for:** you (the project owner), clicking through in a normal browser.  
**Who this is not for:** code changes. If a step needs coding, stop and ask.

**Before you start:** have a real project open at [briven.tech](https://briven.tech), and a phone or second browser for testing a second “user.”

---

## 0. Platform is awake (30 seconds)

Open these in a browser tab (or ask an agent to curl them). You want green / “ok”:

| Check | What “good” looks like |
| --- | --- |
| [https://api.briven.tech/health](https://api.briven.tech/health) | `"status":"ok"` and `"env":"production"` |
| [https://api.briven.tech/ready](https://api.briven.tech/ready) | `"status":"ready"` and **`redis":"ok"`** (speed limits for logins need this) |

If Redis is **not** `"ok"`, stop — logins can still work, but abuse protection is weaker. Fix Redis before a public launch.

**Checked once on 2026-07-18:** production reported `ready` with `redis: ok`.

---

## 1. Turn Auth on for the project

1. Log in at [briven.tech](https://briven.tech).
2. Open your project.
3. Go to **Auth**.
4. If you see **Enable Auth**, click it and wait until the page shows settings (providers, users, keys) — not a blank “not enabled” state.

**Pass:** Auth pages load without error.

---

## 2. Create a public auth key (the “front door key”)

1. Go to **Auth → API keys**.
2. Click **Create key**.
3. Name it something clear, e.g. `pilot web`.
4. Scope: **read-write** (enough for sign-up / sign-in in the browser).
5. Copy the value that starts with `pk_briven_auth_…` **immediately**.

**Pass:** You have a key on the clipboard.  
**Note:** You can later use **Reveal / copy again** if the key was stored encrypted (newer keys). Old keys without that may force a rotate.

**Never put a `brk_…` server key in the browser.** Only `pk_briven_auth_…`.

---

## 3. Email + password sign-up and sign-in

1. Open your app’s sign-in page (or Briven’s hosted auth page for the project if you use that).
2. Create a **new** account with a real email you can open.
3. Sign out.
4. Sign back in with the same password.

**Pass:** You land in the signed-in area both times. No endless spinner, no “internal error.”

If email verification is required:

- Check the inbox (and spam) for a message from `noreply@briven.tech` (or your branded sender once DNS is set).
- Click the verify link, then sign in again.

---

## 4. Wrong password is rejected (safety check)

1. Sign out.
2. Sign in with the **wrong** password on purpose.

**Pass:** Clear “wrong password / invalid credentials” style message. Account is **not** opened.

---

## 5. Magic link or one-time code (if you turned them on)

Only if **Auth → providers** has magic link and/or email OTP enabled:

1. Request a magic link **or** a 6-digit code.
2. Use it within a few minutes.

**Pass:** You get signed in. Email arrived (check spam).

---

## 6. Google / GitHub (only if you configured them)

Only if you pasted **both** Client ID and Client Secret under **Auth → providers**:

1. Click **Continue with Google** (or GitHub).
2. Finish the provider’s consent screen.
3. Land back on your app signed in.

**Pass:** Social login works once.  
**Fail often means:** missing secret, wrong redirect URL, or provider still toggled off.

---

## 7. Session sticks after refresh

1. Stay signed in.
2. Refresh the page (F5 / Cmd+R).
3. Close the tab, open the app again (same browser).

**Pass:** Still signed in (cookie session).  
Then sign out → refresh → you should be signed out.

---

## 8. Speed-limit / abuse check (optional but good)

1. From a throwaway flow, try many wrong passwords quickly (10–20 tries).

**Pass:** After a burst you get rate-limited (slow down / try later), not endless free guesses.  
This is the real-world check that Redis-backed limits are working.

---

## 9. Dashboard still makes sense as admin

1. **Auth → Users** — your test user appears.
2. **Auth → usage / MAU** (if shown) — counts move after the test sign-ins.
3. Optional: ban or suspend a throwaway test user and confirm they cannot sign in.

**Pass:** Admin list matches what you did in the browser.

---

## 10. Pilot app wiring (agent or human)

If an AI agent sets up your app, they should follow the **briven-auth** skill and:

1. Run `briven link` (if not already) then `briven auth scaffold`.
2. Install `@briven/auth` (and `@briven/auth/react` for React).
3. Paste project id + `pk_briven_auth_…` into env vars.
4. Put a sign-in page on screen and a “who am I” check after login.

**Pass:** A second person can sign up on your pilot URL without you hand-holding the code.

---

## Sign-off

| # | Item | Pass? | Notes |
| --- | --- | --- | --- |
| 0 | Platform ready + redis ok | ☐ | |
| 1 | Auth enabled | ☐ | |
| 2 | Public key created | ☐ | |
| 3 | Sign-up + sign-in | ☐ | |
| 4 | Wrong password rejected | ☐ | |
| 5 | Magic link / OTP (if on) | ☐ | |
| 6 | Social (if on) | ☐ | |
| 7 | Session after refresh | ☐ | |
| 8 | Rate limit (optional) | ☐ | |
| 9 | Users list in dashboard | ☐ | |
| 10 | Pilot app works for a friend | ☐ | |

**You sign off when:** rows 0–4 and 7 are all pass, and anything you advertise (magic link / Google / etc.) is pass too.

Date: ________  Name: ________

---

## If something fails

- **500 / “internal error”** → check `/ready` again; tell an agent the exact time and project id (not the secret key).
- **No email** → spam folder; Auth → branding sender; until your domain verifies, mail may come from `noreply@briven.tech`.
- **Social button does nothing** → provider needs **id + secret** both set.
- **Key lost** → Auth → API keys → reveal (if available) or create a new key and update the app env.

Do **not** paste full keys into chat or tickets. Paste only the last 4 characters if you need help.
