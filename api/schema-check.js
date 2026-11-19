// TEMPORARY diagnostic (19 Nov): sends the report schema with a one-line fake journal and returns Anthropic's
// exact error, to find why report creation gets a 400. Preview deployments only; remove after the fix.
import { client, MODEL } from './_shared.js';
import { SCHEMA, SYSTEM } from './progress.js';

async function attempt(label, schema, { fallbacks = true } = {}) {
  try {
    const params = { model: MODEL, max_tokens: 3000, system: [{ type: 'text', text: SYSTEM }], output_config: { effort: 'low', format: { type: 'json_schema', schema } }, messages: [{ role: 'user', content: '<journal><entries count="1">E1 [18 Nov 2026 10:00] NOTE | pain 2/10\n   words: Test note.</entries></journal> Write the explanations.' }] };
    const msg = fallbacks
      ? await client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage()
      : await client.messages.stream(params).finalMessage();
    return { label, ok: true, stop: msg.stop_reason, model: msg.model };
  } catch (err) {
    return { label, ok: false, status: err?.status, message: String(err?.error?.error?.message || err?.message || '').slice(0, 600) };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.VERCEL_ENV === 'production') return res.status(404).json({ error: 'Not here.' });
  const doctorOnly = { type: 'object', additionalProperties: false, required: ['doctor'], properties: { doctor: SCHEMA.properties.doctor } };
  const forYouOnly = { type: 'object', additionalProperties: false, required: ['for_you'], properties: { for_you: SCHEMA.properties.for_you } };
  const out = [];
  out.push(await attempt('full schema', SCHEMA));
  if (!out[0].ok) {
    out.push(await attempt('full schema, no fallbacks', SCHEMA, { fallbacks: false }));
    out.push(await attempt('doctor only', doctorOnly));
    out.push(await attempt('for_you only', forYouOnly));
  }
  return res.status(200).json(out);
}
