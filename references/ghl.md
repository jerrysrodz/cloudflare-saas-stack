# GoHighLevel (GHL) CRM Integration

## API Basics

Base URL: `https://services.leadconnectorhq.com`
Auth: `Authorization: Bearer <TOKEN>` + `Version: 2021-07-28`

**Important:** Use Location API keys or PIT (Private Integration Tokens), NOT user-level API keys. PIT tokens are set via `wrangler secret put GHL_PIT_TOKEN`.

## Contact Operations

### Find Contact by Email (Idempotency Check)

Always search before creating — prevents duplicates:

```javascript
async function findGHLContact(email, env) {
  try {
    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${env.GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
      {
        headers: {
          'Authorization': `Bearer ${env.GHL_PIT_TOKEN}`,
          'Version': '2021-07-28',
          'Accept': 'application/json',
        },
      }
    );
    const data = await res.json();
    return data.contact?.id || null;
  } catch { return null; }
}
```

### Create/Update Contact (Upsert)

```javascript
async function upsertGHLContact(email, name, plan, stripeCustomerId, subscriptionId, env) {
  const tag = plan === 'annual' ? 'goldhold-annual' : plan === 'one-time' ? 'goldhold-one-time' : 'goldhold-monthly';
  const tags = ['goldhold-customer', tag, 'active-subscriber', 'welcome-sent'];

  // Search for existing
  const searchRes = await fetch(
    `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${env.GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
    { headers: { 'Authorization': `Bearer ${env.GHL_PIT_TOKEN}`, 'Version': '2021-07-28', 'Accept': 'application/json' } }
  );
  const searchData = await searchRes.json();
  let contactId = searchData.contact?.id;

  const contactData = {
    email,
    tags,
    source: 'Website',
    customFields: [
      { key: 'contact.subscription_plan', field_value: plan },
      { key: 'contact.subscription_start_date', field_value: new Date().toISOString() },
    ],
  };

  if (name) {
    const parts = name.split(' ');
    contactData.firstName = parts[0];
    contactData.lastName = parts.slice(1).join(' ') || '';
  }

  if (contactId) {
    // Update existing
    await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${env.GHL_PIT_TOKEN}`, 'Version': '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify(contactData),
    });
  } else {
    // Create new
    contactData.locationId = env.GHL_LOCATION_ID;
    const createRes = await fetch('https://services.leadconnectorhq.com/contacts/', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.GHL_PIT_TOKEN}`, 'Version': '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify(contactData),
    });
    const createData = await createRes.json();
    contactId = createData.contact?.id;
  }
  return contactId;
}
```

### Add Tags (Merge with Existing)

```javascript
async function addGHLTags(contactId, tags, env) {
  // GET existing tags first — GHL replaces all tags on PUT
  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    headers: { 'Authorization': `Bearer ${env.GHL_PIT_TOKEN}`, 'Version': '2021-07-28', 'Accept': 'application/json' },
  });
  const data = await res.json();
  const existingTags = data.contact?.tags || [];
  const newTags = [...new Set([...existingTags, ...tags])];

  await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${env.GHL_PIT_TOKEN}`, 'Version': '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags: newTags }),
  });
}
```

**Critical:** GHL's PUT replaces ALL tags. If you just send the new tags, you lose the old ones. Always GET first, merge, then PUT.

### Remove Tags

```javascript
async function removeGHLTags(contactId, tagsToRemove, env) {
  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    headers: { 'Authorization': `Bearer ${env.GHL_PIT_TOKEN}`, 'Version': '2021-07-28', 'Accept': 'application/json' },
  });
  const data = await res.json();
  const existingTags = data.contact?.tags || [];
  const newTags = existingTags.filter(t => !tagsToRemove.includes(t));

  await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${env.GHL_PIT_TOKEN}`, 'Version': '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags: newTags }),
  });
}
```

### Add Notes to Contact

Useful for logging downloads, serial numbers, activity:

```javascript
await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${env.GHL_PIT_TOKEN}`, 'Version': '2021-07-28', 'Content-Type': 'application/json' },
  body: JSON.stringify({ body: `📦 Download: ${file}\nSerial: ${serial}\nDate: ${new Date().toISOString()}` }),
});
```

## Sending Email via GHL Conversations API

GHL doesn't have a traditional transactional email API. Use the Conversations API:

