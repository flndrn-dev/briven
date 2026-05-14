# briven commercial licence — draft v0.1

**Status:** DRAFT. Not yet legal advice. Have this reviewed by a Cyprus-licensed solicitor familiar with software licensing before publishing.

**Date:** 2026-05-12
**Drafted for:** flndrn Limited, Limassol, Cyprus (the "Licensor").

This document covers the **commercial-licence carve-out** for briven-core. The default licence for the self-hosted engine is **AGPL-3.0**. This commercial licence is an alternative offered to companies that need to use briven-core in a way the AGPL doesn't accommodate.

---

## 1. Who needs the commercial licence

You need a commercial licence if **any** of the following are true:

1. You distribute a product that bundles, embeds, or links briven-core, and you do not want to be obligated to release the source code of that product under AGPL-3.0.
2. You offer briven-core as a hosted service (any form of SaaS, PaaS, or managed hosting) to customers OTHER than the legal entity that holds the licence.
3. You modify briven-core and ship the modified version to users or customers without making those modifications available under AGPL-3.0.
4. You use briven-core internally inside a legal entity with more than €10M in annual revenue OR more than 100 full-time equivalent employees, regardless of whether you distribute it.

You do **not** need a commercial licence if:

- You run an unmodified or modified briven-core entirely for your own internal use AND your organisation is under both the €10M and 100-FTE thresholds.
- You run briven.tech as a managed customer — the SaaS terms cover you separately.
- You contribute back to briven-core under the AGPL-3.0 — that's the open-core promise.
- You build a project ON briven (using the SDKs, the CLI, deploying functions) — your project code is yours; only briven-core itself is AGPL'd.

---

## 2. What the commercial licence grants

A perpetual, non-exclusive, worldwide right to:

- Use briven-core in production, including under modifications you keep proprietary.
- Distribute briven-core (modified or unmodified) as part of a product, without triggering the AGPL's source-disclosure requirement.
- Operate briven-core as a hosted service for third-party customers under your own brand.
- Receive commercially-supported releases (the "Pro Distribution") — same source as the AGPL release but signed, with binary distribution rights for the four-service compose stack.

Subject to the obligations in §3.

---

## 3. Obligations

The licensee agrees to:

1. **Pay the licence fee** per the tier table in §5, billed annually in advance.
2. **Preserve copyright notices** on the source files. Removing or obscuring the "© flndrn Limited" header in any briven-core source file terminates the commercial licence.
3. **Not re-licence** the briven-core source code or any derivative work back under a more permissive licence (BSD, MIT, etc.) that could let a third party use it without paying the same commercial terms.
4. **Not market a product as "briven-compatible" or "briven-powered"** without written permission. The trademark "briven" is owned by flndrn Limited and the permission to use it requires a separate trademark agreement.
5. **Report annual usage** — total monthly active users running on briven-core deployments under this licence. Reporting is honour-system; the Licensor retains the right to audit on 60 days' notice.

---

## 4. What the commercial licence does NOT grant

- Any right to the briven.tech hosted-platform code base or its customer data.
- Any right to use the `briven` name or logo outside what's listed in §3 point 4.
- Source code escrow (offered separately if needed — see §6).
- A guarantee of indefinite availability of the Pro Distribution. flndrn Limited reserves the right to discontinue distribution with 24 months' notice; the AGPL-3.0 codebase remains available regardless.

---

## 5. Tier table (placeholder — confirm with solicitor + market research)

| Tier | Annual fee | What you get | Who it's for |
|---|---|---|---|
| **Startup** | €4,800/year (€400/mo) | Commercial licence for one production deployment, up to €5M ARR | early-stage companies past the AGPL-acceptable threshold |
| **Business** | €24,000/year (€2,000/mo) | Up to 10 production deployments, up to €25M ARR, email support 5×8 | scale-ups, agencies |
| **Enterprise** | from €96,000/year | Unlimited deployments, custom SLA, dedicated account, source escrow option, priority security patches | regulated industries, large internal IT |

Numbers above are placeholders. Real numbers should anchor to comparable open-core licences (Sidekiq Pro/Enterprise, Mattermost, GitLab Ultimate, Redis Source-Available) and the actual cost of supporting the tier.

---

## 6. Optional add-ons

Available separately, priced per agreement:

- **Source code escrow** — a third-party escrow agent holds the briven-core source under a hold-harmless clause; released to the licensee if flndrn Limited is dissolved or files for insolvency.
- **Priority security patches** — pre-disclosure window for CVE notices, ahead of the public AGPL-3.0 announcement.
- **Custom feature funding** — pay to prioritise a feature in the public roadmap. Result is released under AGPL-3.0 like all of briven-core; the value is the prioritisation, not exclusive code.
- **On-call engineering retainer** — a fixed monthly hours pool against named flndrn-Limited engineers.

---

## 7. Termination

The commercial licence terminates automatically if:

- Annual fees are unpaid 30 days past invoice date.
- The licensee distributes modified briven-core in violation of §3.
- The licensee files for insolvency without the escrow add-on.

Upon termination the licensee:

- May continue running existing deployments under AGPL-3.0 — the underlying source remains AGPL, just like before they bought the licence.
- Must stop using the Pro Distribution within 90 days.
- Must stop using the briven trademark within 90 days.

---

## 8. Open questions for the solicitor

These are placeholder positions; verify each:

- **Choice of law:** Cyprus law, jurisdiction Limassol courts. Verify this is enforceable for licensees in the EU, US, UK.
- **Limitation of liability:** standard cap at fees paid in the prior 12 months. Verify the cap is enforceable for consumer protection in each target jurisdiction.
- **Audit clause:** §3 point 5 — is "60 days' notice" realistic? Most B2B licences run 30 days; some allow audit with reimbursement if discrepancies > 5%.
- **Trademark separation:** should the licence agreement reference a separate trademark licence, or fold the trademark grant in? Cleaner if separated.
- **Patent grant:** AGPL-3.0 includes a patent grant. The commercial licence should too, at least equivalent scope.
- **Sublicensing:** can the licensee sublicence to a subsidiary? Affiliates within the same corporate group are typically OK; subsidiaries with separate ownership are not.

---

## 9. Distribution

The commercial licence terms are NOT public until reviewed and finalised. Once the solicitor has signed off:

- Publish to `briven.tech/licence-commercial` (a new marketing page).
- Link from the GHCR README (`infra/dokploy/README.md` self-host section).
- Add to the docs site at `docs.briven.tech/self-host` "commercial licence" section.
- Quote requests go to `licensing@flndrn.com` (mail alias to jurgen until volume justifies a sales role).

---

## 10. What ships with the OSS release

The public GHCR release at `ghcr.io/flndrn-dev/briven-{api,runtime,realtime,web,docs}` is AGPL-3.0 today. To make the commercial-licence path real, add to each Dockerfile and the repo `LICENSE` file:

```
This work is licensed under the GNU Affero General Public License v3.0
("AGPL-3.0"). A commercial licence is available separately for use cases
that AGPL-3.0 does not accommodate; see docs/LICENSE-COMMERCIAL.md for
terms, and contact licensing@flndrn.com for a quote.
```

---

*End of LICENSE-COMMERCIAL.md draft. Do not publish before solicitor review.*
