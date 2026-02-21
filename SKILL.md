---
name: cloudflare-saas-stack
description: Build and deploy SaaS products on the Cloudflare + Stripe + GoHighLevel + GitHub OAuth stack. Use when building landing pages on Cloudflare Pages, checkout/webhook workers on Cloudflare Workers, Stripe billing (subscriptions, trials, promo codes, customer portal), GoHighLevel CRM integration (contacts, pipelines, tags, emails), GitHub OAuth login flows, or any combination. Also use when deploying, configuring DNS, setting worker secrets, or debugging this stack.
---

# Cloudflare SaaS Stack

Full-stack SaaS deployment using Cloudflare Pages (static site) + Workers (API/checkout) + Stripe (billing) + GoHighLevel (CRM/email) + GitHub OAuth (auth).

## Architecture

```
goldhold.ai (Pages)          checkout.goldhold.ai (Worker)
┌─────────────────┐          ┌──────────────────────────────┐
│ Static HTML/CSS  │──POST──▶│ /checkout  → Stripe session  │
│ Tailwind (local) │         │ /webhook   → Stripe webhook  │
│ No frameworks    │         │ /signup    → GHL contact      │
│ Self-hosted fonts│         │ /portal    → Billing portal   │
└─────────────────┘          │ /auth/*    → GitHub OAuth     │
                             │ /unsub     → Email unsub      │
                             └──────────────────────────────┘
                                    │           │
                          ┌─────────┘           └──────────┐
                          ▼                                ▼
                    Stripe API                      GHL API
                    - Checkout Sessions             - Contacts
                    - Subscriptions                 - Tags
                    - Customer Portal               - Pipelines
                    - Webhooks                      - Email (transactional)
```

## Quick Start

1. Read `references/cloudflare.md` for Pages + Workers setup
2. Read `references/stripe.md` for billing integration
3. Read `references/ghl.md` for CRM/email integration
4. Read `references/github-oauth.md` for auth flow
5. Read `references/security.md` for hardening checklist

## Worker Structure

A single Worker handles all API routes. Key pattern:

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': 'https://yourdomain.com' };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS' } });
    }

    // Route dispatch
    if (url.pathname === '/checkout' && request.method === 'POST') { /* Stripe checkout */ }
    if (url.pathname === '/webhook' && request.method === 'POST') { /* Stripe webhook */ }
    if (url.pathname === '/signup' && request.method === 'POST') { /* Free tier signup */ }
    if (url.pathname === '/portal' && request.method === 'POST') { /* Billing portal */ }
    if (url.pathname === '/auth/github') { /* OAuth redirect */ }
    if (url.pathname === '/auth/callback') { /* OAuth callback */ }
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

// Usage: 10 requests per 5 minutes per IP
const ip = request.headers.get('cf-connecting-ip');
if (!await checkRateLimit(`checkout:${ip}`, 10, 300, env)) {
  return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 });
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
