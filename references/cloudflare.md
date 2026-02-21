# Cloudflare Pages + Workers

## Pages (Static Site)

### Setup
```powershell
# First deploy creates the project
npx wrangler pages deploy ./site --project-name=my-project --commit-dirty=true
```

### Custom Domain
1. Cloudflare dashboard → Pages → my-project → Custom domains → Add
2. Add `yourdomain.com` — Cloudflare auto-creates CNAME
3. SSL is automatic

### Headers (`site/_headers`)
```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; connect-src 'self' https://checkout.yourdomain.com https://api.stripe.com; frame-src https://js.stripe.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/css/*
  Cache-Control: public, max-age=604800

/img/*
  Cache-Control: public, max-age=604800
```

### Redirects (`site/_redirects`)
```
/dashboard  /account  301
/login      /account  301
```

## Workers (API)

### wrangler.toml
```toml
name = "my-checkout"
main = "index.js"
compatibility_date = "2024-12-01"

[vars]
STRIPE_PUBLISHABLE_KEY = "pk_live_..."

[[kv_namespaces]]
binding = "KV"
id = "abc123"

[routes]
pattern = "checkout.yourdomain.com/*"
```

### Custom Domain for Worker
1. DNS → Add AAAA record: `checkout` → `100::` (proxy ON)
2. Workers → my-checkout → Triggers → Add route: `checkout.yourdomain.com/*`

### KV Namespace
```powershell
npx wrangler kv namespace create KV
# Copy the id into wrangler.toml
```

### Debugging
```powershell
# Live tail logs
npx wrangler tail

# Local dev
npx wrangler dev
```

## DNS for Email (SPF/DKIM)

To send email FROM your domain (not just receive):

1. **SPF**: TXT record on `@` → `v=spf1 include:_spf.mx.cloudflare.net ~all`
2. **DKIM**: Depends on sending provider (Mailgun, SES, Resend, etc.)
3. **DMARC**: TXT record on `_dmarc` → `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com`

### Cloudflare Email Routing (receive only)
- Dashboard → Email → Routing → Add rule
- Routes `support@yourdomain.com` → your personal email
- Cannot SEND from this address without a separate sending provider

## Image Optimization

Compress all images >200KB before deploying:
```powershell
# Install sharp-cli
npm install -g sharp-cli

# Compress to WebP (keep originals as .bak)
Get-ChildItem site/img/*.png | Where-Object { $_.Length -gt 200KB } | ForEach-Object {
  Copy-Item $_.FullName "$($_.FullName).bak"
  sharp -i $_.FullName -o ($_.FullName -replace '\.png$','.webp') --format webp --quality 85
}
```

## Self-Hosting Fonts

Never use Google Fonts CDN — self-host for speed + privacy:
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
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css">
```
