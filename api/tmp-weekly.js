// TEMPORARY (19 Nov): makes the owner's weekly shoulder report exactly as /api/progress does, for a PDF
// requested in chat. Preview deployments only; removed straight after.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../src/health/config.js';
import { TYPES, safeTz, periodFor, periodBounds, buildModel, notableTerms, zoned } from '../src/health/report.js';
import { write } from './progress.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.VERCEL_ENV === 'production') return res.status(404).json({ error: 'Not here.' });
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    const { data: j, error } = await sb.rpc('tmp_owner_journal', { p_secret: process.env.CRON_SECRET });
    if (error) throw new Error(`rpc ${error.message}`);
    const tz = safeTz('Africa/Johannesburg');
    const prob = j.problems.find((p) => /shoulder|sholder/i.test(`${p.title} ${p.area}`)) || j.problems[0];
    const period = periodFor('week', zoned(Date.now(), tz).key);
    const { from, to } = periodBounds(period, tz);
    const mine = j.entries.filter((e) => e.problem_id === prob.id || e.kind === 'day');
    const list = mine.filter((e) => +new Date(e.at) >= from && +new Date(e.at) < to);
    const earlier = [...new Set(mine.filter((e) => +new Date(e.at) < from).flatMap((e) => notableTerms(e)))];
    const now = new Date().toISOString();
    const m = buildModel({ source: list, problems: [prob], problemId: prob.id, period, tz, now, earlier });
    const narrative = await write(m, { reason: '' }, { action: 'report', userId: j.user_id, detail: `${TYPES.week} report, ${m.label}` });
    return res.status(200).json({
      user_id: j.user_id, range_label: `${prob.title} · ${TYPES.week} · ${m.label}`, range_from: new Date(from).toISOString(), range_to: new Date(to).toISOString(),
      content: { v: 2, period: { type: 'week', start: period.start, end: period.end }, tz, generated_at: now, problem_id: prob.id, problems: [prob], source: list, earlier, reason: '', narrative, headline: narrative.doctor.summary[0]?.text || '', review: { status: 'draft', additions: [], corrections: [] }, versions: [] },
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.error?.error?.message || err?.message || err).slice(0, 400) });
  }
}
