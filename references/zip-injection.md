# ZIP Injection & Download Tracking

## Overview

Dynamically inject files into ZIP archives at the edge. Used for license files, config injection, and serial number tracking — all without pre-building multiple ZIP variants.

## ZIP Injection Function

Pure JavaScript ZIP manipulation — no libraries. Works on Cloudflare Workers.

```javascript
function injectFileIntoZip(zipBytes, fileName, fileContent) {
  const fileData = new TextEncoder().encode(fileContent);
  const fileNameBytes = new TextEncoder().encode(fileName);
  const fileCrc = crc32(fileData);

  // Find End of Central Directory (EOCD)
  let eocdOffset = -1;
  for (let i = zipBytes.length - 22; i >= 0; i--) {
    if (zipBytes[i] === 0x50 && zipBytes[i+1] === 0x4b &&
        zipBytes[i+2] === 0x05 && zipBytes[i+3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Not a valid ZIP');

  const eocdView = new DataView(zipBytes.buffer, eocdOffset);
  const cdEntries = eocdView.getUint16(10, true);
  const cdSize = eocdView.getUint32(12, true);
  const cdOffset = eocdView.getUint32(16, true);

  // New file goes at the current CD offset (after all existing local file entries)
  const newFileOffset = cdOffset;

  // Build Local File Header (30 bytes + filename)
  const lfh = new Uint8Array(30 + fileNameBytes.length);
  const lfhView = new DataView(lfh.buffer);
  lfhView.setUint32(0, 0x04034b50, true);   // signature
  lfhView.setUint16(4, 20, true);            // version needed
  lfhView.setUint16(8, 0, true);             // compression: stored
  lfhView.setUint32(14, fileCrc, true);       // CRC-32
  lfhView.setUint32(18, fileData.length, true); // compressed size
  lfhView.setUint32(22, fileData.length, true); // uncompressed size
  lfhView.setUint16(26, fileNameBytes.length, true);
  lfh.set(fileNameBytes, 30);

  // Build Central Directory entry (46 bytes + filename)
  const cdEntry = new Uint8Array(46 + fileNameBytes.length);
  const cdView = new DataView(cdEntry.buffer);
  cdView.setUint32(0, 0x02014b50, true);     // signature
  cdView.setUint16(4, 20, true);              // version made by
  cdView.setUint16(6, 20, true);              // version needed
  cdView.setUint16(14, 0, true);              // compression: stored
  cdView.setUint32(16, fileCrc, true);
  cdView.setUint32(20, fileData.length, true);
  cdView.setUint32(24, fileData.length, true);
  cdView.setUint16(28, fileNameBytes.length, true);
  cdView.setUint32(38, 0x20, true);           // external attrs (archive)
  cdView.setUint32(42, newFileOffset, true);   // local header offset
  cdEntry.set(fileNameBytes, 46);

  // Extract existing Central Directory
  const existingCd = zipBytes.slice(cdOffset, cdOffset + cdSize);

  // Build new EOCD
  const newEocd = new Uint8Array(22);
  const eoView = new DataView(newEocd.buffer);
  const newCdOffset = newFileOffset + lfh.length + fileData.length;
  const newCdSize = cdSize + cdEntry.length;
  eoView.setUint32(0, 0x06054b50, true);
  eoView.setUint16(8, cdEntries + 1, true);
  eoView.setUint16(10, cdEntries + 1, true);
  eoView.setUint32(12, newCdSize, true);
  eoView.setUint32(16, newCdOffset, true);

  // Assemble final ZIP
  const beforeCd = zipBytes.slice(0, cdOffset);
  const totalSize = beforeCd.length + lfh.length + fileData.length + existingCd.length + cdEntry.length + newEocd.length;
  const result = new Uint8Array(totalSize);
  let offset = 0;
  result.set(beforeCd, offset); offset += beforeCd.length;
  result.set(lfh, offset); offset += lfh.length;
  result.set(fileData, offset); offset += fileData.length;
  result.set(existingCd, offset); offset += existingCd.length;
  result.set(cdEntry, offset); offset += cdEntry.length;
  result.set(newEocd, offset);
  return result;
}
```

