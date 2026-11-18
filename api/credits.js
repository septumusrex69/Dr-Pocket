// GET /api/credits - the owner's Claude credit overview. Only for the account owner (private.owners).
// Anthropic has no API for the remaining prepaid balance, so: the owner types the balance shown on the
// Anthropic billing page (saved with its date), and this works out the estimated remaining balance as that
// figure minus everything spent since. "Everything" comes from Anthropic's cost report (all software on
// the account) when an Admin API key is set as ANTHROPIC_ADMIN_KEY in Vercel; that report runs 4-24 hours
// behind, so Dr Pocket's own logged calls after the report's cut-off are added on top. Without the Admin
// key only Dr Pocket's own spend is known, and the page says so.
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { allowed } from './_shared.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../src/health/config.js';

const DAY = 864e5;
const FLOOR = Date.parse('2026-01-01T00:00:00Z');
const usd = (cents) => Number(cents || 0) / 100;

// Sum the cost report over [from, to), in windows of at most 31 days (the API's limit), grouped by API key.
async function orgCost(admin, from, to) {
  const byKey = {}; let total = 0; let refreshed = null;
  for (let a = Math.max(from, FLOOR, Date.now() - 364 * DAY); a < to; a += 31 * DAY) {
    const b = Math.min(to, a + 31 * DAY);
    const page = await admin.beta.organization.analytics.cost.list({ starting_at: new Date(a).toISOString(), ending_at: new Date(b).toISOString(), group_by: ['api_key_id'], limit: 1000 });
    refreshed = page.data_refreshed_at || refreshed;
    for await (const row of page) {
      const v = usd(row.cost?.amount);
      total += v;
      const k = row.group?.api_key_id || '';
      byKey[k] = (byKey[k] || 0) + v;
    }
  }
  return { total, byKey, refreshed };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in first.' });
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await sb.auth.getUser(token);
  if (!who?.user) return res.status(401).json({ error: 'Your sign-in has expired. Sign in again.' });
  const { data: owner } = await sb.rpc('is_owner');
  if (owner !== true) return res.status(403).json({ error: 'Only the account owner can see this.' });
  if (!allowed(req, 'credits', 40)) return res.status(429).json({ error: 'Try again in a few minutes.' });

  const now = Date.now();
  const d = new Date(now); const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const [{ data: base }, { data: month }, { data: all }] = await Promise.all([
    sb.rpc('get_credit_baseline'),
    sb.rpc('owner_ai_usage', { p_from: new Date(monthStart).toISOString(), p_to: new Date(now + 60e3).toISOString() }),
    sb.rpc('owner_ai_usage', { p_from: '2000-01-01T00:00:00Z', p_to: new Date(now + 60e3).toISOString() }),
  ]);
  const baseline = base?.[0] ? { amount: Number(base[0].amount_usd), as_of: base[0].as_of, set_at: base[0].set_at } : null;
  const sum = (rows) => (rows || []).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
  const out = { drpocket: { month: month || [], month_total: sum(month), all_total: sum(all) }, baseline, account: { configured: !!process.env.ANTHROPIC_ADMIN_KEY } };
  if (baseline) {
    const { data: since } = await sb.rpc('owner_ai_usage', { p_from: baseline.as_of, p_to: new Date(now + 60e3).toISOString() });
    out.drpocket.since_baseline = sum(since);
  }
  if (out.account.configured) {
    try {
      const admin = new Anthropic({ apiKey: process.env.ANTHROPIC_ADMIN_KEY });
      const names = {}; let mine = null;
      try {
        for await (const k of admin.beta.organization.apiKeys.list({ limit: 100 })) {
          names[k.id] = k.name;
          const [pre, post] = String(k.partial_key_hint || '').split('...');
          const app = process.env.ANTHROPIC_API_KEY || '';
          if (pre && post && app.startsWith(pre) && app.endsWith(post)) mine = k.id;
        }
      } catch { /* key names are a nice-to-have */ }
      const m = await orgCost(admin, monthStart, now);
      out.account.month_total = m.total;
      out.account.month_by_key = Object.entries(m.byKey).map(([id, v]) => ({ id, name: id ? names[id] || 'Other API key' : 'Console, Claude Code sign-in or other', usd: v, this_app: id === mine })).sort((a, b) => b.usd - a.usd);
      out.account.refreshed_at = m.refreshed;
      if (baseline) {
        const s = await orgCost(admin, Date.parse(baseline.as_of), now);
        // The report stops at refreshed_at; add Dr Pocket's own calls after that so the estimate stays current.
        let extra = 0;
        if (s.refreshed && Date.parse(s.refreshed) > Date.parse(baseline.as_of)) {
          const { data: late } = await sb.rpc('owner_ai_usage', { p_from: s.refreshed, p_to: new Date(now + 60e3).toISOString() });
          extra = sum(late);
        }
        out.account.since_baseline = s.total + extra;
        out.account.since_refreshed_at = s.refreshed;
        out.account.too_old = Date.parse(baseline.as_of) < Math.max(FLOOR, now - 364 * DAY);
      }
    } catch (err) {
      console.log(`credits: admin api ${err?.status || ''} ${err?.name || ''}`);
      out.account.error = err?.status === 401 ? 'The Admin API key was not accepted. Check ANTHROPIC_ADMIN_KEY in Vercel.'
        : err?.status === 403 || err?.status === 404 ? 'The Admin key has no access to the cost report (it needs an organization Admin key).'
          : 'Anthropic’s cost report could not be read just now.';
    }
  }
  const spent = out.account.since_baseline ?? out.drpocket.since_baseline;
  if (baseline && spent != null) out.remaining = { usd: Math.round((baseline.amount - spent) * 100) / 100, basis: out.account.since_baseline != null ? 'account' : 'drpocket' };
  return res.status(200).json(out);
}
