/**
 * Magic Link Token System (Cloudflare KV)
 *
 * Drop-in module for token-based auth without passwords.
 * Requires: KV namespace bound as `env.KV`
 *
 * Usage in worker:
 *   import { generateMagicToken, validateMagicToken } from './magic-links.js';
 */

const MAGIC_TTL = 30 * 24 * 60 * 60; // 30 days

export async function generateMagicToken(email, tier, env) {
  const token = crypto.randomUUID();
  const data = {
    email: email.toLowerCase().trim(),
    tier,
    created: new Date().toISOString(),
  };
  // Store token → data mapping
  await env.KV.put(`magic:${token}`, JSON.stringify(data), { expirationTtl: MAGIC_TTL });
  // Store email → token mapping (for lookup)
  await env.KV.put(`email:${email.toLowerCase().trim()}`, token, { expirationTtl: MAGIC_TTL });
  return token;
}

export async function validateMagicToken(token, env) {
  if (!token) return null;
  const raw = await env.KV.get(`magic:${token}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function getTokenByEmail(email, env) {
  if (!email) return null;
  return await env.KV.get(`email:${email.toLowerCase().trim()}`);
}

export async function revokeMagicToken(token, env) {
  const data = await validateMagicToken(token, env);
  if (data) {
    await env.KV.delete(`magic:${token}`);
    await env.KV.delete(`email:${data.email}`);
  }
}
