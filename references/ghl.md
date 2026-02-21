# GoHighLevel (GHL) CRM Integration

## API Basics

Base URL: `https://services.leadconnectorhq.com`
Auth: `Authorization: Bearer <API_KEY>` + `Version: 2021-07-28`

## Create/Update Contact

```javascript
async function upsertGHLContact(email, firstName, plan, tags, env) {
  const existing = await findGHLContact(email, env);

  if (existing) {
    // Update existing contact — add tags
    await fetch(`https://services.leadconnectorhq.com/contacts/${existing.id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${env.GHL_API_KEY}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: JSON.stringify({
        tags: [...new Set([...(existing.tags || []), ...tags])],
        customFields: [
          { key: 'contact.subscription_plan', field_value: plan },
          { key: 'contact.subscription_start_date', field_value: new Date().toISOString().split('T')[0] },
        ],
      }),
    });
    return existing.id;
  }

  // Create new contact
  const res = await fetch('https://services.leadconnectorhq.com/contacts/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GHL_API_KEY}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    },
    body: JSON.stringify({
      locationId: env.GHL_LOCATION_ID,
      email: email.toLowerCase().trim(),
      firstName,
      tags,
      source: 'GoldHold Website',
      customFields: [
        { key: 'contact.subscription_plan', field_value: plan },
        { key: 'contact.subscription_start_date', field_value: new Date().toISOString().split('T')[0] },
      ],
    }),
  });
  const data = await res.json();
  return data.contact?.id;
}
```

## Find Contact by Email

```javascript
async function findGHLContact(email, env) {
  const res = await fetch(
    `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${env.GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
    {
      headers: {
        'Authorization': `Bearer ${env.GHL_API_KEY}`,
        'Version': '2021-07-28',
      },
    }
  );
  const data = await res.json();
  return data.contact || null;
}
```

## Pipeline Stages

Map subscription events to pipeline stages:

| Event | Stage | Tags |
|-------|-------|------|
| Free signup | Free Signup | `goldhold-free` |
| Checkout complete | Trial | `goldhold-monthly` or `goldhold-annual` |
| Trial converts | Active | `goldhold-active` |
| Subscription cancelled | Churned | `goldhold-churned` |
| Win-back coupon used | Win-back | `goldhold-winback` |

## Move Contact Through Pipeline

```javascript
async function moveToStage(contactId, stageId, pipelineId, env) {
  await fetch(`https://services.leadconnectorhq.com/opportunities/upsert`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GHL_API_KEY}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    },
    body: JSON.stringify({
      pipelineId,
      stageId,
      locationId: env.GHL_LOCATION_ID,
      contactId,
      name: 'GoldHold Subscription',
    }),
  });
}
```

## Transactional Email (via GHL)

GHL does NOT have a transactional email API. Workaround: use Cloudflare Worker + a sending provider (Resend, Mailgun, SES) or use the MailSend API with your own SMTP.

For simple use, send HTML email directly from the Worker using `fetch` to a mail API:

```javascript
async function sendEmail(to, subject, htmlBody, env) {
  // Using Resend as example
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `YourProduct <noreply@yourdomain.com>`,
      to,
      subject,
      html: htmlBody,
    }),
  });
  return { success: res.ok };
}
```

## Custom Field Keys

**Critical:** Custom field keys in GHL are NOT the display names. Find them:
1. GHL → Settings → Custom Fields → Click field → Copy "Key"
2. Key format: `contact.field_name` (e.g., `contact.subscription_plan`)
3. Using wrong keys = silent data loss (no error, just ignored)

## Gotchas

| Issue | Fix |
|-------|-----|
| `Version` header missing → 404 | Always include `Version: 2021-07-28` |
| Custom field key wrong → silent fail | Verify keys in GHL Settings |
| Duplicate contacts on re-signup | Search by email first (idempotency) |
| API tokens expire (PIT tokens) | Use Location API keys, not PIT tokens |
| No `List-Unsubscribe` header support | Handle unsubscribe in your own Worker |
