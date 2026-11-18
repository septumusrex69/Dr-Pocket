// Records what each Claude call cost, so My health can show spend per action.
// Prices are Anthropic's list prices per million tokens (Nov 2026). The cost is an estimate from the
// tokens Claude reports; the Anthropic bill is the final word. Writes go through the database function
// log_ai_usage, guarded by the same server secret as the evening reminder; failures never block the answer.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../src/health/config.js';

// [input, output, cache read] in USD per million tokens. Cache writes: 1.25x input (5 min), 2x input (1 h).
export const PRICES = {
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-opus-5': [5, 25, 0.5],
  'claude-opus-4-8': [5, 25, 0.5],
  'claude-opus-4-7': [5, 25, 0.5],
  'claude-sonnet-5-5': [2, 10, 0.1],
  'claude-sonnet-5': [2, 10, 0.2],
  'claude-haiku-5-5': [0.1, 0.5, 0.01],
  'claude-fable-5-2': [8, 40, 0.2],
};

export function costOf(model, u = {}) {
  const p = PRICES[model] || PRICES[Object.keys(PRICES).find((k) => String(model || '').startsWith(k))] || PRICES['claude-opus-5-5'];
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens || 0) - w1h);
  const usd = ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[2] + w5m * p[0] * 1.25 + w1h * p[0] * 2) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

export async function recordUsage({ action, userId = null, model, usage, detail = '' }) {
  if (!process.env.CRON_SECRET || !usage) return;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const cw = usage.cache_creation_input_tokens || 0;
    const { error } = await sb.rpc('log_ai_usage', {
      p_secret: process.env.CRON_SECRET, p_user: userId, p_action: action, p_model: model || '',
      p_in: usage.input_tokens || 0, p_out: usage.output_tokens || 0, p_cw: cw, p_cr: usage.cache_read_input_tokens || 0,
      p_cost: costOf(model, usage), p_detail: String(detail).slice(0, 200),
    });
    if (error) console.log(`usage: not recorded (${error.code || 'error'})`);
  } catch { console.log('usage: not recorded'); }
}
