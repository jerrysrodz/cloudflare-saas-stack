# OAuth Flows (GitHub + Google)

## Overview

Both providers follow the same pattern: redirect → callback → JWT → client.

```
User clicks "Sign in with GitHub/Google"
  → Redirect to provider's authorize URL
  → User authorizes
  → Provider redirects to /auth/callback (or /auth/google/callback)
  → Worker exchanges code for access token (server-side!)
  → Worker fetches user profile + email
  → Worker signs JWT with { email, provider, name, avatar }
  → Redirects to /account?jwt=<token>
  → Client stores JWT in localStorage
```

## GitHub OAuth

### Setup
1. GitHub → Settings → Developer Settings → OAuth Apps → New
2. Callback: `https://checkout.yourdomain.com/auth/callback`
3. Copy Client ID → `wrangler.toml`
4. Client Secret → `wrangler secret put GITHUB_CLIENT_SECRET`

### Worker Implementation

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
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) return Response.redirect('https://yourdomain.com/account?error=auth_failed', 302);

  // Fetch user profile
  const userRes = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'User-Agent': 'YourProduct' },
  });
  const user = await userRes.json();

  // Fetch email (may be private)
  const emailRes = await fetch('https://api.github.com/user/emails', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'User-Agent': 'YourProduct' },
  });
  const emails = await emailRes.json();
  const primaryEmail = emails.find(e => e.primary)?.email || user.email;

  // Sign JWT
  const payload = {
    email: primaryEmail,
    provider: 'github',
    github: user.login,
    name: user.name || user.login,
    avatar: user.avatar_url,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
  };
  const token = await signToken(payload, env.JWT_SECRET);
  return Response.redirect(`https://yourdomain.com/account?jwt=${encodeURIComponent(token)}`, 302);
}
```

## Google OAuth

### Setup
1. Google Cloud Console → APIs & Services → Credentials → Create OAuth Client ID
2. Type: Web application
3. Authorized redirect URIs: `https://checkout.yourdomain.com/auth/google/callback`
4. Copy Client ID → `wrangler.toml` as `GOOGLE_CLIENT_ID`
5. Client Secret → `wrangler secret put GOOGLE_CLIENT_SECRET`

### Worker Implementation

```javascript
// GET /auth/google — redirect to Google
if (url.pathname === '/auth/google') {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

// GET /auth/google/callback — exchange code for token
if (url.pathname === '/auth/google/callback') {
  const code = url.searchParams.get('code');
  if (!code) return Response.redirect('https://yourdomain.com/account?error=google_no_code', 302);

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_CALLBACK_URL,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return Response.redirect('https://yourdomain.com/account?error=google_token_failed', 302);

  // Fetch user info
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
  });
  const user = await userRes.json();
  if (!user.email) return Response.redirect('https://yourdomain.com/account?error=google_no_email', 302);

  // Sign JWT
  const payload = {
    email: user.email.toLowerCase().trim(),
    provider: 'google',
    name: user.name || user.email.split('@')[0],
    avatar: user.picture || '',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
  };
  const token = await signToken(payload, env.JWT_SECRET);
  return Response.redirect(`https://yourdomain.com/account?jwt=${encodeURIComponent(token)}`, 302);
}
```

## Client-Side JWT Handling

```javascript
// On page load: check for JWT in URL, store it
const params = new URLSearchParams(window.location.search);
const jwt = params.get('jwt');
if (jwt) {
  localStorage.setItem('goldhold_token', jwt);
  // Clean URL
  window.history.replaceState({}, '', '/account');
}

// On every authenticated request
const token = localStorage.getItem('goldhold_token');
fetch('/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token }),
});
```

## Security Notes

- Exchange codes server-side (Worker), never client-side
- Google requires `openid` in scope to get email
- GitHub may have private email — fetch `/user/emails` endpoint
- Never pass email in redirect URLs — use JWT token
- JWTs expire in 30 days — re-auth after expiry
- `prompt: 'select_account'` lets users pick which Google account (important for multi-account users)
