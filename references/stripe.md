# Stripe Integration

## Checkout Session

```javascript
const { plan, email } = await request.json();

const params = new URLSearchParams({
  'mode': 'subscription',
  'success_url': env.SUCCESS_URL + '?session_id={CHECKOUT_SESSION_ID}',
  'cancel_url': env.CANCEL_URL,
  'line_items[0][price]': plan === 'annual' ? env.ANNUAL_PRICE_ID : env.MONTHLY_PRICE_ID,
  'line_items[0][quantity]': '1',
});

if (email) params.append('customer_email', email);

// Trial period
params.append('subscription_data[trial_period_days]', '7');

// Store plan in subscription metadata for later lookup
params.append('subscription_data[metadata][plan]', plan);

// Allow promo codes
params.append('allow_promotion_codes', 'true');

const session = await fetch('https://api.stripe.com/v1/checkout/sessions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: params.toString(),
});
```

## Webhook Handler

```javascript
const body = await request.text();
const signature = request.headers.get('stripe-signature');

// ALWAYS verify signature
const verified = await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET);
if (!verified) return new Response('Invalid signature', { status: 401 });

const event = JSON.parse(body);
try {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const email = session.customer_details?.email;
      // Upsert CRM contact, send welcome email, move pipeline stage
      break;
    }
    case 'customer.subscription.updated': {
      // Plan change (upgrade/downgrade) — update CRM tags + plan metadata
      break;
    }
    case 'customer.subscription.deleted': {
      // Churn — update CRM, send win-back email
      break;
    }
    case 'invoice.payment_failed': {
      // Failed payment — notify user
      break;
    }
  }
  return new Response('OK', { status: 200 });
} catch (err) {
  console.error('Webhook error:', err);
  return new Response('Error', { status: 500 }); // ← 500 so Stripe retries!
}
```

## Webhook Signature Verification (Workers)

Pure `crypto.subtle` — no npm packages:

```javascript
async function verifyStripeSignature(payload, header, secret) {
  const parts = Object.fromEntries(header.split(',').map(p => {
    const [k, v] = p.split('=');
    return [k, v];
  }));
  const signedPayload = `${parts.t}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === parts.v1;
}
```

## Plan Upgrade / Downgrade

Switch a customer between plans without creating a new subscription:

```javascript
// POST /upgrade handler
const { email, targetPlan } = await request.json();

// Find customer
const custRes = await fetch(
  `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`,
  { headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` } }
);
const custData = await custRes.json();
if (!custData.data?.length) return notFound('No customer found');

// Find active subscription
const subRes = await fetch(
  `https://api.stripe.com/v1/subscriptions?customer=${custData.data[0].id}&status=active&limit=1`,
  { headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` } }
);
const subData = await subRes.json();
const sub = subData.data?.[0];
if (!sub) return notFound('No active subscription');

const newPriceId = targetPlan === 'annual' ? env.ANNUAL_PRICE_ID : env.MONTHLY_PRICE_ID;
const itemId = sub.items.data[0].id;

// Option A: Stripe-hosted checkout for upgrade (handles proration UI)
const checkoutParams = new URLSearchParams({
  'mode': 'subscription',
  'customer': custData.data[0].id,
  'line_items[0][price]': newPriceId,
  'line_items[0][quantity]': '1',
  'success_url': 'https://yourdomain.com/account?upgraded=true',
  'cancel_url': 'https://yourdomain.com/account',
  'subscription_data[metadata][plan]': targetPlan,
});
// Cancel old sub after new one starts
// OR use subscription update API for immediate switch:

// Option B: Direct API update (immediate, auto-prorates)
const updateRes = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    'items[0][id]': itemId,
    'items[0][price]': newPriceId,
    'metadata[plan]': targetPlan,
    'proration_behavior': 'create_prorations',
  }).toString(),
});
```

## Customer Portal

```javascript
const custRes = await fetch(
  `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`,
  { headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` } }
);
const custData = await custRes.json();
if (!custData.data?.length) return notFound('No subscription found');

const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: `customer=${custData.data[0].id}&return_url=https://yourdomain.com/account`,
});
```

## Plan Detection from Subscription

```javascript
function detectPlan(subscription, env) {
  // Check metadata first (set during checkout)
  if (subscription.metadata?.plan) return subscription.metadata.plan;
  // Fall back to price ID matching
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (priceId === env.ANNUAL_PRICE_ID) return 'annual';
  if (priceId === env.MONTHLY_PRICE_ID) return 'monthly';
  return 'unknown';
}
```

## Stripe CLI — Promo Codes

```powershell
stripe login

# 100% off forever (dev/testing)
stripe coupons create --percent-off=100 --duration=forever --id=DEV-FREE
stripe promotion_codes create --coupon=DEV-FREE --code=DEV-FREE

# Win-back: 20% off for 3 months
stripe coupons create --percent-off=20 --duration=repeating --duration-in-months=3 --id=COMEBACK20
stripe promotion_codes create --coupon=COMEBACK20 --code=COMEBACK20

# 25% off forever
stripe coupons create --percent-off=25 --duration=forever --id=LOYAL25
stripe promotion_codes create --coupon=LOYAL25 --code=LOYAL25
```

## Webhook Setup

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://checkout.yourdomain.com/webhook`
3. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
4. Copy signing secret → `wrangler secret put STRIPE_WEBHOOK_SECRET`

## Gotchas

| Issue | Fix |
|-------|-----|
| Webhook returns 200 on error | Return 500 so Stripe retries |
| Missing webhook events | Subscribe to `subscription.updated` for plan changes |
| Plan metadata not set | Always include `subscription_data[metadata][plan]` in checkout |
| Proration surprises | Use `proration_behavior: 'create_prorations'` explicitly |
| Customer has multiple subs | Query `status=active&limit=1` and handle edge cases |
