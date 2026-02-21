# Security Hardening Checklist

## Pre-Launch (must-fix)

- [ ] **Email validation** on all endpoints accepting email input
- [ ] **Rate limiting** on /checkout, /signup, /portal (KV-based, 5-10 req/5min/IP)
- [ ] **Webhook signature verification** — never trust unverified Stripe webhooks
- [ ] **CORS locked to your domain** — not `*`
- [ ] **Worker secrets** — never hardcode API keys, use `wrangler secret put`
- [ ] **CSP headers** — restrict script/connect/frame sources
- [ ] **No email in URLs** — use session IDs or tokens instead
- [ ] **Webhook returns 500 on error** — so Stripe retries failed deliveries
- [ ] **Signup idempotency** — check for existing contact before creating

## Post-Launch

- [ ] **DMARC/SPF/DKIM** for sending domain
- [ ] **Unsubscribe** endpoint that actually works (CAN-SPAM)
- [ ] **GDPR compliance** — right to erasure, data export, processing basis, DPO contact
- [ ] **DMCA agent** named in legal page
- [ ] **Cookie consent** if using analytics
- [ ] **robots.txt + sitemap.xml** current and accurate

## Common Vulnerabilities in This Stack

| Vulnerability | Where | Fix |
|---------------|-------|-----|
| Email enumeration via /portal | Worker | Rate limit + generic "check your email" response |
| CSRF on billing portal | Worker | Rate limit + consider requiring auth token |
| PII in URL query strings | Thank-you page, emails | Use tokens/names, not emails |
| Stale API tokens as fallback | Worker env vars | Remove hardcoded fallbacks |
| Missing `</footer>` tags | HTML pages | Validate HTML |
| Dead links (404) | Footer, nav | Verify all hrefs |
| Unsupported headers in GHL API | Worker | Remove headers GHL ignores |

## Structured Data / SEO

- JSON-LD Organization schema on every page (correct URLs!)
- FAQPage schema on FAQ sections
- BreadcrumbList for navigation
- SoftwareApplication schema for product pages
- Verify: no references to old domains in structured data
