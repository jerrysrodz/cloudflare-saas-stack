# Building the Website (Operational Guide)

## Philosophy

No frameworks. No build tools (except Tailwind). No React, no Next.js, no Webpack. Every page is a standalone HTML file with inline `<script>` blocks. Deploy in seconds. Debug by reading the source.

## Page Architecture

| Page | Purpose | Auth? |
|------|---------|-------|
| `index.html` | Landing page (hero, features, pricing, FAQ, footer) | No |
| `account.html` | Dashboard (plan status, downloads, memory browser, settings) | Yes (JWT or magic token) |
| `thank-you.html` | Post-purchase (downloads, setup guides) | No (but personalized via query params) |
| `how-it-works.html` | Explainer / docs | No |
| `changelog.html` | Product changelog | No |
| `legal.html` | Privacy + Terms | No |
| `privacy.html` | Privacy policy | No |
| `terms.html` | Terms of service | No |

## Landing Page Anatomy

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Product — Tagline</title>
  <meta name="description" content="...">

  <!-- OG tags -->
  <meta property="og:title" content="Product">
  <meta property="og:description" content="...">
  <meta property="og:image" content="https://yourdomain.com/og-card.webp">
  <meta property="og:url" content="https://yourdomain.com">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">

  <!-- Favicon -->
  <link rel="icon" type="image/png" href="/favicon.png">

  <!-- Self-hosted fonts -->
  <link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>

  <!-- Compiled Tailwind (NOT CDN) -->
  <link rel="stylesheet" href="/css/tailwind.min.css">

  <!-- JSON-LD -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "YourProduct",
    "url": "https://yourdomain.com",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Cross-platform",
    "offers": { "@type": "Offer", "price": "9", "priceCurrency": "USD" },
    "publisher": {
      "@type": "Organization",
      "name": "Your Company LLC",
      "url": "https://yourdomain.com"
    }
  }
  </script>
</head>
<body class="bg-[#0a0a0f] text-gray-200">
  <!-- Nav -->
  <!-- Hero -->
  <!-- Features -->
  <!-- How it works -->
  <!-- Pricing (id="pricing") -->
  <!-- FAQ -->
  <!-- Footer -->
</body>
</html>
```

## Pricing Section Pattern

Three-tier with highlight on recommended plan:

```html
<section id="pricing" class="py-24">
  <div class="max-w-6xl mx-auto grid md:grid-cols-3 gap-8">
    <!-- Free tier -->
    <div class="border border-white/10 rounded-2xl p-8">
      <h3>Free</h3>
      <div class="text-4xl font-black">$0</div>
      <ul>...</ul>
      <button onclick="handleFreeTier()">Get Started</button>
    </div>

    <!-- Pro (highlighted) -->
    <div class="border-2 border-amber-500 rounded-2xl p-8 relative">
      <span class="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-black px-4 py-1 rounded-full text-sm font-bold">Most Popular</span>
      <h3>Pro</h3>
      <div class="text-4xl font-black">$9<span class="text-lg">/mo</span></div>
      <ul>...</ul>
      <button onclick="handleCheckout('monthly')">Start Free Trial</button>
    </div>

    <!-- Annual -->
    <div class="border border-white/10 rounded-2xl p-8">
      <h3>Annual</h3>
      <div class="text-4xl font-black">$7<span class="text-lg">/mo</span></div>
      <p class="text-amber-500">Save $24/year</p>
      <ul>...</ul>
      <button onclick="handleCheckout('annual')">Start Free Trial</button>
    </div>
  </div>
