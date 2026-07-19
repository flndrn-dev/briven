# Auth isolation verify (how-to)

**What this is:** a short map for proving “user on project A never appears on project B.”  
**Why:** multi-app isolation is assumed at Clerk; Briven must **show** it before claiming beta trust.

---

## Fast path

1. Read steps: `docs/runbooks/auth-tenant-isolation.md`  
2. Print checklist + platform probes:

```bash
./scripts/auth-isolation-check.sh
```

3. In the **dashboard**, do the human steps the script prints.  
4. Record results in `docs/CLERK-GAP-EVIDENCE.md` (section A, row S6.1).

---

## What “pass” means

| Check | Pass |
| --- | --- |
| User signed up only on A | Appears in A → Auth → Users |
| Same email/user on B’s Users list | **Must not** appear |
| Key for A used with project B env | Should fail (wrong project) |
| New signup with key B | Appears only on B |

---

## Related

- Platform probes: `./scripts/s6-auth-verify.sh`  
- Dogfood app: `examples/auth-pilot/README.md`  
- Sprint: `sprint_plan.md` workstream A2 + C2  
