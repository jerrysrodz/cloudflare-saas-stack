# Managed Memory Proxy (Pinecone)

Server-side Pinecone proxy for managed users. The user never sees or handles a Pinecone API key — the Worker injects it server-side and enforces namespace isolation.

## Two User Types

| | BYOK | Managed |
|---|---|---|
| **Plans** | Free, Monthly | Annual, Enterprise |
| **Who holds the key** | User | Server (worker secret) |
| **Client auth** | `X-Pinecone-Key` header | `Authorization: Bearer <JWT>` |
| **Proxy route** | `/pinecone/host/<host>/<endpoint>` | `/v1/memory/<endpoint>` |
| **Namespace** | User-chosen | Server-enforced (email-derived) |

## Provisioning Flow

```
1. User on Annual plan clicks "Set Up Managed Data"
2. POST /v1/memory/provision (JWT in Authorization header)
3. Worker verifies JWT, checks Stripe for active annual/enterprise sub
4. Worker creates namespace in shared Pinecone index (upserts bootstrap vector)
5. Worker stores provisioning record in KV: managed:<email> → { host, index, namespace }
6. Returns { host, index, namespace, managed: true } — NO key
7. Client stores host + managed flag in localStorage
8. All future API calls route through /v1/memory/* with JWT auth
```

## Namespace Isolation

Namespace = sanitized email: `user@example.com` → `user_example_com`

```javascript
const namespace = email.replace(/[@.]/g, '_');
```

**Critical:** The server ALWAYS overrides the namespace from the JWT-verified email. Never trust a client-supplied namespace.

## API Endpoints

All endpoints require `Authorization: Bearer <JWT>` header.

### GET /v1/memory/stats

Returns index stats filtered to the user's namespace, in `describe_index_stats` format:

```json
{
  "namespaces": { "user_example_com": { "vectorCount": 1234 } },
  "totalVectorCount": 1234,
  "dimension": 1024
}
```

### POST /v1/memory/query

Vector similarity query. Server forces `namespace` to user's provisioned namespace.

```json
{
  "vector": [0.1, 0.2, ...],
  "topK": 10,
  "includeMetadata": true
}
```

### POST /v1/memory/search

Text-based search with integrated embedding. Server embeds the query, then queries Pinecone.

```json
{ "query": "search text", "topK": 10 }
```

### POST /v1/memory/upsert

Upsert vectors. Server forces namespace.

```json
{
  "vectors": [
    { "id": "vec-1", "values": [...], "metadata": { "text": "..." } }
  ]
}
```

### GET /v1/memory/list?limit=20&paginationToken=...

List vector IDs. Server injects namespace. Returns Pinecone list format.

### POST /v1/memory/fetch

Fetch vectors by ID.

```json
{ "ids": ["vec-1", "vec-2"] }
```

### POST /v1/memory/embed

Generate embeddings via Pinecone Inference API.

```json
{
  "model": "multilingual-e5-large",
  "inputs": [{ "text": "text to embed" }],
  "parameters": { "input_type": "query" }
}
```

## Bootstrap Vector

When provisioning, upsert a bootstrap vector to create the namespace:

```javascript
const bootstrapRes = await fetch(`https://${managedHost}/vectors/upsert`, {
  method: 'POST',
  headers: { 'Api-Key': managedKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    namespace,
    vectors: [{
      id: 'bootstrap',
      values: new Array(1024).fill(0), // multilingual-e5-large = 1024d
      metadata: {
        type: 'bootstrap',
        email,
        provisioned: new Date().toISOString(),
        text: `Managed memory namespace for ${email}. Provisioned ${new Date().toISOString()}.`,
      },
    }],
  }),
});
```

## BYOK Proxy (for reference)

BYOK users send their Pinecone key in `X-Pinecone-Key` header:

```javascript
// /pinecone/indexes — list indexes
// /pinecone/embed — generate embeddings
// /pinecone/host/<host>/<endpoint> — proxy to specific Pinecone host

if (url.pathname.startsWith('/pinecone/')) {
  const pineconeKey = request.headers.get('X-Pinecone-Key');
  if (!pineconeKey) return new Response('Missing Pinecone key', { status: 401 });

  const subpath = url.pathname.replace('/pinecone/', '');

  if (subpath === 'indexes') {
    return fetch('https://api.pinecone.io/indexes', {
      headers: { 'Api-Key': pineconeKey },
    });
  }

  if (subpath.startsWith('host/')) {
    const rest = subpath.replace('host/', '');
    const slashIdx = rest.indexOf('/');
    const host = rest.substring(0, slashIdx);
    const endpoint = rest.substring(slashIdx);
    return fetch(`https://${host}${endpoint}`, {
      method: request.method,
      headers: { 'Api-Key': pineconeKey, 'Content-Type': 'application/json' },
      body: request.method !== 'GET' ? request.body : undefined,
    });
  }
}
```

## Client-Side Routing

The frontend uses a single `pcHostFetch` function that routes to the correct proxy based on `isManagedMemory`:

```javascript
const isManagedMemory = localStorage.getItem('goldhold_managed_memory') === 'true';

function pcHostFetch(endpoint, opts = {}) {
  if (isManagedMemory) {
    // Map Pinecone endpoints to managed proxy
    if (endpoint === '/describe_index_stats') return pcFetch('/stats', { method: 'GET' });
    if (endpoint.startsWith('/query')) return pcFetch('/query', opts);
    if (endpoint.startsWith('/vectors/upsert')) return pcFetch('/upsert', opts);
    if (endpoint.startsWith('/vectors/list')) {
      const qs = endpoint.includes('?') ? endpoint.split('?')[1] : '';
      return pcFetch('/list?' + qs, { method: 'GET' });
    }
    if (endpoint.startsWith('/vectors/fetch')) {
      const qs = new URLSearchParams(endpoint.split('?')[1] || '');
      const ids = qs.getAll('ids');
      return pcFetch('/fetch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    }
    return pcFetch(endpoint, opts);
  }
  // BYOK: direct proxy
  return pcFetch('/host/' + pineconeHost + endpoint, opts);
}

function pcFetch(path, opts = {}) {
  if (isManagedMemory) {
    const token = localStorage.getItem('goldhold_token');
    return fetch(MANAGED_PROXY + path, { ...opts, headers: { ...opts.headers, 'Authorization': 'Bearer ' + token } });
  }
  return fetch(PC_PROXY + path, { ...opts, headers: { ...opts.headers, 'X-Pinecone-Key': pineconeApiKey } });
}
```

## Worker Secrets Required

```powershell
npx wrangler secret put MANAGED_PINECONE_KEY     # Pinecone API key (server-side only)
```

Environment variables in `wrangler.toml`:

```toml
[vars]
MANAGED_PINECONE_HOST = "your-index-abc123.svc.pinecone.io"
MANAGED_PINECONE_INDEX = "your-managed-index"
```

## KV Records

| Key | Value | Purpose |
|-----|-------|---------|
| `managed:<email>` | `{ email, host, index, namespace, plan, provisioned }` | Provisioning record |

## Security

- Pinecone key NEVER leaves the server
- Namespace is ALWAYS derived from verified JWT email
- Plan is verified against live Stripe subscription (not cached)
- Idempotent: re-provisioning returns existing record
- GHL tagged `managed-memory` + `managed-provisioned` on provision
