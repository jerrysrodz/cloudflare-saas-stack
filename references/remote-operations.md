# Remote Operations Guide

How to control GitHub, Cloudflare, Stripe, GHL, and Google from the command line / Workers — without touching a dashboard.

## GitHub (via `gh` CLI)

### Repo Management
```powershell
# Create repo
gh repo create owner/repo-name --public --clone

# Clone
gh repo clone owner/repo-name

# Push changes
git add -A; git commit -m "message"; git push

# Create release
gh release create v1.0.0 --title "v1.0.0" --notes "Release notes"

# Upload release asset (downloadable file)
gh release upload v1.0.0 ./dist/product.zip

# View repo
gh repo view owner/repo-name --web
```

### GitHub OAuth App Management
```powershell
# Create OAuth App (still needs dashboard, but configure callback programmatically)
# Callback URL: https://checkout.yourdomain.com/auth/callback
# Client ID → wrangler.toml
# Client Secret → wrangler secret put GITHUB_CLIENT_SECRET
```

### Automated File Operations
```powershell
# Read file from repo without cloning
gh api repos/owner/repo/contents/path/to/file | python -c "import json,sys,base64; print(base64.b64decode(json.load(sys.stdin)['content']).decode())"

# Create/update file via API
gh api repos/owner/repo/contents/path/to/file -X PUT -f message="Update" -f content="$(base64 -w0 file.txt)" -f sha="$(gh api repos/owner/repo/contents/path/to/file --jq .sha)"
```

## Cloudflare (via `wrangler` CLI)

### Pages
```powershell
# Deploy site
npx wrangler pages deploy ./site --project-name=my-project --commit-dirty=true

# List deployments
npx wrangler pages deployment list --project-name=my-project

# Create project (first deploy auto-creates, or:)
npx wrangler pages project create my-project --production-branch=main
```

### Workers
```powershell
# Deploy worker
cd worker && npx wrangler deploy

# Set secret (interactive prompt)
npx wrangler secret put SECRET_NAME

# Set secret (non-interactive)
echo "secret-value" | npx wrangler secret put SECRET_NAME

# List secrets
npx wrangler secret list

# Delete secret
npx wrangler secret delete SECRET_NAME

# Live logs
npx wrangler tail

# Local dev with secrets
npx wrangler dev
```

### KV Operations
```powershell
# Create namespace
npx wrangler kv namespace create KV

# List namespaces
npx wrangler kv namespace list

# Read a key
npx wrangler kv key get --namespace-id=abc123 "key-name"

# Write a key
npx wrangler kv key put --namespace-id=abc123 "key-name" "value"

# Delete a key
npx wrangler kv key delete --namespace-id=abc123 "key-name"

# List keys
npx wrangler kv key list --namespace-id=abc123 --prefix="serial:"
```

### DNS (via Cloudflare API or dashboard)
```powershell
# Add DNS record via API
curl -X POST "https://api.cloudflare.com/client/v4/zones/ZONE_ID/dns_records" \
  -H "Authorization: Bearer CF_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"AAAA","name":"checkout","content":"100::","proxied":true}'
```

## Stripe (via `stripe` CLI + API)

### CLI Setup
```powershell
stripe login
```

### Products & Prices
```powershell
# List products
stripe products list --limit=5

# Create product
stripe products create --name="My Product" --description="..."

# Create price (recurring)
stripe prices create --unit-amount=900 --currency=usd --recurring[interval]=month --product=prod_XXX --nickname="Monthly"

# Create price ($0 free tier)
stripe prices create --unit-amount=0 --currency=usd --recurring[interval]=month --product=prod_XXX --nickname="Free Tier"

# Update price nickname
stripe prices update price_XXX --nickname="New Name"
```

### Coupons & Promo Codes
```powershell
# 20% off forever
stripe coupons create --percent-off=20 --duration=forever --id=COMEBACK20
stripe promotion_codes create --coupon=COMEBACK20 --code=COMEBACK20

# 100% off (dev/testing)
stripe coupons create --percent-off=100 --duration=forever --id=DEV-FREE
stripe promotion_codes create --coupon=DEV-FREE --code=DEV-FREE
```

### Customer Operations (via Worker)
```javascript
// Find customer by email
const res = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`, {
  headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
});

// Search by metadata
const res = await fetch(`https://api.stripe.com/v1/customers/search?query=metadata['github_username']:'${username}'`, {
  headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
});

