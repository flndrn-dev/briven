# Friends trust walkthrough (no Clerk knowledge needed)

You do **not** need Clerk for this.

**What “friends can trust this” means:**  
You prove once, in a real browser, that sign-up and sign-in work on **your** Briven project — like a fire drill before inviting friends.

Time: about **20–40 minutes**.

---

## Part A — One project (the fire drill)

1. Open **https://briven.tech** and sign in to the dashboard.  
2. Open (or create) a project you’ll use as the pilot.  
3. Go to **Auth**.  
4. Click **Enable** if Auth is not on yet.  
5. Open **API keys** (or Auth keys) → create a key that starts with **`pk_briven_auth_`**.  
   - That key is for the **browser** only. Never put a secret `brk_` key in a website.  
6. Sign up a real user (your email) via the hosted auth page or `examples/auth-pilot`.  
7. Sign out, then sign in again with the **correct** password.  
8. Try a **wrong** password — it must fail.  
9. Sign in correctly, then **refresh** the page — you should still be signed in.

If all of that works → Part A **pass**.

Mark it in `AUTH-GO-LIVE-CHECKLIST.md` or `docs/CLERK-GAP-EVIDENCE.md`.

---

## Part B — Second project (no user leak)

1. Create a **second** project.  
2. Enable Auth there too. Create a **different** public key.  
3. Open project B → Auth → **Users**.  
4. The user from project A must **not** appear.  

Helper script (prints steps):

```bash
./scripts/auth-isolation-check.sh
```

---

## Part C — Sign-off

In `sprint_plan.md` section 8, write something like:

> Friends can use Briven Auth for beta.  
> Date / name / pilot project id / isolation project id

Optional: send a friend your pilot URL after Part A works.

---

## After you finish

Tell the agent: **“fire drill passed”** (and project ids if you want them recorded).  
Then we can mark the trust claim closed in the evidence pack.
