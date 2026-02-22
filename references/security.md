# Security Hardening Checklist

## Pre-Launch (must-fix)

- [ ] **Email validation** on all endpoints accepting email input
- [ ] **Rate limiting** on /checkout, /signup, /portal, /auth/* (KV-based, 5-10 req/5min/IP)
- [ ] **Webhook signature verification** — never trust unverified Stripe webhooks
- [ ] **CORS locked to your domain** — not `*`, include in OPTIONS + every response
- [ ] **Worker secrets** — never hardcode API keys, use `wrangler secret put`
- [ ] **CSP headers** — restrict script/connect/frame sources
- [ ] **No email in URLs** — use JWT tokens or session IDs instead
- [ ] **Webhook returns 500 on error** — so Stripe retries failed deliveries
- [ ] **Signup idempotency** — check for existing contact before creating
- [ ] **JWT secret is strong** — 32+ random chars, stored as worker secret
- [ ] **JWT expiration checked** — `verifyToken` validates `exp` claim
- [ ] **OAuth codes exchanged server-side** — never expose client secrets to browser
- [ ] **Managed namespace enforced server-side** — never trust client-supplied namespace
- [ ] **Pinecone key never sent to client** — managed users authenticate via JWT only
- [ ] **Plan verification on provision** — always check Stripe for active sub, don't trust cached plan

## Post-Launch

- [ ] **DMARC/SPF/DKIM** for sending domain
- [ ] **Unsubscribe** endpoint that actually works (CAN-SPAM)
- [ ] **GDPR compliance** — right to erasure, data export, processing basis, DPO contact
- [ ] **DMCA agent** named in legal page
- [ ] **Cookie consent** if using analytics
- [ ] **robots.txt + sitemap.xml** current and accurate
- [ ] **KV cleanup** — expired rate-limit keys auto-expire via TTL

## Common Vulnerabilities in This Stack

| Vulnerability | Where | Fix |
|---------------|-------|-----|
| Email enumeration via /portal | Worker | Rate limit + generic "check your email" response |
| CSRF on billing portal | Worker | Rate limit + require auth token |
| PII in URL query strings | Thank-you page, emails | Use tokens/names, not emails |
| Stale API tokens as fallback | Worker env vars | Remove hardcoded fallbacks |
| JWT secret too short/weak | Worker secrets | Use 32+ char random string |
| Namespace spoofing on managed proxy | /v1/memory/* | Server always derives from JWT email |
| BYOK proxy open redirect | /pinecone/host/* | Validate host format (must end in `.pinecone.io`) |
| Missing CORS on OPTIONS | All endpoints | Return full CORS headers on preflight |
| Google OAuth without `openid` scope | /auth/google | Always include `openid email profile` |
| Dead links (404) | Footer, nav | Verify all hrefs before launch |

## Structured Data / SEO

- JSON-LD Organization schema on every page (correct URLs!)
- FAQPage schema on FAQ sections
- BreadcrumbList for navigation
- SoftwareApplication schema for product pages
- Verify: no references to old domains in structured data
