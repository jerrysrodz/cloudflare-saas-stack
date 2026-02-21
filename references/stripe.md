# Stripe Integration

## Checkout Session

```javascript
// POST /checkout handler
const { plan, email } = await request.json();

const params = new URLSearchParams({
  'mode': plan === 'one-time' ? 'payment' : 'subscription',
  'success_url': env.SUCCESS_URL + '?session_id={CHECKOUT_SESSION_ID}',
  'cancel_url': env.CANCEL_URL,
  'line_items[0][price]': plan === 'annual' ? env.ANNUAL_PRICE_ID : env.MONTHLY_PRICE_ID,
  'line_items[0][quantity]': '1',
});

// Prefill email (don't expose in URLs)
if (email) params.append('customer_email', email);

// Trial (subscriptions only)
if (plan !== 'one-time') {
  params.append('subscription_data[trial_period_days]', '7');
}

// Promo code field
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
// POST /webhook
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
      const customerId = session.customer;
      // Create/update CRM contact, send welcome email, etc.
      break;
    }
    case 'customer.subscription.deleted': {
      // Handle churn: update CRM tags, send win-back email
      break;
    }
  }
  return new Response('OK', { status: 200 });
} catch (err) {
  console.error('Webhook error:', err);
  return new Response('Error', { status: 500 }); // ← 500 so Stripe retries
}
```

## Webhook Signature Verification (Workers)

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

## Customer Portal

```javascript
// Find customer by email, create portal session
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

## Stripe CLI — Promo Codes

```powershell
stripe login  # Browser auth required

# 100% off forever (dev/testing)
stripe coupons create --percent-off=100 --duration=forever --id=GOLDHOLD-DEV
stripe promotion_codes create --coupon=GOLDHOLD-DEV --code=GOLDHOLD-DEV

# Percentage off for N months
stripe coupons create --percent-off=30 --duration=repeating --duration-in-months=3 --id=SHIPIT
stripe promotion_codes create --coupon=SHIPIT --code=SHIPIT

# Percentage off forever
stripe coupons create --percent-off=25 --duration=forever --id=NEVERFORGET
stripe promotion_codes create --coupon=NEVERFORGET --code=NEVERFORGET
```

## Webhook Setup

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://checkout.yourdomain.com/webhook`
3. Events: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`
4. Copy signing secret → `wrangler secret put STRIPE_WEBHOOK_SECRET`
