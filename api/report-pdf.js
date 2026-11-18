// POST /api/report-pdf {id, audience} - the confirmed report as an A4 PDF. It renders the very same
// HTML as the in-app preview (src/health/report.js) in headless Chromium, so the download matches.
// Reports still awaiting the patient's review are refused: confirmation comes before sharing.
// GET /api/report-pdf?check=1 renders a built-in sample with no personal data, to check the PDF engine.
import { createClient } from '@supabase/supabase-js';
import { allowed } from './_shared.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../src/health/config.js';
import { buildModel, periodFor, reportHTML, pageHTML, TYPES } from '../src/health/report.js';
import { htmlToPdf, FONT_CSS } from './_pdf.js';
import { LOGO_DATA_URI } from './_logo.js';

const UUID = /^[0-9a-f-]{36}$/i;

export function pdfFor(c, audience = 'doctor') {
  audience = 'doctor'; // one report since 18 Nov; the person's own section stays in the app
  const m = buildModel({ source: c.source, problems: c.problems, problemId: c.problem_id, period: periodFor(c.period.type, c.period.end), tz: c.tz, now: c.generated_at, earlier: c.earlier, corrections: c.review?.corrections || [] });
  const body = reportHTML(m, c.narrative, { audience, review: c.review || {}, logo: LOGO_DATA_URI, generatedAt: c.generated_at, pdf: true });
  const html = pageHTML(body, { fontCss: FONT_CSS, title: `Dr Pocket ${TYPES[m.period.type].toLowerCase()} report` });
  const footer = `${TYPES[m.period.type].toUpperCase()} REPORT  ·  ${m.label}`;
  const name = `Dr-Pocket-${TYPES[m.period.type]}-report-${m.period.start}${m.period.end !== m.period.start ? `-to-${m.period.end}` : ''}.pdf`;
  return { name, render: () => htmlToPdf(html, { footer }) };
}

const SAMPLE = {
  period: { type: 'day', start: '2026-01-01', end: '2026-01-01' }, tz: 'Africa/Johannesburg', generated_at: '2026-01-01T18:00:00Z', problem_id: 'p', earlier: [],
  problems: [{ id: 'p', title: 'Sample shoulder', area: 'Shoulder', side: 'right', status: 'active' }],
  source: [{ id: 'a', problem_id: 'p', kind: 'note', at: '2026-01-01T07:00:00Z', time_known: true, body: 'Sample note.', pain: 2, activities: ['Sitting'] }, { id: 'b', problem_id: 'p', kind: 'note', at: '2026-01-01T10:00:00Z', time_known: true, body: 'Sample note after a walk.', pain: 0, activities: ['Walking'] }],
  narrative: null, review: { status: 'confirmed', confirmed_at: '2026-01-01T18:00:00Z' },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET' && String(req.query?.check || new URL(req.url, 'http://x').searchParams.get('check')) === '1') {
      if (!allowed(req, 'pdfcheck', 10)) return res.status(429).json({ error: 'Try again later.' });
      const pdf = await pdfFor(SAMPLE, 'doctor').render();
      res.setHeader('Content-Type', 'application/pdf');
      return res.status(200).send(pdf);
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Sign in first.' });
    if (!allowed(req, 'pdf', 60)) return res.status(429).json({ error: 'Too many downloads this hour. Try again later.' });
    const { id, audience = 'doctor' } = req.body || {};
    if (!UUID.test(String(id || ''))) return res.status(400).json({ error: 'Unknown report.' });
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: row, error } = await sb.from('reports').select('content').eq('id', id).single();
    if (error || !row?.content?.v) return res.status(404).json({ error: 'That report could not be found.' });
    if (row.content.review?.status !== 'confirmed') return res.status(409).json({ error: 'Confirm the report first: it is still a draft.' });
    const { name, render } = pdfFor(row.content, audience === 'me' ? 'me' : 'doctor');
    const pdf = await render();
    console.log(`report-pdf: ${row.content.source.length} entries -> ${pdf.length} bytes`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return res.status(200).send(pdf);
  } catch (err) {
    console.log(`report-pdf: error ${err?.name || ''} ${String(err?.message || '').slice(0, 120)}`);
    return res.status(502).json({ error: 'The PDF could not be made. Please try again.' });
  }
}
