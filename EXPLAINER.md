# Cloudflare SaaS Stack — Agent Explainer

**Updated:** 2026-02-22

---

## What This Is

A battle-tested skill package for building and deploying SaaS products on a zero-server stack. Everything runs on Cloudflare's edge — no EC2, no Docker, no VPS. Your entire product ships as static files + a single JavaScript worker.

## The Stack

| Layer | Tool | What It Does |
|-------|------|-------------|
| **Frontend** | Cloudflare Pages | Static HTML/CSS. No React, no Next.js. Just files. Deploys in seconds. |
| **API** | Cloudflare Workers | One JS file handles checkout, webhooks, auth, email, API proxies. Runs at the edge, ~0ms cold start. |
| **Billing** | Stripe | Subscriptions, trials, promo codes, customer portal, plan upgrades/downgrades. Webhook-driven. |
| **CRM** | GoHighLevel (GHL) | Contact management, pipeline stages, tags, transactional email. |
| **Auth** | GitHub + Google OAuth | Login via OAuth → JWT token. No passwords, no sessions to manage. |
| **Storage** | Cloudflare KV | Key-value store for tokens, rate limiting, user state, provisioning records. Built into Workers. |
| **API Proxy** | Worker | Managed Pinecone proxy (server-side key injection, namespace isolation) + BYOK pass-through proxy. |

## Why This Stack

- **$0/mo at rest.** Cloudflare free tier covers Pages + Workers + KV. You pay Stripe 2.9% + $0.30 per transaction. That's it until you're making money.
- **No servers to maintain.** No patching, no uptime monitoring, no SSH.
- **Deploys in <5 seconds.** `npx wrangler pages deploy ./site` and you're live.
- **Scales automatically.** Cloudflare handles traffic spikes. You never think about it.
- **Zero npm dependencies in production.** JWT signing, webhook verification, rate limiting — all pure `crypto.subtle`.

## What's In The Skill Package

```
cloudflare-saas-stack/
├── SKILL.md                          ← Architecture, routing, deployment, dual-tier patterns
├── EXPLAINER.md                      ← This file — overview for agents and humans
├── references/
│   ├── cloudflare.md                 ← Pages, Workers, DNS, headers, fonts, Tailwind, SEO, image optimization
│   ├── stripe.md                     ← Checkout, webhooks, promo codes, plan upgrades/downgrades, portal
│   ├── ghl.md                        ← Contact CRUD, tags (merge!), pipelines, email, unsubscribe, onboarding tags
│   ├── github-oauth.md               ← GitHub + Google OAuth flows, ID token decoding, JWT integration
│   ├── jwt-auth.md                   ← Pure crypto.subtle JWT — sign, verify, payload, no dependencies
│   ├── magic-links-auth.md           ← Passwordless KV token auth, dual auth (JWT + magic), login flow
│   ├── managed-memory.md             ← Pinecone proxy, provisioning, namespace isolation, BYOK vs managed
│   ├── zip-injection.md              ← Dynamic ZIP file injection, CRC32, serial numbers, download tracking
│   ├── website-building.md           ← Page architecture, pricing, account dashboard, design system, email templates
│   ├── remote-operations.md          ← CLI/API control of GitHub, Cloudflare, Stripe, GHL, Google, Pinecone
│   └── security.md                   ← Pre-launch checklist, common vulnerabilities, hardening
└── scripts/
    └── magic-links.js                ← Drop-in KV token module (generate, validate, revoke)
```

## Key Patterns

### Dual-Tier Architecture
Two user classes share the same dashboard but different plumbing:
- **BYOK users** (free/monthly) bring their own Pinecone key. Client sends it in `X-Pinecone-Key` header → worker proxies directly to Pinecone.
- **Managed users** (annual/enterprise) never see a key. Client sends JWT in `Authorization` header → worker injects the Pinecone key server-side and enforces namespace isolation.

### JWT Auth (No Dependencies)
Pure `crypto.subtle` HMAC-SHA256 — no jsonwebtoken, no jose, no npm packages. OAuth callback signs a JWT, redirects with `?jwt=<token>`, client stores in localStorage, sends as Bearer token on every request.

### Server-Side Namespace Isolation
Managed users get a namespace derived from their email (`user@example.com` → `user_example_com`). The server ALWAYS overrides the namespace from the verified JWT — never trusts client input.

### Plan-Gated Features
Provisioning checks the live Stripe subscription before granting managed memory. No cached plan data — real-time verification.

## The Hard-Won Lessons Baked In

- **Email validation before external API calls.** GHL returns 502 on bad emails. Stripe returns empty 400s. Validate first.
- **Webhook must return 500 on error.** If you return 200 when your handler fails, Stripe won't retry. You lose the customer silently.
- **GHL custom field keys aren't the display names.** Copy the actual key from Settings → Custom Fields. Wrong key = silent data loss.
- **Never put email in URLs.** Use JWT tokens. Emails in URLs leak into browser history, analytics, server logs.
- **Self-host your fonts.** Google Fonts CDN adds latency and is a GDPR liability.
- **JWT base64 padding.** `atob` needs `=` padding: `body + '='.repeat((4 - body.length % 4) % 4)`. Miss this and tokens break silently on some payloads.
- **Google OAuth needs `openid` scope.** Without it, you don't get the email. Include `openid email profile`.
- **Never trust client-supplied namespaces.** Managed proxy MUST derive namespace from JWT-verified email, server-side.
- **Rate limit everything public.** KV-based rate limiting costs nothing and prevents bot abuse.
- **Signup idempotency.** Search for existing contact by email before creating. Otherwise re-signups create duplicates.
- **Plan verification on provision.** Always check Stripe in real-time — don't trust a cached plan value.

## What This Doesn't Cover

- **Frontend frameworks.** This is vanilla HTML/CSS. If you want React/Vue/Svelte, that's a different skill.
- **Database.** KV is key-value only. For relational data, look at Cloudflare D1 (SQLite at the edge).
- **Multi-tenant architecture.** This handles namespace-per-user on a shared index. True multi-tenant (separate indexes, custom domains per tenant) needs additional patterns.
- **Background jobs.** Workers have 30s CPU time limit (paid plan). For long-running tasks, use Cloudflare Queues or Durable Objects.

## Quick Reference

| Task | Command |
|------|---------|
| Deploy site | `npx wrangler pages deploy ./site --project-name=my-project --commit-dirty=true` |
| Deploy worker | `cd worker && npx wrangler deploy` |
| Set a secret | `npx wrangler secret put SECRET_NAME` |
| Create KV namespace | `npx wrangler kv namespace create KV` |
| Tail worker logs | `npx wrangler tail` |
| Local dev | `npx wrangler dev` |

---

Questions? This skill was built from shipping a real product. Every pattern is production-tested. 🏴‍☠️