// Get subscriptions
const res = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=active&limit=1`, {
  headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
});

// Update subscription (plan change)
const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    'items[0][id]': itemId,
    'items[0][price]': newPriceId,
    'proration_behavior': 'create_prorations',
    'metadata[plan]': newPlan,
  }).toString(),
});

// Cancel subscription
const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
});
```

### Webhooks
```powershell
# List webhooks
stripe webhook_endpoints list

# Create webhook
stripe webhook_endpoints create --url=https://checkout.yourdomain.com/webhook --events checkout.session.completed,customer.subscription.updated,customer.subscription.deleted,invoice.payment_failed

# Listen locally (dev)
stripe listen --forward-to localhost:8787/webhook
```

## GoHighLevel (via Worker API calls)

GHL has no CLI. All operations are via REST API from your Worker.

### Contact CRUD
```javascript
// Search
GET /contacts/search/duplicate?locationId=XXX&email=user@example.com
Headers: Authorization: Bearer TOKEN, Version: 2021-07-28

// Create
POST /contacts/
Body: { locationId, email, firstName, lastName, tags, source, customFields }

// Update
PUT /contacts/{id}
Body: { tags, customFields }

// Get
GET /contacts/{id}
```

### Send Email
```javascript
POST /conversations/messages
Body: { type: 'Email', contactId, subject, html, emailFrom: 'Name <noreply@domain.com>' }
```

### Add Note
```javascript
POST /contacts/{id}/notes
Body: { body: 'Note text' }
```

### Tags (critical pattern)
```javascript
// GHL replaces ALL tags on PUT — you MUST merge
const existing = (await getContact(id)).tags || [];
const merged = [...new Set([...existing, ...newTags])];
await updateContact(id, { tags: merged });
```

## Google OAuth (setup + runtime)

### Setup (one-time, via Google Cloud Console)
1. APIs & Services → Credentials → Create OAuth Client ID
2. Type: Web application
3. Authorized redirect URIs: `https://checkout.yourdomain.com/auth/google/callback`
4. Copy Client ID → `wrangler.toml` as `GOOGLE_CLIENT_ID`
5. Client Secret → `wrangler secret put GOOGLE_CLIENT_SECRET`

### Runtime (Worker handles everything)
```javascript
// Redirect to Google
const params = new URLSearchParams({
  client_id: env.GOOGLE_CLIENT_ID,
  redirect_uri: env.GOOGLE_CALLBACK_URL,
  response_type: 'code',
  scope: 'openid email profile',  // MUST include openid for email
  access_type: 'online',
  prompt: 'select_account',       // Let user pick account
});
Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);

// Exchange code
POST https://oauth2.googleapis.com/token
Body: { code, client_id, client_secret, redirect_uri, grant_type: 'authorization_code' }

// Get user info from ID token (no extra API call needed)
const parts = tokenData.id_token.split('.');
const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
// payload.email, payload.name, payload.picture
```

**Key insight:** Google returns an ID token — decode it directly instead of making a separate `/userinfo` API call. Faster and one fewer network round trip.

## Pinecone (via Worker proxy)

### BYOK (user's key)
```javascript
// List indexes
GET https://api.pinecone.io/indexes
Headers: Api-Key: USER_KEY

// Proxy pattern: /pinecone/host/<host>/<endpoint>
GET/POST https://<host>/<endpoint>
Headers: Api-Key: USER_KEY
```

### Managed (server key)
```javascript
// Create namespace (upsert bootstrap vector)
POST https://<host>/vectors/upsert
Body: { namespace: "user_email_com", vectors: [{ id: "bootstrap", values: [...], metadata: {...} }] }

// Query with forced namespace
POST https://<host>/query
Body: { vector: [...], topK: 10, namespace: "user_email_com", includeMetadata: true }

// Embed text
POST https://api.pinecone.io/embed
Body: { model: "multilingual-e5-large", inputs: [{ text: "..." }], parameters: { input_type: "query" } }
```

## Deployment Checklist

```powershell
# 1. Deploy worker
cd worker && npx wrangler deploy

# 2. Deploy site
cd site && npx wrangler pages deploy . --project-name=my-project --commit-dirty=true

# 3. Verify
curl https://checkout.yourdomain.com/health
curl -s https://yourdomain.com | head -5

# 4. Test webhook (dev)
stripe listen --forward-to localhost:8787/webhook
stripe trigger checkout.session.completed
```
