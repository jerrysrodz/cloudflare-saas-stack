# JWT Auth (No Dependencies)

Pure `crypto.subtle` JWT implementation — no npm packages, runs natively on Cloudflare Workers.

## Sign Token

```javascript
async function signToken(payload, secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const unsigned = `${header}.${body}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return `${unsigned}.${signature}`;
}
```

## Verify Token

```javascript
async function verifyToken(token, secret) {
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;

    const unsigned = `${header}.${body}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = Uint8Array.from(
      atob(signature.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(unsigned));
    if (!valid) return null;

    // Pad body for base64 decoding
    const payload = JSON.parse(atob(body + '='.repeat((4 - body.length % 4) % 4)));

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}
```

## JWT Payload Structure

```javascript
const payload = {
  email: 'user@example.com',
  provider: 'github',       // or 'google'
  github: 'username',       // GitHub login (if GitHub OAuth)
  name: 'User Name',        // Display name
  avatar: 'https://...',    // Avatar URL
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days
};
```

## Auth Flow (OAuth → JWT → Client)

```
1. User clicks "Sign in with GitHub/Google"
2. Worker redirects to OAuth provider
3. Provider redirects back with code
4. Worker exchanges code for access token (server-side!)
5. Worker fetches user profile + email
6. Worker signs JWT with email, provider, name
7. Worker redirects to /account?jwt=<token>
8. Client stores JWT in localStorage
9. All subsequent API calls send: Authorization: Bearer <jwt>
```

## Verify Endpoint

The `/auth/verify` endpoint validates a JWT and returns full account status:

```javascript
if (url.pathname === '/auth/verify' && request.method === 'POST') {
  const { token } = await request.json();
  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });

  // Look up Stripe subscription, plan, etc.
  const accountData = await getAccountStatus(payload.email, env);
  return new Response(JSON.stringify({
    email: payload.email,
    provider: payload.provider,
    name: payload.name,
    avatar: payload.avatar,
    ...accountData,
  }));
}
```

## Security Notes

- `JWT_SECRET` must be a strong random string (32+ chars). Set via `wrangler secret put JWT_SECRET`
- Never expose the secret client-side
- Always verify server-side before trusting any JWT claim
- Token expiration is checked on every `verifyToken` call
- Base64url encoding (not standard base64) for URL safety
