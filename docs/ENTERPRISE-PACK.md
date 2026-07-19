# Enterprise pack (S7)

Plain-language map of Briven Auth **enterprise** capabilities for sales + ops.

---

## What’s included

| Area | Status | Where |
| --- | --- | --- |
| SAML 2.0 SSO | Shipped | Dashboard Auth → SSO; `/v1/auth-tenant/sso/saml/…` |
| OIDC Enterprise SSO | Shipped + PKCE polish | `/v1/auth-tenant/sso/oidc/…` |
| SCIM 2.0 Users/Groups | Shipped | `docs/SCIM.md` |
| SCIM group → org role | Shipped | `PUT …/auth/scim/role-maps` |
| Compliance metadata | Shipped | `GET/PATCH …/auth/compliance` |
| **Sales kit (DPA/BAA/retention)** | Shipped | `GET …/auth/compliance/pack` |
| Sign DPA / BAA flags | Shipped | `POST …/sign-dpa`, `…/sign-baa` |
| Public trust page | Updated | https://briven.tech/trust |

---

## Sales kit API

```http
GET /v1/projects/:id/auth/compliance/pack
Authorization: (dashboard session, project admin)
```

Returns JSON with:

- Project compliance flags (DPA/BAA signed?)  
- Retention settings  
- Capability list (SAML, OIDC, SCIM, …)  
- Template DPA / BAA outline / retention pack / security one-pager  
- Checklist for sales  

Record signatures after real legal sign-off:

```http
POST /v1/projects/:id/auth/compliance/sign-dpa
POST /v1/projects/:id/auth/compliance/sign-baa
{ "signedBy": "Name, Company" }
```

(Owner role required.)

---

## SCIM group → org role

1. Create a Briven Auth **org** (organizations feature).  
2. Map SCIM group name → org:

```http
PUT /v1/projects/:id/auth/scim/role-maps
{ "displayName": "Engineering", "orgId": "org_…", "role": "member" }
```

3. When IdP pushes that SCIM Group with members, Briven adds those users to the org.

---

## Not claimed

- Formal SOC 2 Type II report until auditor delivers one  
- SMS OTP  
- Pixel-perfect Clerk UI  
- Automatic multi-region active-active  

Templates are **sales/ops aids**, not a substitute for counsel-final contracts.

---

## Quick links

- SCIM: `docs/SCIM.md`  
- Trust: `/trust`  
- Subprocessors: `/subprocessors`  
- Friends pilot: `FRIENDS-TRUST-WALKTHROUGH.md`  
