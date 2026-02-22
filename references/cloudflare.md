# Cloudflare Pages + Workers

## Pages (Static Site)

### Deploy
```powershell
# First deploy creates the project
npx wrangler pages deploy ./site --project-name=my-project --commit-dirty=true

# Subsequent deploys
npx wrangler pages deploy ./site --project-name=my-project --branch=main
```

### Custom Domain
1. Cloudflare dashboard → Pages → my-project → Custom domains → Add
2. Add `yourdomain.com` — Cloudflare auto-creates CNAME
3. SSL is automatic

### Headers (`site/_headers`)

Full production example with CSP including Stripe JS, API subdomain, and Pinecone proxy:

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self' https://checkout.yourdomain.com https://api.yourdomain.com https://api.stripe.com; frame-src https://js.stripe.com; base-uri 'self'; form-action 'self' https://checkout.yourdomain.com

/*.css
  Cache-Control: public, max-age=604800

/*.js
  Cache-Control: public, max-age=604800

/*.png
  Cache-Control: public, max-age=604800

/*.jpg
  Cache-Control: public, max-age=604800

/*.woff2
  Cache-Control: public, max-age=31536000

/*.xml
  Cache-Control: public, max-age=3600

/thank-you
  X-Robots-Tag: noindex

/thank-you.html
  X-Robots-Tag: noindex

/account
  X-Robots-Tag: noindex

/account.html
  X-Robots-Tag: noindex
```

**Key points:**
- `X-Robots-Tag: noindex` on any page you don't want Google crawling (account, thank-you, dashboard)
- `connect-src` must include your Worker domain AND `api.stripe.com`
- `frame-src` for Stripe's embedded checkout
- `unsafe-inline` for `style-src` because Tailwind uses inline styles (compile locally to avoid)

### Redirects (`site/_redirects`)

```
/buy /#pricing 302
/pricing /#pricing 302
/subscribe /#pricing 302
/get-started /#pricing 302
/login /account 301
/dashboard /account 301
```

## Workers (API)

### wrangler.toml

```toml
name = "my-checkout"
main = "index.js"
compatibility_date = "2024-12-01"

[vars]
STRIPE_PUBLISHABLE_KEY = "pk_live_..."
MONTHLY_PRICE_ID = "price_..."
ANNUAL_PRICE_ID = "price_..."
LITE_PRICE_ID = "price_..."
DONATION_PRICE_ID = "price_..."
SUCCESS_URL = "https://yourdomain.com/thank-you"
CANCEL_URL = "https://yourdomain.com"
GHL_LOCATION_ID = "..."
GITHUB_CLIENT_ID = "..."
GITHUB_CALLBACK_URL = "https://checkout.yourdomain.com/auth/callback"
GOOGLE_CLIENT_ID = "..."
GOOGLE_CALLBACK_URL = "https://checkout.yourdomain.com/auth/google/callback"
MANAGED_PINECONE_HOST = "your-index-abc123.svc.pinecone.io"
MANAGED_PINECONE_INDEX = "your-managed-index"

[[kv_namespaces]]
binding = "KV"
id = "abc123"
```

### Custom Domain for Worker
1. DNS → Add AAAA record: `checkout` → `100::` (proxy ON)
2. Workers → my-checkout → Triggers → Add route: `checkout.yourdomain.com/*`

### Setting Secrets
```powershell
cd worker
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put GHL_PIT_TOKEN
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put JWT_SECRET
npx wrangler secret put MANAGED_PINECONE_KEY
npx wrangler secret put ADMIN_KEY
```

### KV Namespace
```powershell
npx wrangler kv namespace create KV
# Copy the id into wrangler.toml
```

### Debugging
```powershell
npx wrangler tail          # Live tail logs
npx wrangler dev           # Local dev with hot reload
```

## DNS Configuration

### For Pages (static site)
- Cloudflare adds CNAME automatically when you add custom domain in Pages settings

### For Worker (API subdomain)
- AAAA record: `checkout` → `100::` (proxied)
- Route in Worker settings: `checkout.yourdomain.com/*`

### Email Routing (receive-only)
- Cloudflare Dashboard → Email → Routing → Add rule
- Routes `support@yourdomain.com` → your real email
- Cannot SEND from this address without a sending provider

### SPF/DKIM/DMARC (for sending via GHL/Mailgun)
1. **SPF**: TXT on `@` → `v=spf1 include:mailgun.org ~all` (adjust for your provider)
2. **DKIM**: TXT record provided by your sending provider
3. **DMARC**: TXT on `_dmarc` → `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com`

## Image Optimization

Compress all images >200KB before deploying. Use `sharp-cli`:

```powershell
npm install -g sharp-cli

# Backup originals, convert to WebP
Get-ChildItem site/*.png | Where-Object { $_.Length -gt 200KB } | ForEach-Object {
  Copy-Item $_.FullName "$($_.FullName).bak"
  sharp -i $_.FullName -o ($_.FullName -replace '\.png$','.webp') --format webp --quality 85
}
```

Then update HTML to use `<picture>` with WebP + PNG fallback, or just swap to `.webp`.

## Self-Hosting Fonts

Never use Google Fonts CDN — it adds latency and is a GDPR liability.

```css
/* css/fonts.css */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('/fonts/inter-var.woff2') format('woff2');
}
```

```html
<!-- Preload for fast rendering -->
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css">
```

## Tailwind CSS

Compile locally — never use the CDN play script in production:

```powershell
npx tailwindcss -i input.css -o css/tailwind.min.css --minify
```

The CDN play script (`<script src="https://cdn.tailwindcss.com">`) breaks with custom utility classes and adds 300KB+ to page load.

## SEO

### robots.txt
```
User-agent: *
Allow: /
Disallow: /account
Disallow: /thank-you
Sitemap: https://yourdomain.com/sitemap.xml
```

### sitemap.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://yourdomain.com/</loc><priority>1.0</priority></url>
  <url><loc>https://yourdomain.com/how-it-works</loc><priority>0.8</priority></url>
  <url><loc>https://yourdomain.com/changelog</loc><priority>0.5</priority></url>
  <url><loc>https://yourdomain.com/legal</loc><priority>0.3</priority></url>
</urlset>
```

### Structured Data (JSON-LD)
Every page should have Organization + SoftwareApplication schema. Double-check URLs match your actual domain (common bug: leaving old domain references in structured data).
