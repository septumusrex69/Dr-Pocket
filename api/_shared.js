// Shared by /api/explain and /api/ask. Files starting with "_" are not endpoints on Vercel.
import Anthropic from '@anthropic-ai/sdk';
import { STRUCTURES } from './_vocab.js';

export { Anthropic, STRUCTURES };
export const MODEL = 'claude-opus-5-5';
export const client = new Anthropic();
export const KNOWN = new Set(STRUCTURES);

// Best-effort limit per visitor and kind of request. Each server instance keeps its own count,
// so the real cap on cost is the monthly spend limit set in the Anthropic Console.
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map();
export function allowed(req, kind, limit) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) return false;
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}

/* Ask Claude for JSON matching the schema. Streams, so long reports never hit a request timeout.
   Thrown errors are the SDK's typed errors; a refusal or cut-off answer comes back as { stop }. */
export async function askForJson({ system, content, schema, effort, maxTokens = 32000 }) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') return { stop: msg.stop_reason };
  const out = msg.content.find((b) => b.type === 'text');
  return { stop: msg.stop_reason, data: JSON.parse(out?.text || '') };
}

// Keep only structure names the 3D model has.
export const onlyKnown = (list) => (list || []).filter((s) => KNOWN.has(s));

export function apiError(res, err) {
  if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'Dr Pocket is busy right now. Try again in a minute.' });
  if (err instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'Dr Pocket is not set up correctly (API key).' });
  if (err instanceof Anthropic.BadRequestError) return res.status(400).json({ error: 'That could not be read. Try a clearer photo or paste the text.' });
  if (err instanceof SyntaxError) return res.status(502).json({ error: 'Something went wrong reading the answer. Please try again.' });
  return res.status(502).json({ error: 'Something went wrong. Please try again.' });
}