</section>
```

## Checkout Flow (Frontend → Worker)

```javascript
async function handleCheckout(plan) {
  const email = document.getElementById('checkout-email').value.trim();
  if (!email || !email.includes('@')) {
    showError('Please enter a valid email');
    return;
  }

  // Option A: Redirect via GET (simpler)
  window.location.href = `https://checkout.yourdomain.com/checkout?plan=${plan}&email=${encodeURIComponent(email)}`;

  // Option B: POST + redirect (more control)
  const res = await fetch('https://checkout.yourdomain.com/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, email }),
  });
  const data = await res.json();
  if (data.url) window.location.href = data.url;
}
```

## Account Page Architecture

The account page is the most complex — it handles:
1. **Auth** — JWT (OAuth) or magic token verification
2. **Plan display** — current plan, status, upgrade options
3. **Downloads** — gated by auth, tracked with serials
4. **Memory browser** — Pinecone dashboard (overview, browse, search)
5. **Settings** — Pinecone connection (BYOK) or managed memory setup

### Auth on Load

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);

  // JWT from OAuth
  const jwt = params.get('jwt');
  if (jwt) {
    localStorage.setItem('token', jwt);
    window.history.replaceState({}, '', '/account');
  }

  // Magic token from email
  const magicToken = params.get('token');
  if (magicToken) {
    localStorage.setItem('magic_token', magicToken);
    window.history.replaceState({}, '', '/account');
  }

  // Try JWT first, fall back to magic token
  const token = localStorage.getItem('token');
  if (token) {
    const res = await fetch('https://checkout.yourdomain.com/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (data.authenticated) {
      renderDashboard(data);
      return;
    }
    localStorage.removeItem('token');
  }

  const magic = localStorage.getItem('magic_token');
  if (magic) {
    const res = await fetch(`https://checkout.yourdomain.com/api/auth?token=${magic}`);
    const data = await res.json();
    if (data.valid) {
      renderDashboard(data);
      return;
    }
    localStorage.removeItem('magic_token');
  }

  // Not authenticated — show login
  showLoginForm();
});
```

### Plan-Aware UI

```javascript
function renderDashboard(account) {
  // Show plan badge
  document.getElementById('plan-badge').textContent = account.plan.toUpperCase();

  // Show/hide upgrade buttons based on current plan
  if (account.upgrades?.length) {
    account.upgrades.forEach(u => {
      addUpgradeButton(u.to, u.label);
    });
  }

  // Plan-gated features
  if (account.plan === 'annual' || account.plan === 'enterprise') {
    showManagedMemorySetup(); // Show "Set Up Managed Data" button
  } else {
    showBYOKSetup();          // Show "Enter your Pinecone key"
  }
}
```

## Memory Browser (Client-Side Pinecone)

The account page includes a full Pinecone browser with three tabs:

### Overview Tab
- Vector count gauge
- Namespace list from `describe_index_stats`
- Dimension info

### Browse Tab
- Namespace dropdown
- Paginated vector list (`/vectors/list`)
- Click vector → fetch full record (`/vectors/fetch`)
- Show metadata as expandable JSON

### Search Tab
- Text input → embed via `/embed` → query via `/query`
- Results with score, metadata preview
- Click to expand full record

All API calls go through the dual-path routing (`pcHostFetch` → BYOK proxy or managed proxy).

## Dark Mode Design System

Consistent across all pages:

```css
/* Base */
background: #0a0a0f;
color: #e5e7eb;

/* Accent */
amber-500: #f59e0b;  /* Primary brand color */

/* Cards */
background: #111118;
border: 1px solid rgba(255,255,255,0.05);
border-radius: 16px;

/* Buttons (primary) */
background: #f59e0b;
color: #0a0a0f;
font-weight: 700;
border-radius: 12px;

/* Buttons (secondary) */
border: 1px solid rgba(245,158,11,0.3);
color: #f59e0b;

/* Text hierarchy */
h1: white, bold
body: #d1d5db
muted: #9ca3af
faint: #6b7280
```

## Email Template Pattern

All transactional emails follow the same dark-mode design:

```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            max-width: 600px; margin: 0 auto; background: #0a0a0f; color: #e5e7eb;
            padding: 40px 24px; border-radius: 16px;">

  <!-- Header -->
  <h1 style="color: #f59e0b; font-size: 28px; text-align: center;">Title 🏴‍☠️</h1>

  <!-- Body -->
  <p style="font-size: 16px; line-height: 1.6; color: #d1d5db;">Content...</p>

  <!-- CTA -->
  <div style="text-align: center; margin: 32px 0;">
    <a href="URL" style="background: #f59e0b; color: #0a0a0f; font-weight: 700;
       padding: 16px 32px; border-radius: 12px; text-decoration: none;
       display: inline-block;">Call to Action →</a>
  </div>

  <!-- Footer (CAN-SPAM compliant) -->
  <div style="text-align: center; margin-top: 32px; padding-top: 24px;
              border-top: 1px solid rgba(255,255,255,0.05);">
    <p style="font-size: 12px; color: #6b7280;">Brand — Tagline 🏴‍☠️</p>
    <p style="font-size: 11px; color: #4b5563;">© 2026 Company LLC</p>
    <p style="font-size: 11px; color: #4b5563;">Company · Address</p>
    <p style="font-size: 11px; color: #4b5563;"><a href="UNSUB_URL" style="color: #6b7280; text-decoration: underline;">Unsubscribe</a></p>
  </div>
</div>
```

## Admin Endpoints

Protected by `ADMIN_KEY` query param:

```javascript
if (url.pathname.startsWith('/admin/')) {
  const key = url.searchParams.get('key');
  if (!key || key !== env.ADMIN_KEY) return error(401, 'Unauthorized');
}
```

| Endpoint | Purpose |
|----------|---------|
| `/admin/serials` | Full serial log |
| `/admin/test-downgrade` | Send all email templates to test address |
| `/admin/update-price-nicknames` | Set Stripe price nicknames |
| `/admin/create-lite-price` | Create $0 Stripe price for free tier |

## Common Patterns

### Rate Limiting (Every Public Endpoint)
```javascript
const clientIP = request.headers.get('cf-connecting-ip') || 'unknown';
if (!await checkRateLimit(`endpoint:${clientIP}`, 5, 300, env)) {
  return error(429, 'Too many requests. Try again in a few minutes.');
}
```

### Error Response Helper
```javascript
function error(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
```

### Clean URL on Auth
```javascript
// Remove tokens from URL after reading them
window.history.replaceState({}, '', '/account');
```

### Idempotent Signup
```javascript
// Always check before creating
let contactId = await findGHLContact(email, env);
if (!contactId) {
  contactId = await createContact(email, env);
} else {
  await addGHLTags(contactId, ['returning'], env);
}
```
