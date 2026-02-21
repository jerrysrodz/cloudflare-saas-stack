# GitHub OAuth Flow

## Overview

```
User clicks "Sign in with GitHub"
  → Redirect to github.com/login/oauth/authorize
  → User authorizes
  → GitHub redirects to /auth/callback?code=XXX
  → Worker exchanges code for access token
  → Worker fetches user profile
  → Creates magic link token in KV
  → Redirects to /account?token=XXX
```

## GitHub OAuth App Setup

1. GitHub → Settings → Developer Settings → OAuth Apps → New
2. App name: YourProduct
3. Homepage: `https://yourdomain.com`
4. Callback: `https://checkout.yourdomain.com/auth/callback`
5. Copy Client ID → `wrangler.toml` env var
6. Generate Client Secret → `wrangler secret put GITHUB_CLIENT_SECRET`

## Worker Implementation

```javascript
// GET /auth/github — redirect to GitHub
if (url.pathname === '/auth/github') {
  const ghUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(env.GITHUB_CALLBACK_URL)}&scope=read:user,user:email`;
  return Response.redirect(ghUrl, 302);
}

// GET /auth/callback — exchange code for token
if (url.pathname === '/auth/callback') {
  const code = url.searchParams.get('code');
  if (!code) return new Response('Missing code', { status: 400 });

  // Exchange code for access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) return new Response(tokenData.error_description, { status: 400 });

  // Fetch user profile
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'User-Agent': 'YourProduct',
    },
  });
  const user = await userRes.json();

  // Fetch email (may be private)
  const emailRes = await fetch('https://api.github.com/user/emails', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'User-Agent': 'YourProduct',
    },
  });
  const emails = await emailRes.json();
  const primaryEmail = emails.find(e => e.primary)?.email || user.email;

  // Create magic link token in KV
  const token = crypto.randomUUID();
  await env.KV.put(`magic:${token}`, JSON.stringify({
    email: primaryEmail,
    github: user.login,
    tier: 'github-pending',  // Mark for activation
    created: new Date().toISOString(),
  }), { expirationTtl: 30 * 24 * 60 * 60 });

  // Redirect to account page with token (not email!)
  return Response.redirect(`https://yourdomain.com/account?token=${token}`, 302);
}
```

## Activation Pipeline

After OAuth, users need a `GITHUB_TOKEN` (PAT) set as a worker secret to auto-activate:

1. User logs in via GitHub OAuth
2. Worker tags contact as `github-pending` in GHL
3. Background process (or admin) activates: generates install token, updates tag to `github-active`
4. User gets welcome email with setup instructions

**Without `GITHUB_TOKEN`**: users queue indefinitely with `github-pending` tag.

## Security Notes

- Never pass email in redirect URLs — use token/session_id
- Exchange code server-side (Worker), never client-side
- Store tokens in KV with TTL (30 days default)
- Scope to minimum needed (`read:user,user:email`)