## CRC32 (Required for ZIP)

```javascript
const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
```

## Serial Number Generation

```javascript
const platform = file.replace('product-', '').toUpperCase();
const ts = Date.now().toString(36).toUpperCase();
const rand = crypto.getRandomValues(new Uint8Array(4));
const hex = Array.from(rand).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
const serial = `GH-${platform}-${ts}-${hex}`;
```

Format: `GH-MCP-M5ABC123-1A2B3C4D`

## Download Endpoint Pattern

```javascript
if (url.pathname === '/download' && request.method === 'GET') {
  const file = url.searchParams.get('file');
  const validFiles = ['product-mcp', 'product-openai', 'product-all'];
  if (!file || !validFiles.includes(file)) return error(400, 'Invalid file');

  // Auth required
  const token = getToken(request); // JWT from header or query
  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) return error(401, 'Login required');

  // Generate serial
  const serial = generateSerial(file);

  // Store in KV
  await env.KV.put(`serial:${serial}`, JSON.stringify({
    serial, file, email: payload.email, ts: new Date().toISOString(),
    ip: request.headers.get('cf-connecting-ip'), active: true,
  }), { expirationTtl: 10 * 365 * 86400 });

  // Index by customer
  const existing = await env.KV.get(`serials:${payload.email}`, 'json') || [];
  existing.push({ serial, file, ts: new Date().toISOString() });
  await env.KV.put(`serials:${payload.email}`, JSON.stringify(existing));

  // Track download count
  const countKey = `download_count:${file}`;
  const count = parseInt(await env.KV.get(countKey) || '0') + 1;
  await env.KV.put(countKey, count.toString());

  // Tag in CRM
  const contactId = await findGHLContact(payload.email, env);
  if (contactId) {
    await addGHLTags(contactId, ['downloaded', `downloaded-${platform}`], env);
    await addNote(contactId, `📦 Download: ${file}\nSerial: ${serial}`, env);
  }

  // Fetch base ZIP and inject license
  const zipRes = await fetch(`https://yourdomain.com/downloads/${file}.zip`);
  const originalZip = new Uint8Array(await zipRes.arrayBuffer());

  const licenseText = [
    '═══════════════════════════════════',
    '  LICENSE - DO NOT DELETE',
    '═══════════════════════════════════',
    '',
    `  Serial:      ${serial}`,
    `  Licensed to: ${payload.email}`,
    `  Package:     ${file}`,
    `  Downloaded:  ${new Date().toISOString()}`,
    '',
    '  Verify: https://checkout.yourdomain.com/serial/' + serial,
    '',
  ].join('\n');

  const modifiedZip = injectFileIntoZip(originalZip, 'LICENSE', licenseText);

  return new Response(modifiedZip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${file}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
```

## Serial Verification Endpoint

```javascript
// GET /serial/:id — public verification
if (url.pathname.startsWith('/serial/')) {
  const serial = url.pathname.split('/serial/')[1];
  const record = await env.KV.get(`serial:${serial}`, 'json');
  if (!record) return error(404, 'Serial not found');
  return json({ valid: true, serial: record });
}
```

## KV Records Created

| Key Pattern | Value | TTL |
|-------------|-------|-----|
| `serial:<serial>` | `{ serial, file, email, ts, ip, active }` | 10 years |
| `serials:<email>` | `[{ serial, file, ts }]` | 10 years |
| `download_count:<file>` | count (string) | None |
| `serial_log` | `[{ serial, email, file, ts }]` | None |

## Why This Matters

- **License tracking** — every download has a unique serial tied to a user
- **Piracy detection** — if a serial shows up in the wild, you know who leaked it
- **Analytics** — download counts per package, per user
- **CRM integration** — automatically tags users who downloaded + logs serial to their profile
- **Zero pre-building** — one base ZIP, dynamically customized at download time
