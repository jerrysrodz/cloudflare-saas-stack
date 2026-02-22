# Magic Link Auth (Passwordless Login)

## Overview

Token-based passwordless authentication via email. User clicks a link → lands on the dashboard with a pre-authenticated session. No passwords, no sessions to manage.

## KV Token System

```javascript
const MAGIC_TTL = 30 * 24 * 60 * 60; // 30 days

async function generateMagicToken(email, tier, env) {
  const token = crypto.randomUUID();
  const data = { email: email.toLowerCase().trim(), tier, created: new Date().toISOString() };
  await env.KV.put(`magic:${token}`, JSON.stringify(data), { expirationTtl: MAGIC_TTL });
  await env.KV.put(`email:${email.toLowerCase().trim()}`, token, { expirationTtl: MAGIC_TTL });
  return token;
}

async function verifyMagicToken(token, env) {
  if (!token) return null;
  const raw = await env.KV.get(`magic:${token}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
```

## Login Flow

```
1. User enters email on login page
2. POST /api/login { email }
3. Worker finds/creates GHL contact
4. Worker generates magic token
5. Worker sends email via GHL with link: /account?token=<uuid>
6. User clicks link
7. Account page verifies token via GET /api/auth?token=<uuid>
8. Token returns { email, tier } — page renders dashboard
```

## Dual Auth: Magic Links + OAuth JWT

The account page supports BOTH auth methods:

```javascript
// On page load
const params = new URLSearchParams(window.location.search);

// Check for JWT first (OAuth flow)
const jwt = params.get('jwt');
if (jwt) {
  localStorage.setItem('goldhold_token', jwt);
  // Verify via /auth/verify
}

// Check for magic token (email flow)
const magicToken = params.get('token');
if (magicToken) {
  localStorage.setItem('goldhold_magic_token', magicToken);
  // Verify via /api/auth?token=xxx
}
```

## Request Magic Link Endpoint

```javascript
if (url.pathname === '/api/login' && request.method === 'POST') {
  const { email } = await request.json();
  if (!email || !isValidEmail(email)) return error(400, 'Valid email required');

  const normalizedEmail = email.toLowerCase().trim();

  // Find or create contact in GHL
  let contactId = await findGHLContact(normalizedEmail, env);
  if (!contactId) {
    // Auto-create — they're signing up by requesting a magic link
    contactId = await createGHLContact(normalizedEmail, env, ['goldhold-free', 'lead', 'magic-link-signup']);
  }
  if (!contactId) {
    // Don't leak whether the email exists
    return json({ sent: true });
  }

  // Determine tier from GHL tags
  let tier = 'Lite';
  const tags = await getGHLTags(contactId, env);
  if (tags.includes('goldhold-annual')) tier = 'Annual';
  else if (tags.includes('goldhold-monthly')) tier = 'Pro';

  const token = await generateMagicToken(normalizedEmail, tier, env);
  await sendMagicLinkEmail(contactId, normalizedEmail, token, env);

  // Always return success (don't reveal if email exists)
  return json({ sent: true });
}
```

## Security Notes

- Token is a `crypto.randomUUID()` — 128 bits of randomness
- KV TTL auto-expires tokens after 30 days
- Response always returns `{ sent: true }` — never reveals if email exists
- Magic tokens are separate from JWT tokens — different auth paths
- Both can coexist: magic token for email users, JWT for OAuth users

## When to Use Each

| Auth Method | Use Case |
|-------------|----------|
| Magic Link | Users who signed up via email, free tier, returning customers |
| GitHub OAuth | Developers, GitHub-integrated products |
| Google OAuth | General users, business accounts |
| JWT (from OAuth) | Stored in localStorage, sent as Bearer token, 7-day expiry |
| Magic Token | Stored in localStorage, verified via KV lookup, 30-day expiry |