```javascript
async function sendEmail(contactId, email, subject, htmlBody, env) {
  const res = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.GHL_PIT_TOKEN}`, 'Version': '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'Email',
      contactId,
      subject,
      html: htmlBody,
      emailFrom: 'YourProduct <noreply@notify.yourdomain.com>',
    }),
  });
  return { success: res.ok };
}
```

**Requirements:**
- Contact MUST exist in GHL before you can send email
- `emailFrom` must be a verified sending domain in GHL
- `List-Unsubscribe` headers are configured at the GHL/Mailgun level, not per-request
- GHL does NOT support custom email headers in the Conversations API payload

## Email Templates (Lifecycle)

Build these as HTML strings in your Worker. Each should include:
- Dark-mode-first design (dark bg + light text)
- Clear CTA button
- Physical address (CAN-SPAM)
- Unsubscribe link
- Company branding

| Email | Trigger | Purpose |
|-------|---------|---------|
| Welcome (paid) | `checkout.session.completed` | Onboarding + dashboard link |
| Welcome (free) | `/signup` POST | Setup instructions + download link |
| Magic Link | `/api/login` POST | Passwordless login |
| Payment Failed | `subscription.updated` (past_due) | Update payment method |
| Churn Prevention | `subscription.updated` (cancel_at_period_end) | Feedback + win-back |
| Downgrade | `subscription.deleted` | You're on free + COMEBACK20 code |
| Win-back | Scheduled (GHL workflow) | Re-engagement + promo code |
| Enterprise Inquiry | `/contact` POST | Notify admin |

## Unsubscribe Flow

CAN-SPAM requires a working unsubscribe in every commercial email:

```javascript
// Generate unique unsub token per email
async function getUnsubscribeUrl(email, env) {
  const token = crypto.randomUUID();
  await env.KV.put(`unsub:${token}`, email.toLowerCase().trim(), { expirationTtl: 365 * 86400 });
  return `https://checkout.yourdomain.com/unsubscribe?token=${token}`;
}

// GET /unsubscribe — show confirmation page
// POST /unsubscribe — process: add 'do-not-email' tag, remove campaign tags
```

## Pipeline Stages

Map subscription lifecycle to pipeline stages:

| Event | Stage | Tags Added | Tags Removed |
|-------|-------|------------|--------------|
| Free signup | Free Signup | `goldhold-free`, `lead` | — |
| Checkout complete | Trial | `goldhold-customer`, `goldhold-monthly`/`annual`, `active-subscriber` | — |
| Trial converts | Active | (auto via Stripe) | — |
| Payment failed | At Risk | `payment-failed`, `at-risk` | — |
| Cancel scheduled | Churn Risk | `churn-risk` | — |
| Subscription deleted | Churned | `goldhold-free`, `downgraded` | `active-subscriber`, `Pro`, `Annual` |
| Win-back | Win-back | `goldhold-winback` | — |
| Plan upgrade | Active | `goldhold-annual`, `plan-upgraded` | `goldhold-monthly` |
| Download | — | `downloaded`, `downloaded-PLATFORM` | — |
| Managed provisioned | — | `managed-memory`, `managed-provisioned` | — |
| Enterprise inquiry | — | `enterprise-inquiry` | — |

## Custom Field Keys

**Critical:** Keys are NOT the display names you see in GHL. Find them:
1. GHL → Settings → Custom Fields → Click field → Copy "Key"
2. Format: `contact.field_name` (e.g., `contact.subscription_plan`)
3. **Wrong key = silent data loss** (no error, data just gets dropped)

## Onboarding Campaign Tags

Schedule drip emails via GHL workflows triggered by tags:

```javascript
// Add at signup — GHL workflows fire on tag addition
await addGHLTags(contactId, [
  'onboarding-day3',    // "How's setup going?"
  'onboarding-day7',    // "Your agent's first week"
  'onboarding-day14',   // "Power user tips"
  'retention-day30',    // "One month milestone"
  'retention-day60',    // "Upgrade / refer a friend"
], env);
```

## Gotchas

| Issue | Fix |
|-------|-----|
| `Version` header missing → 404 | Always include `Version: 2021-07-28` |
| Custom field key wrong → silent fail | Verify keys in GHL Settings |
| PUT replaces ALL tags | Always GET existing, merge, then PUT |
| Duplicate contacts on re-signup | Search by email first (idempotency) |
| PIT tokens can expire | Monitor for 401s, refresh in GHL settings |
| `locationId` missing on create → error | Always include `locationId` in POST body |
| Bad email → 502 from GHL | Validate email format before API calls |
| Rate limits | GHL has undocumented rate limits — add delays for bulk ops |
| `Accept: application/json` missing | Some endpoints return HTML without it |
