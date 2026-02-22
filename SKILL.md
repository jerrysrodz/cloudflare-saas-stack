---
name: cloudflare-saas-stack
description: Build and deploy SaaS products on the Cloudflare + Stripe + GoHighLevel + GitHub/Google OAuth stack. Use when building landing pages on Cloudflare Pages, checkout/webhook workers on Cloudflare Workers, Stripe billing (subscriptions, trials, promo codes, customer portal, plan upgrades/downgrades), GoHighLevel CRM integration (contacts, pipelines, tags, emails), GitHub or Google OAuth login flows, JWT token auth, managed API proxies, Pinecone memory provisioning, or any combination. Also use when deploying, configuring DNS, setting worker secrets, or debugging this stack.
---

# Cloudflare SaaS Stack

Full-stack SaaS deployment using Cloudflare Pages (static site) + Workers (API/checkout/auth/proxy) + Stripe (billing) + GoHighLevel (CRM/email) + GitHub/Google OAuth (auth) + JWT (sessions).

## Architecture

```
goldhold.ai (Pages)          checkout.goldhold.ai (Worker)
┌─────────────────┐          ┌──────────────────────────────────┐
│ Static HTML/CSS  │──POST──▶│ /checkout     → Stripe session   │
│ Tailwind (local) │         │ /webhook      → Stripe webhook   │
│ No frameworks    │         │ /signup       → GHL contact       │
│ Self-hosted fonts│         │ /portal       → Billing portal    │
│ Account dashboard│         │ /account      → Account status    │
└─────────────────┘          │ /auth/github  → GitHub OAuth      │
                             │ /auth/google  → Google OAuth      │
                             │ /auth/verify  → JWT verification  │
                             │ /v1/memory/*  → Managed API proxy │
                             │ /pinecone/*   → BYOK proxy        │
                             │ /upgrade      → Plan change       │
                             │ /download     → Dynamic ZIP       │
                             │ /unsub        → Email unsub       │
                             └──────────────────────────────────┘
                                    │           │           │
                          ┌─────────┘           │           └──────────┐
                          ▼                     ▼                      ▼
                    Stripe API           Pinecone API            GHL API
                    - Checkout           - Vector upsert         - Contacts
                    - Subscriptions      - Query/search          - Tags
                    - Customer Portal    - Namespace isolation   - Pipelines
                    - Webhooks           - Embedding             - Email
                    - Plan switching     - Index stats
```

## Quick Start

1. Read `references/cloudflare.md` for Pages + Workers setup
2. Read `references/stripe.md` for billing integration
3. Read `references/ghl.md` for CRM/email integration
4. Read `references/github-oauth.md` for auth flows (GitHub + Google)
5. Read `references/jwt-auth.md` for JWT token system
6. Read `references/managed-memory.md` for Pinecone proxy + provisioning
7. Read `references/security.md` for hardening checklist

## Worker Structure

A single Worker handles all API routes. Key pattern:

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': 'https://yourdomain.com' };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Pinecone-Key' } });
    }

    // Route dispatch
    if (url.pathname === '/checkout') { /* Stripe checkout */ }
    if (url.pathname === '/webhook') { /* Stripe webhook */ }
    if (url.pathname === '/signup') { /* Free tier signup */ }
    if (url.pathname === '/portal') { /* Billing portal */ }
    if (url.pathname === '/account') { /* Account status (POST) */ }
    if (url.pathname === '/upgrade') { /* Plan upgrade/downgrade */ }
    if (url.pathname === '/auth/github') { /* GitHub OAuth redirect */ }
    if (url.pathname === '/auth/callback') { /* GitHub OAuth callback → JWT */ }
    if (url.pathname === '/auth/google') { /* Google OAuth redirect */ }
    if (url.pathname === '/auth/google/callback') { /* Google callback → JWT */ }
    if (url.pathname === '/auth/verify') { /* JWT verify + account data */ }
    if (url.pathname.startsWith('/v1/memory/')) { /* Managed memory proxy */ }
    if (url.pathname.startsWith('/pinecone/')) { /* BYOK Pinecone proxy */ }
    if (url.pathname === '/download') { /* Dynamic ZIP with injected config */ }
  }
}
```

## Worker Secrets & Environment

Set secrets via CLI — never hardcode:

```powershell
cd worker
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put GHL_API_KEY
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put JWT_SECRET              # HMAC key for JWT signing
npx wrangler secret put GOOGLE_CLIENT_SECRET     # Google OAuth
npx wrangler secret put MANAGED_PINECONE_KEY     # Server-side Pinecone key for managed users
```

Environment variables go in `wrangler.toml`:

```toml
[vars]
STRIPE_PUBLISHABLE_KEY = "pk_live_..."
MONTHLY_PRICE_ID = "price_..."
ANNUAL_PRICE_ID = "price_..."
SUCCESS_URL = "https://yourdomain.com/thank-you"
CANCEL_URL = "https://yourdomain.com"
GHL_LOCATION_ID = "..."
GITHUB_CALLBACK_URL = "https://api.yourdomain.com/auth/callback"
GOOGLE_CLIENT_ID = "..."
GOOGLE_CALLBACK_URL = "https://api.yourdomain.com/auth/google/callback"
MANAGED_PINECONE_HOST = "your-index-abc123.svc.pinecone.io"
MANAGED_PINECONE_INDEX = "your-managed-index"

