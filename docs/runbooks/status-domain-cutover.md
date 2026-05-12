# Cutover: docs.briven.tech/status → status.briven.tech

**Owner:** J. **Audience:** operator wiring the dedicated subdomain.

The status page currently lives at `https://docs.briven.tech/status` (a Next.js page in `apps/docs`). For Phase-4 readiness it moves to `status.briven.tech` — operators expect a dedicated subdomain ("can I trust this page is up when the rest is down?"), and search-engine canonicalisation works better with the dedicated host.

The cutover is a config change, not a redesign. The page itself stays where it is in code; we add a traefik routing rule + a Cloudflare DNS record so `status.briven.tech` resolves to the docs container and the path-rewrite serves the same page.

---

## 1. DNS

In Cloudflare → briven.tech zone → DNS:

| Type | Name | Value | Proxy |
|---|---|---|---|
| `CNAME` | `status` | `briven.tech` | Proxied (orange cloud) |

Save. Propagation is usually < 30 seconds on Cloudflare; verify:

```bash
dig +short status.briven.tech
# expect a Cloudflare anycast IP
```

---

## 2. Traefik routing rule

The dokploy compose for briven already has traefik labels per service. Add a new label set to the `docs` service (which already hosts `/status` at `docs.briven.tech/status`):

In `infra/dokploy/compose.dokploy.yml` under the `docs:` service `labels:` block, add:

```yaml
- traefik.http.routers.briven-status.rule=Host(`status.${BRIVEN_DOMAIN}`)
- traefik.http.routers.briven-status.entrypoints=websecure
- traefik.http.routers.briven-status.tls.certresolver=letsencrypt
- traefik.http.routers.briven-status.middlewares=briven-status-rewrite
- traefik.http.middlewares.briven-status-rewrite.replacepathregex.regex=^/$
- traefik.http.middlewares.briven-status-rewrite.replacepathregex.replacement=/status
- traefik.http.services.briven-status.loadbalancer.server.port=3002
```

What this does:

1. Routes `status.briven.tech` (any path) to the docs container.
2. `replacepathregex` rewrites a bare `/` request to `/status` so `https://status.briven.tech` lands on the status page instead of the docs landing.
3. All other paths pass through unchanged — `https://status.briven.tech/api/status/incidents.xml` still hits the RSS feed.

Redeploy the briven stack on Dokploy. The traefik container reads new labels on every container start; letsencrypt will provision the cert automatically on first HTTPS request (~10 seconds delay on the first hit).

---

## 3. Old URL redirect

Once `status.briven.tech` is verified working, redirect the old path so bookmarks + RSS readers still find it.

In `apps/docs/src/app/status/page.tsx`, prepend:

```tsx
import { redirect } from 'next/navigation';

export default async function StatusPage(/* params */) {
  // After the DNS cutover, the canonical location is status.briven.tech.
  // The /status path on docs.briven.tech redirects to preserve old links
  // (bookmarks, RSS feed URL, blog posts that referenced the old path).
  if (process.env.BRIVEN_STATUS_CANONICAL === 'status') {
    redirect('https://status.briven.tech');
  }
  // … existing body
}
```

Set `BRIVEN_STATUS_CANONICAL=status` on the docs container env in Dokploy. The old URL 308s to the new one; everything that referenced `docs.briven.tech/status` keeps working.

For the RSS feed at `/api/status/incidents.xml`, add the same redirect at the top of the route handler:

```ts
if (process.env.BRIVEN_STATUS_CANONICAL === 'status') {
  return Response.redirect('https://status.briven.tech/api/status/incidents.xml', 308);
}
```

---

## 4. Update references in code + docs

Three places hard-code the old URL — change all three on the same commit as the cutover:

1. **Dashboard footer** (`apps/web/src/app/(dashboard)/layout.tsx`): change `https://docs.briven.tech/status` → `https://status.briven.tech`.
2. **Marketing footer** (`apps/web/src/app/page.tsx` SiteFooter component): same change.
3. **Doctor command** (`packages/cli/src/commands/doctor.ts`): the realtime probe derives its hostname from the api origin — no change needed there. But if `doctor` ever prints "see status page" copy, point it at the new URL.
4. **All operator runbooks** that mention the status URL.
5. **docs.briven.tech sitemap.xml** — re-add the `/status` entry (it'll 308) so search engines pick up the redirect.

---

## 5. Verification

After deploy:

```bash
# DNS resolves
dig +short status.briven.tech

# HTTPS responds with the status page
curl -sI https://status.briven.tech | head -3
# expect HTTP/2 200

# Old URL redirects
curl -sI https://docs.briven.tech/status | head -3
# expect HTTP/2 308 + Location: https://status.briven.tech

# RSS feed at the new URL
curl -s https://status.briven.tech/api/status/incidents.xml | head -3
# expect <?xml version="1.0" encoding="UTF-8"?>

# RSS feed at the old URL redirects
curl -sI https://docs.briven.tech/api/status/incidents.xml | head -3
# expect HTTP/2 308
```

If any check fails, see the troubleshooting matrix below.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| DNS doesn't resolve | Cloudflare record not saved or proxy not enabled | re-check Cloudflare DNS panel; check proxy is orange-cloud not grey |
| 522 from Cloudflare | traefik isn't routing the new host yet | check `docker logs traefik` for "no available server" — usually missing label or wrong port |
| `NET::ERR_CERT_AUTHORITY_INVALID` for ~30s | letsencrypt provisioning | wait one minute; check `docker logs traefik` for "obtaining certificate" |
| `status.briven.tech/` shows the docs homepage | replacepathregex middleware isn't applied | verify the `middlewares=briven-status-rewrite` label spelling exactly matches the middleware name |
| Old URL doesn't redirect | BRIVEN_STATUS_CANONICAL env not set | set it on the docs service in Dokploy; restart container |

---

## 7. Rollback

Easy: remove the new traefik labels, restart docs, and the new subdomain falls back to the Cloudflare DNS pointing at nothing (502 from Cloudflare). DNS record can stay. Old `docs.briven.tech/status` continues to work because the redirect only fires when `BRIVEN_STATUS_CANONICAL=status` is set — unset it to revert.

---

## 8. Post-cutover

- Update `assets/` social cards to reference `status.briven.tech` if any include the status URL.
- Tweet (or otherwise announce) that the URL has moved, with a note that the old one redirects.
- Add `status.briven.tech` to the launch-day checklist in `docs/launch/product-hunt.md` §pre-launch.