[[kv_namespaces]]
binding = "KV"
id = "..."
```

## Deployment Commands

```powershell
# Deploy static site
cd site; npx wrangler pages deploy . --project-name=my-project --commit-dirty=true

# Deploy worker
cd worker; npx wrangler deploy

# Check worker logs
npx wrangler tail
```

## Dual-Tier Architecture

Two user classes, same dashboard, different plumbing:

| Feature | BYOK (Free/Monthly) | Managed (Annual/Enterprise) |
|---------|---------------------|-----------------------------|
| Pinecone key | User provides their own | Server-side, user never sees it |
| Auth header | `X-Pinecone-Key: <user_key>` | `Authorization: Bearer <JWT>` |
| Proxy path | `/pinecone/host/<host>/*` | `/v1/memory/*` |
| Namespace | User chooses any | Server-enforced per user |
| Dashboard | Same UI | Same UI |
| Setup | Enter key + select index | Click "Set Up Managed Data" |

See `references/managed-memory.md` for full implementation.

## Rate Limiting (KV-based)

No external dependencies — use the KV namespace already bound to the worker:

```javascript
async function checkRateLimit(key, maxRequests, windowSeconds, env) {
  const rlKey = `rl:${key}`;
  const data = await env.KV.get(rlKey, 'json');
  const now = Date.now();
  if (data && data.count >= maxRequests && (now - data.start) < windowSeconds * 1000) return false;
  const newData = (!data || (now - data.start) >= windowSeconds * 1000)
    ? { count: 1, start: now }
    : { count: data.count + 1, start: data.start };
  await env.KV.put(rlKey, JSON.stringify(newData), { expirationTtl: windowSeconds });
  return true;
}
```

## Email Validation

Always validate before hitting Stripe/GHL — bad emails cause 400/502 errors:

```javascript
function isValidEmail(email) {
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
```

## Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| Tailwind CDN breaks with custom classes | Compile locally: `npx tailwindcss -i input.css -o css/tailwind.min.css --minify` |
| Google Fonts blocked / slow | Self-host woff2 in `/fonts/`, preload in `<head>` |
| Webhook returns 200 on error → Stripe won't retry | Return 500 on handler errors |
| Email in URL query strings (privacy) | Pass name or session_id instead |
| No email validation → ugly Stripe/GHL errors | Validate regex before API calls |
| Worker CORS missing → browser blocks requests | Return CORS headers on every response + OPTIONS |
| GHL custom field keys wrong → silent data loss | Verify field keys in GHL Settings → Custom Fields |
| Stripe webhook signature not verified → security hole | Always verify with `crypto.subtle` |
| JWT `atob` padding issues | Add `=` padding: `body + '='.repeat((4 - body.length % 4) % 4)` |
| Google OAuth missing `openid` scope | Always include `openid email profile` |
| Managed users sending namespace client-side | Server MUST override namespace — never trust client |
| BYOK proxy leaking to wrong Pinecone host | Validate host format before proxying |
| Plan check on provision bypassed | Always verify active Stripe subscription server-side |
