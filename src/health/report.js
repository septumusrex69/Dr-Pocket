// Dr Pocket reports: the deterministic part.
// Shared by the app (preview), /api/progress (generation) and /api/report-pdf (export), so the PDF is
// always the same document as the preview. Pure functions only: no DOM, no network, no clock (the
// generation time is passed in and stored with the report).
//
// Rules that matter (from the reporting brief):
// - Statistics come from the entries, never from the AI. Missing pain is unknown, never zero.
// - Untimed readings are shown apart from timed ones; times are never invented.
// - Averages are "Average recorded pain": a day's average is the mean of that day's scores; a month's
//   (and the period's) is the mean of its daily averages, so busy days do not dominate.
// - Lines join readings only; they break across missing days and gaps of more than 6 hours.

export const TYPES = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' };
const GAP_MIN = 6 * 60;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = (v) => Math.round(v * 10) / 10;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const plural = (k, w, many = `${w}s`) => `${k} ${k === 1 ? w : many}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ---------- dates in the person's time zone ---------- */
const fmts = new Map();
function partsFmt(tz) {
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  return fmts.get(tz);
}
export function safeTz(tz) { try { if (tz) { partsFmt(tz); return tz; } } catch { /* fall through */ } return 'Africa/Johannesburg'; }
export function zoned(t, tz) {
  const p = Object.fromEntries(partsFmt(tz).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const y = +p.year; const m = +p.month; const d = +p.day; const h = +p.hour % 24; const mi = +p.minute;
  return { y, m, d, h, mi, mins: h * 60 + mi, key: `${p.year}-${p.month}-${p.day}`, time: `${String(h).padStart(2, '0')}:${p.minute}` };
}
const ymd = (key) => key.split('-').map(Number);
const keyOf = (y, m, d) => { const x = new Date(Date.UTC(y, m - 1, d)); return x.toISOString().slice(0, 10); };
export const addDays = (key, n) => { const [y, m, d] = ymd(key); return keyOf(y, m, d + n); };
export function zoneStart(key, tz) {
  const [y, m, d] = ymd(key);
  let t = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) { const z = zoned(t, tz); const off = Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi) - t; t = Date.UTC(y, m - 1, d) - off; }
  return t;
}
const weekday = (key) => { const [y, m, d] = ymd(key); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const dayShort = (key) => { const [, m, d] = ymd(key); return `${d} ${MONTHS[m - 1]}`; };
export const dayFull = (key) => { const [y, m, d] = ymd(key); return `${d} ${MONTHS_LONG[m - 1]} ${y}`; };
export const dayWd = (key) => `${WD[weekday(key)]} ${dayShort(key)}`;

export function periodFor(type, anchor) {
  const [y, m] = ymd(anchor);
  let start = anchor; let end = anchor;
  if (type === 'week') start = addDays(anchor, -6);
  else if (type === 'month') { start = keyOf(y, m, 1); end = keyOf(y, m, daysIn(y, m)); }
  else if (type === 'year') { start = keyOf(y, 1, 1); end = keyOf(y, 12, 31); }
  const days = [];
  for (let k = start; k <= end; k = addDays(k, 1)) days.push(k);
  return { type: TYPES[type] ? type : 'week', start, end, days };
}
export const periodBounds = (p, tz) => ({ from: zoneStart(p.start, tz), to: zoneStart(addDays(p.end, 1), tz) });
export function rangeLabel(p) {
  const [y1, m1, d1] = ymd(p.start); const [y2, m2, d2] = ymd(p.end);
  if (p.type === 'day') return `${WD_LONG[weekday(p.start)]} ${dayFull(p.start)}`;
  if (p.type === 'month') return `${MONTHS_LONG[m1 - 1]} ${y1}`;
  if (p.type === 'year') return `${y1}`;
  if (y1 !== y2) return `${dayFull(p.start)} – ${dayFull(p.end)}`;
  if (m1 !== m2) return `${d1} ${MONTHS_LONG[m1 - 1]} – ${d2} ${MONTHS_LONG[m2 - 1]} ${y2}`;
  return `${d1}–${d2} ${MONTHS_LONG[m2 - 1]} ${y2}`;
}

/* ---------- entries ---------- */
export const actsOf = (e) => (e.activities?.length ? e.activities : e.activity ? String(e.activity).split(', ').filter(Boolean) : []);
export function exerciseText(x) {
  if (!x) return 'Exercise';
  if (x.items?.length) {
    const done = x.items.filter((i) => i.done !== false);
    const bits = [`${x.name || 'Routine'}: ${done.length} of ${x.items.length} done`];
    if (x.minutes) bits.push(`${x.minutes} min`);
    return `${bits.join(', ')} (${done.map((i) => i.name).join(', ')})`;
  }
  const bits = [x.name || 'Exercise'];
  if (x.sets) bits.push(`${x.sets} × ${x.reps ?? '?'} reps`); else if (x.reps) bits.push(`${x.reps} reps`);
  if (x.weight) bits.push(`${x.weight} kg`);
  if (x.minutes) bits.push(`${x.minutes} min`);
  if (x.km) bits.push(`${x.km} km`);
  return bits.join(', ');
}
// "20 minutes of computer work", "walking (two blocks)", "sitting and driving".
export function activityPhrase(e) {
  if (e.kind === 'exercise') return exerciseText(e.exercise);
  const acts = actsOf(e).filter((a) => !(e.kind === 'day'));
  if (!acts.length) return '';
  const list = acts.map((a) => a.toLowerCase());
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
  const d = String(e.activity_detail || '').trim();
  if (!d) return joined;
  if (/^(about |around |~)?\d+(\.\d+)?\s*(min|mins|minutes|h|hr|hrs|hours?|km|blocks?|m)\.?$/i.test(d) && list.length === 1) return `${d} of ${joined}`;
  return `${joined} (${d})`;
}
const NOTABLE = [
  { key: 'tingling', label: 'tingling / pins and needles', re: /tingl|pins (and|&) needles|numbness \/ tingling/i },
  { key: 'numb', label: 'numbness', re: /\bnumb(?!ness \/ tingling)/i },
  { key: 'weak', label: 'weakness', re: /\bweak(ness)?\b/i },
  { key: 'swelling', label: 'swelling', re: /swell|swollen/i },
  { key: 'radiating', label: 'pain spreading or shooting', re: /radiat|shooting|down (my|the) arm|into (my|the) (arm|hand|neck)/i },
  { key: 'locking', label: 'locking or giving way', re: /\block(ing|ed)\b|gave way|giving way|instabil/i },
];
const SLEEP_RE = /woke (up )?(with|from|in|because|at night)|wak(e|ing) up (with|in|from) pain|couldn'?t sleep|could not sleep|kept me (up|awake)|night pain|pain (at|during the) night|disturbed sleep|bad night|poor sleep|stiffness (at|in the) night|night stiffness/i;
const textOf = (e) => [e.body, ...(e.symptoms || []), e.triggers, e.relief, e.impact].filter(Boolean).join(' \n ');
export const notableTerms = (e) => NOTABLE.filter((n) => n.re.test(textOf(e))).map((n) => n.key);

/* ---------- the model ---------- */
// source: the entry snapshot stored with the report. corrections: applied patient corrections.
export function buildModel({ source = [], problems = [], problemId = null, period, tz: tzIn, now, earlier = [], corrections = [] }) {
  const tz = safeTz(tzIn);
  const p = period.days ? period : periodFor(period.type, period.end);
  const { from, to } = periodBounds(p, tz);
  const todayKey = zoned(now, tz).key;
  const fix = {};
  for (const c of corrections) if (c.status === 'applied' && c.target?.type === 'entry' && c.pain !== undefined) fix[c.target.ref] = c;

  const list = source.filter((e) => +new Date(e.at) >= from && +new Date(e.at) < to).sort((a, b) => +new Date(a.at) - +new Date(b.at) || String(a.id).localeCompare(String(b.id)));
  const prob = Object.fromEntries(problems.map((x) => [x.id, x]));
  const rows = list.map((e, i) => {
    const ref = `E${i + 1}`;
    const z = zoned(e.at, tz);
    const timed = e.time_known !== false;
    const c = fix[ref];
    const pain = c ? c.pain : e.pain;
    return { ref, id: e.id, e, key: z.key, t: +new Date(e.at), mins: timed ? z.mins : null, timed, time: timed ? z.time : null, pain: pain ?? null, painOriginal: e.pain ?? null, corrected: !!c, checkin: e.kind === 'day', problem: e.problem_id ? prob[e.problem_id]?.title || '' : '' };
  });
  const byRef = Object.fromEntries(rows.map((r) => [r.ref, r]));

  const days = p.days.map((key) => {
    const rs = rows.filter((r) => r.key === key);
    const sc = rs.filter((r) => r.pain != null);
    const vals = sc.map((r) => r.pain);
    const future = key > todayKey;
    return {
      key, future, today: key === todayKey, rows: rs,
      timed: sc.filter((r) => r.timed), untimed: sc.filter((r) => !r.timed),
      n: vals.length, avg: vals.length ? r1(mean(vals)) : null, min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null,
      status: future && !rs.length ? 'future' : !rs.length ? 'none' : !vals.length ? 'unscored' : 'scored',
    };
  });
  const elapsed = days.filter((d) => !d.future);
  const scoredDays = days.filter((d) => d.n);
  const readings = rows.filter((r) => r.pain != null);
  const dayAvgs = scoredDays.map((d) => d.avg);

  // Yearly: month averages are the mean of that month's daily averages.
  let months = null;
  if (p.type === 'year') {
    months = MONTHS.map((name, i) => {
      const ds = days.filter((d) => +d.key.slice(5, 7) === i + 1);
      const sd = ds.filter((d) => d.n);
      const avgs = sd.map((d) => d.avg);
      return {
        i, name, key: ds[0].key.slice(0, 7), days: ds.length, elapsed: ds.filter((d) => !d.future).length, withEntries: ds.filter((d) => d.rows.length).length,
        scored: sd.length, readings: sd.reduce((s, d) => s + d.n, 0), avg: avgs.length ? r1(mean(avgs)) : null,
        min: sd.length ? Math.min(...sd.map((d) => d.min)) : null, max: sd.length ? Math.max(...sd.map((d) => d.max)) : null,
        lowAvg: avgs.length ? Math.min(...avgs) : null, highAvg: avgs.length ? Math.max(...avgs) : null, future: ds.every((d) => d.future),
      };
    });
  }

  const stats = {
    entries: rows.length,
    checkins: rows.filter((r) => r.checkin).length,
    readings: readings.length,
    untimed: readings.filter((r) => !r.timed).length,
    unscored: rows.filter((r) => r.pain == null).length,
    min: readings.length ? Math.min(...readings.map((r) => r.pain)) : null,
    max: readings.length ? Math.max(...readings.map((r) => r.pain)) : null,
    avg: dayAvgs.length ? r1(mean(dayAvgs)) : null,
    days: days.length, elapsed: elapsed.length, future: days.length - elapsed.length,
    daysWithEntries: days.filter((d) => d.rows.length).length, daysScored: scoredDays.length,
    corrected: rows.filter((r) => r.corrected).length,
  };

  /* ---- symptoms and activities (counted, not interpreted) ---- */
  const symCount = {};
  for (const r of rows) for (const s of r.e.symptoms || []) symCount[s] = (symCount[s] || 0) + 1;
  const symptoms = Object.entries(symCount).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
  const actMap = {};
  for (const r of rows) {
    if (r.checkin) continue;
    const names = r.e.kind === 'exercise' ? [r.e.exercise?.name || 'Exercise'] : actsOf(r.e);
    for (const a of names) {
      const x = (actMap[a] ||= { name: a, n: 0, scores: [], refs: [] });
      x.n += 1; x.refs.push(r.ref); if (r.pain != null) x.scores.push(r.pain);
    }
  }
  const activities = Object.values(actMap).sort((a, b) => b.n - a.n).map((a) => ({ ...a, min: a.scores.length ? Math.min(...a.scores) : null, max: a.scores.length ? Math.max(...a.scores) : null }));

  /* ---- significant events (deterministic, focused) ---- */
  const events = [];
  const seen = new Set(earlier);
  const ctxBefore = (r) => {
    // The closest earlier activity the same day (timed) or same-day activity without a time.
    const same = rows.filter((x) => x.key === r.key && x !== r && !x.checkin && activityPhrase(x.e));
    const before = r.timed ? same.filter((x) => x.timed && x.t < r.t && r.t - x.t <= 4 * 3600e3).pop() : null;
    const untimed = same.filter((x) => !x.timed && x !== before);
    const out = [];
    if (activityPhrase(r.e) && !r.checkin) out.push(`Recorded in the same entry: ${activityPhrase(r.e)}.`);
    else if (before) out.push(`It was recorded at ${r.time}, after ${activityPhrase(before.e)} (${before.time}).`);
    if (untimed.length) {
      const names = [...new Set(untimed.map((x) => activityPhrase(x.e)))].slice(0, 2).join(' and ');
      out.push(`${cap(names)} was also recorded that day; the timing relative to this reading is unclear.`);
    }
    return { text: out.join(' '), refs: [before?.ref, ...untimed.map((x) => x.ref)].filter(Boolean) };
  };
  const when = (r) => `${dayShort(r.key)}${r.timed ? `, ${r.time}` : ' (time not recorded)'}`;
  // New notable symptoms: first time in the whole journal, and inside this period.
  for (const r of rows) {
    for (const k of notableTerms(r.e)) {
      if (seen.has(k)) continue;
      seen.add(k);
      const n = NOTABLE.find((x) => x.key === k);
      const act = activityPhrase(r.e);
      const pain = r.pain != null ? ` with pain ${r.pain}/10` : '';
      let text = act && !r.checkin ? `After ${act}, ${n.label} was recorded${pain}.` : `${cap(n.label)} was recorded${pain}.`;
      const later = rows.find((x) => x.key === r.key && x.timed && r.timed && x.t > r.t && x.pain != null);
      const refs = [r.ref];
      if (later) {
        const mentions = notableTerms(later.e).includes(k);
        text += ` Pain was ${later.pain}/10 at ${later.time}${mentions ? '' : `; whether the ${n.label.split(' /')[0]} had stopped was not recorded`}.`;
        refs.push(later.ref);
      }
      events.push({ type: 'new', rank: 1, ref: r.ref, key: r.key, title: `First recorded ${n.label}: ${when(r)}`, text, refs, warm: true });
    }
  }
  if (readings.length && stats.max > 0) {
    const peak = readings.filter((r) => r.pain === stats.max).sort((a, b) => (b.timed - a.timed) || a.t - b.t)[0];
    const ctx = ctxBefore(peak);
    const times = readings.filter((r) => r.pain === stats.max).length;
    events.push({ type: 'peak', rank: 2, ref: peak.ref, key: peak.key, title: `Highest recorded pain: ${stats.max}/10, ${when(peak)}`, text: [times > 1 ? `This score was recorded ${plural(times, 'time')} in the period; the first is marked.` : '', ctx.text].filter(Boolean).join(' '), refs: [peak.ref, ...ctx.refs], warm: true });
  }
  const sleepRows = rows.filter((r) => SLEEP_RE.test(textOf(r.e)) || (r.checkin && /poor/i.test(r.e.checkin?.sleep_q || '')));
  const sleepDays = [...new Set(sleepRows.map((r) => r.key))];
  if (sleepDays.length && sleepDays.length <= 2) {
    for (const key of sleepDays) {
      const r = sleepRows.find((x) => x.key === key);
      events.push({ type: 'sleep', rank: 3, ref: r.ref, key: r.key, title: `Sleep disturbance recorded: ${when(r)}`, text: r.checkin ? 'Sleep was rated poor in the end-of-day check-in.' : 'The entry mentions sleep or night-time symptoms.', refs: [r.ref], warm: true });
    }
  } else if (sleepDays.length) {
    const first = sleepRows[0]; const last = sleepRows[sleepRows.length - 1];
    events.push({ type: 'sleep', rank: 3, ref: last.ref, key: last.key, title: `Sleep disturbance recorded on ${sleepDays.length} days`, text: `First on ${dayShort(first.key)}, most recently on ${dayShort(last.key)} (marked). From entries mentioning sleep or night-time symptoms, and check-ins rating sleep as poor.`, refs: sleepRows.slice(0, 8).map((x) => x.ref), warm: true });
  }
  const timedSorted = readings.filter((r) => r.timed);
  let rise = null;
  for (let i = 1; i < timedSorted.length; i++) {
    const a = timedSorted[i - 1]; const b = timedSorted[i];
    if (b.t - a.t <= 24 * 3600e3 && b.pain - a.pain >= 3 && (!rise || b.pain - a.pain > rise.b.pain - rise.a.pain)) rise = { a, b };
  }
  if (rise && !(events.some((x) => x.type === 'peak' && x.ref === rise.b.ref))) {
    const ctx = ctxBefore(rise.b);
    events.push({ type: 'rise', rank: 4, ref: rise.b.ref, key: rise.b.key, title: `Pain rose from ${rise.a.pain} to ${rise.b.pain}/10: ${when(rise.a)} to ${rise.b.time}`, text: ctx.text, refs: [rise.a.ref, rise.b.ref, ...ctx.refs], warm: true });
  }
  events.sort((a, b) => a.rank - b.rank || byRef[a.ref].t - byRef[b.ref].t);
  const limit = 4;
  events.forEach((ev, i) => { ev.onChart = i < limit; });
  const shown = events.filter((e) => e.onChart).sort((a, b) => byRef[a.ref].t - byRef[b.ref].t);
  shown.forEach((ev, i) => { ev.n = i + 1; });

  /* ---- missing information (counted) ---- */
  const missing = [];
  if (stats.elapsed && stats.daysWithEntries < stats.elapsed) missing.push(`No entries on ${plural(stats.elapsed - stats.daysWithEntries, 'day')} of the ${stats.elapsed} ${stats.future ? 'days so far' : 'days in the period'}.`);
  if (stats.unscored) missing.push(`${stats.unscored} of ${plural(stats.entries, 'entry', 'entries')} have no pain score.`);
  if (stats.untimed) missing.push(`${plural(stats.untimed, 'pain reading')} ${stats.untimed === 1 ? 'has' : 'have'} no time recorded; ${stats.untimed === 1 ? 'it is' : 'they are'} shown apart on the charts.`);

  const pr = problemId ? prob[problemId] : null;
  return { tz, period: p, todayKey, rows, byRef, days, months, stats, symptoms, activities, events, missing, problem: pr, problems, label: rangeLabel(p) };
}

export function coverageLine(m) {
  const s = m.stats;
  if (!s.entries) return s.future === s.days ? 'This period has not started yet' : 'No entries recorded in this period';
  const base = m.period.type === 'day' ? `${plural(s.entries, 'entry', 'entries')} recorded` : `Entries recorded on ${s.daysWithEntries} of ${s.days} days`;
  return s.future && m.period.type !== 'day' ? `${base} · ${plural(s.future, 'day')} still to come` : base;
}

/* ---------- charts (SVG strings) ---------- */
const C = { line: '#006F7F', dot: '#006F7F', grid: '#E3EAEF', axis: '#6B7C8D', warm: '#C2410C', warmSoft: '#FDEBDD', range: '#9FD3DA', none: '#F3F6F8', future: '#F7F9FA' };
const yv = (v, top, h) => top + (1 - v / 10) * h;
function segments(points, gap) {
  const segs = []; let cur = [];
  for (const pt of points) { if (cur.length && pt.gapFrom(cur[cur.length - 1]) > gap) { segs.push(cur); cur = []; } cur.push(pt); }
  if (cur.length) segs.push(cur);
  return segs;
}
const pathOf = (seg) => seg.map((pt, i) => `${i ? 'L' : 'M'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join('');
const badge = (x, y, n) => `<g class="ev-badge"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7.5" fill="${C.warm}"/><text x="${x.toFixed(1)}" y="${(y + 3.4).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fff">${n}</text></g>`;
const marker = (x, y, r, { checkin = false, warm = false, title = '' } = {}) => {
  const fill = warm ? C.warm : C.dot;
  const shape = checkin
    ? `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" rx="1.5" fill="#fff" stroke="${fill}" stroke-width="2"/>`
    : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`;
  return `<g>${title ? `<title>${esc(title)}</title>` : ''}${shape}</g>`;
};

// One day, 00–24 h. Untimed readings sit in a separate "No time" column on the right.
export function dayChart(day, events, { w = 640, h = 230, big = true } = {}) {
  const fs = big ? 11 : 15;
  const L = big ? 30 : 26; const R = day.untimed.length ? (big ? 64 : 52) : 12; const T = big ? 18 : 22; const B = big ? 24 : 26;
  const ph = h - T - B; const pw = w - L - R;
  const x = (mins) => L + (mins / 1440) * pw;
  const y = (v) => yv(v, T, ph);
  const evBy = Object.fromEntries(events.filter((e) => e.onChart && e.key === day.key).map((e) => [e.ref, e]));
  const ticksY = big ? [0, 2, 4, 6, 8, 10] : [0, 5, 10];
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Pain readings on ${esc(dayWd(day.key))}" font-family="Montserrat, sans-serif">`;
  s += ticksY.map((v) => `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 3.6}" text-anchor="end" font-size="${fs}" fill="${C.axis}">${v}</text>`).join('');
  s += (big ? [0, 6, 12, 18, 24] : [0, 12, 24]).map((hh) => `<text x="${x(hh * 60)}" y="${h - 6}" text-anchor="${hh === 0 ? 'start' : hh === 24 ? 'end' : 'middle'}" font-size="${fs}" fill="${C.axis}">${String(hh).padStart(2, '0')}${big ? ':00' : 'h'}</text>`).join('');
  const pts = day.timed.map((r) => ({ r, x: x(r.mins), y: y(r.pain), gapFrom: (o) => r.mins - o.r.mins }));
  for (const seg of segments(pts, GAP_MIN)) if (seg.length > 1) s += `<path d="${pathOf(seg)}" fill="none" stroke="${C.line}" stroke-width="${big ? 2.4 : 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const placed = [];
  for (const pt of pts) {
    const ev = evBy[pt.r.ref];
    if (ev) s += `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${big ? 8 : 6.5}" fill="none" stroke="${C.warm}" stroke-width="2"/>`;
    s += marker(pt.x, pt.y, big ? 4.6 : 5, { checkin: pt.r.checkin, warm: !!ev, title: `${pt.r.time}: ${pt.r.pain}/10 (${pt.r.ref})` });
    if (ev) { let by = Math.max(9, pt.y - (big ? 17 : 15)); while (placed.some((q) => Math.abs(q.x - pt.x) < 16 && Math.abs(q.y - by) < 16)) by -= 17; if (by < 8) { by = Math.max(9, pt.y - 15); let bx = pt.x; while (placed.some((q) => Math.abs(q.x - bx) < 16 && Math.abs(q.y - by) < 16)) bx += 17; placed.push({ x: bx, y: by }); s += badge(bx, by, ev.n); } else { placed.push({ x: pt.x, y: by }); s += badge(pt.x, by, ev.n); } }
    if (big && pts.length <= 10) s += `<text x="${pt.x.toFixed(1)}" y="${(pt.y + (pt.r.pain >= 9 ? 18 : -9)).toFixed(1)}" text-anchor="middle" font-size="9.5" fill="${C.axis}">${ev ? '' : pt.r.time}</text>`;
  }
  if (day.untimed.length) {
    const cx = L + pw + R / 2 + 2;
    s += `<rect x="${L + pw + 6}" y="${T - 4}" width="${R - 8}" height="${ph + 8}" rx="6" fill="${C.none}"/>`;
    s += `<text x="${cx}" y="${big ? h - 6 : T - 8}" text-anchor="middle" font-size="${big ? fs : fs - 2}" fill="${C.axis}">No time</text>`;
    day.untimed.forEach((r, i) => {
      const off = (i - (day.untimed.length - 1) / 2) * 7;
      const ev = evBy[r.ref];
      s += marker(cx + off, y(r.pain), big ? 4.6 : 3.6, { checkin: r.checkin, warm: !!ev, title: `Time not recorded: ${r.pain}/10 (${r.ref})` });
      if (ev) s += badge(cx + off, Math.max(9, y(r.pain) - 14), ev.n);
    });
  }
  return `${s}</svg>`;
}

// One mini panel per day for the weekly report.
export function weekPanels(m) {
  return `<div class="wk">${m.days.map((d) => {
    const head = `<div class="wk-h"><b>${esc(dayWd(d.key))}</b>${d.n ? `<span>${plural(d.n, 'reading')}</span>` : ''}</div>`;
    let body;
    if (d.status === 'scored') body = dayChart(d, m.events, { w: 260, h: 150, big: false });
    else {
      const words = d.status === 'future' ? 'Still to come' : d.status === 'none' ? 'No entries' : 'Pain not scored';
      const sub = d.status === 'unscored' ? `${plural(d.rows.length, 'entry', 'entries')} without a pain score` : d.status === 'future' ? 'Future date' : '';
      body = `<div class="wk-empty ${d.status}"><span>${words}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    }
    return `<div class="wk-p ${d.status}">${head}${body}</div>`;
  }).join('')}</div>`;
}

// Monthly: the average recorded pain per day, with the day's lowest–highest score as a pale bar.
export function monthChart(m, { w = 680, h = 270 } = {}) {
  const days = m.days; const N = days.length;
  const L = 30; const R = 10; const T = 22; const B = 62;
  const pw = w - L - R; const ph = h - T - B;
  const step = pw / N;
  const x = (i) => L + step * (i + 0.5);
  const y = (v) => yv(v, T, ph);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Average recorded pain per day, ${esc(m.label)}" font-family="Montserrat, sans-serif">`;
  days.forEach((d, i) => { if (d.future) s += `<rect x="${(L + step * i).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${ph}" fill="${C.future}"/>`; });
  s += [0, 2, 4, 6, 8, 10].map((v) => `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/><text x="${L - 6}" y="${y(v) + 3.6}" text-anchor="end" font-size="11" fill="${C.axis}">${v}</text>`).join('');
  days.forEach((d, i) => { if (d.n > 1 && d.max > d.min) s += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(d.max)}" y2="${y(d.min)}" stroke="${C.range}" stroke-width="${Math.min(6, step * 0.5).toFixed(1)}" stroke-linecap="round"/>`; });
  const pts = days.map((d, i) => (d.n ? { d, i, x: x(i), y: y(d.avg), gapFrom: (o) => i - o.i } : null)).filter(Boolean);
  for (const seg of segments(pts, 1)) if (seg.length > 1) s += `<path d="${pathOf(seg)}" fill="none" stroke="${C.line}" stroke-width="2.2" stroke-linejoin="round"/>`;
  const evDay = {};
  for (const ev of m.events.filter((e) => e.onChart)) (evDay[ev.key] ||= []).push(ev);
  for (const pt of pts) {
    const evs = evDay[pt.d.key];
    if (evs) s += `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="7" fill="none" stroke="${C.warm}" stroke-width="2"/>`;
    s += marker(pt.x, pt.y, 4, { warm: !!evs, title: `${dayShort(pt.d.key)}: average ${pt.d.avg}/10 from ${plural(pt.d.n, 'reading')}${pt.d.n > 1 ? ` (lowest ${pt.d.min}, highest ${pt.d.max})` : ''}` });
  }
  Object.entries(evDay).forEach(([key, evs]) => {
    const i = days.findIndex((d) => d.key === key); if (i < 0) return;
    const d = days[i]; const top = d.n ? y(d.max) - 14 : T + 8;
    evs.sort((a, b) => a.n - b.n).forEach((ev, j) => { s += badge(x(i), Math.max(9, top - j * 17), ev.n); });
  });
  // Readings per day, then a coverage row: filled = scored, ring = entries without a score, dash = no entries, pale = future.
  const yc = T + ph + 18; const yn = T + ph + 36;
  s += `<text x="${L - 6}" y="${yc + 3.5}" text-anchor="end" font-size="9" fill="${C.axis}">n</text>`;
  days.forEach((d, i) => {
    const cx = x(i);
    if (d.n) s += `<text x="${cx.toFixed(1)}" y="${yc + 3.5}" text-anchor="middle" font-size="${N > 20 ? 8.5 : 10}" fill="${C.axis}">${d.n}</text>`;
    const st = d.status;
    const sz = Math.min(8, step * 0.62);
    if (st === 'scored') s += `<rect x="${(cx - sz / 2).toFixed(1)}" y="${yn - sz / 2}" width="${sz.toFixed(1)}" height="${sz.toFixed(1)}" rx="1.5" fill="${C.line}"/>`;
    else if (st === 'unscored') s += `<rect x="${(cx - sz / 2 + 0.75).toFixed(1)}" y="${yn - sz / 2 + 0.75}" width="${(sz - 1.5).toFixed(1)}" height="${(sz - 1.5).toFixed(1)}" rx="1.5" fill="#fff" stroke="${C.line}" stroke-width="1.5"/>`;
    else if (st === 'none') s += `<line x1="${(cx - sz / 2).toFixed(1)}" x2="${(cx + sz / 2).toFixed(1)}" y1="${yn}" y2="${yn}" stroke="#B9C5CF" stroke-width="1.5"/>`;
    else s += `<rect x="${(cx - sz / 2).toFixed(1)}" y="${yn - sz / 2}" width="${sz.toFixed(1)}" height="${sz.toFixed(1)}" rx="1.5" fill="#EEF2F5"/>`;
    s += `<rect class="hit" data-day="${d.key}" x="${(L + step * i).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${ph + 44}" fill="transparent"><title>${esc(dayShort(d.key))}</title></rect>`;
  });
  const lab = new Set([0, 4, 9, 14, 19, 24, N - 1]);
  days.forEach((d, i) => { if (lab.has(i) && !(i === 24 && N - 1 - i < 3)) s += `<text x="${x(i).toFixed(1)}" y="${h - 6}" text-anchor="middle" font-size="11" fill="${C.axis}">${+d.key.slice(8)}</text>`; });
  return `${s}</svg>`;
}

// Yearly: each month's average recorded pain (mean of its daily averages); pale bar = range of daily averages.
export function yearChart(m, { w = 680, h = 260 } = {}) {
  const ms = m.months;
  const L = 30; const R = 10; const T = 22; const B = 50;
  const pw = w - L - R; const ph = h - T - B; const step = pw / 12;
  const x = (i) => L + step * (i + 0.5); const y = (v) => yv(v, T, ph);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Average recorded pain per month, ${esc(m.label)}" font-family="Montserrat, sans-serif">`;
  ms.forEach((mo, i) => { if (mo.future) s += `<rect x="${(L + step * i).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${ph}" fill="${C.future}"/>`; });
  s += [0, 2, 4, 6, 8, 10].map((v) => `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/><text x="${L - 6}" y="${y(v) + 3.6}" text-anchor="end" font-size="11" fill="${C.axis}">${v}</text>`).join('');
  ms.forEach((mo, i) => { if (mo.scored > 1 && mo.highAvg > mo.lowAvg) s += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(mo.highAvg)}" y2="${y(mo.lowAvg)}" stroke="${C.range}" stroke-width="7" stroke-linecap="round"/>`; });
  const pts = ms.map((mo, i) => (mo.avg != null ? { mo, i, x: x(i), y: y(mo.avg), gapFrom: (o) => i - o.i } : null)).filter(Boolean);
  for (const seg of segments(pts, 1)) if (seg.length > 1) s += `<path d="${pathOf(seg)}" fill="none" stroke="${C.line}" stroke-width="2.2"/>`;
  const evMo = {};
  for (const ev of m.events.filter((e) => e.onChart)) (evMo[+ev.key.slice(5, 7) - 1] ||= []).push(ev);
  for (const pt of pts) s += marker(pt.x, pt.y, 4.5, { warm: !!evMo[pt.i], title: `${MONTHS_LONG[pt.i]}: ${pt.mo.avg}/10 from ${plural(pt.mo.scored, 'day')} with scores` });
  Object.entries(evMo).forEach(([i, evs]) => { const mo = ms[i]; const top = mo.avg != null ? y(mo.highAvg ?? mo.avg) - 14 : T + 8; evs.sort((a, b) => a.n - b.n).forEach((ev, j) => { s += badge(x(+i), Math.max(9, top - j * 17), ev.n); }); });
  ms.forEach((mo, i) => {
    s += `<text x="${x(i).toFixed(1)}" y="${T + ph + 16}" text-anchor="middle" font-size="11" fill="${C.axis}">${mo.name}</text>`;
    s += `<text x="${x(i).toFixed(1)}" y="${T + ph + 32}" text-anchor="middle" font-size="9.5" fill="${C.axis}">${mo.future ? '–' : `${mo.scored}/${mo.elapsed}`}</text>`;
    s += `<rect class="hit" data-month="${mo.key}" x="${(L + step * i).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${ph + 36}" fill="transparent"/>`;
  });
  s += `<text x="${L}" y="${h - 4}" font-size="9.5" fill="${C.axis}">Below each month: days with pain scores / days elapsed</text>`;
  return `${s}</svg>`;
}

// A small month chart for the yearly report's month detail.
function miniMonth(m, mo) {
  const sub = { ...m, days: m.days.filter((d) => d.key.startsWith(mo.key)), label: `${MONTHS_LONG[mo.i]}` };
  return monthChart(sub, { w: 680, h: 230 });
}

/* ---------- the document ---------- */
const AUD = {
  doctor: { sub: 'Pain and activity report', harder: 'Discomfort reported with', easier: 'Relief reported after', func: 'Effect on daily function', treat: 'Treatment and exercise recorded', q: 'For the consultation', miss: 'Information to clarify', seq: 'What happened, then what changed' },
  me: { sub: 'Your pain and activity summary', harder: 'Harder with', easier: 'Easier after', func: 'Effect on your day', treat: 'What you did for it', q: 'Questions for your doctor or physio', miss: 'Not recorded yet', track: 'What to track next', seq: 'What happened, then what changed' },
};
export const audienceLabel = (a) => (a === 'me' ? 'For me' : 'For my doctor');
const refsOf = (m, ids) => [...new Set(ids || [])].filter((k) => m.byRef[k]).map((k) => `<a class="ref" href="#src-${k}" data-ref="${k}">${k}</a>`).join('');
const fmtStamp = (t, tz) => { const z = zoned(t, tz); return `${dayFull(z.key)}, ${z.time}`; };

function painSection(m) {
  const t = m.period.type; const s = m.stats;
  const note = 'Pain is on a 0–10 scale. Lines connect recorded readings only: they are not continuous monitoring, and they break across missing days and gaps of more than 6 hours. Missing readings are never shown as zero.';
  let chart = ''; let legend = '';
  const sq = (cls) => `<i class="lg ${cls}"></i>`;
  if (t === 'week') {
    chart = weekPanels(m);
    legend = `<p class="rd-legend">${sq('dot')} reading at its time ${s.checkins ? `${sq('sq')} end-of-day check-in ` : ''}${s.untimed ? '· “No time” column: readings without a recorded time ' : ''}· same 0–10 scale and 00:00–24:00 time axis on every day</p>`;
  } else if (!s.readings) {
    chart = `<div class="rd-empty">${s.entries ? `Pain not scored: ${plural(s.entries, 'entry', 'entries')} in this period, none with a pain score.` : 'No entries in this period.'}</div>`;
  } else if (t === 'day') {
    const d = m.days[0];
    chart = `<div class="rd-chart">${dayChart(d, m.events)}</div>`;
    legend = `<p class="rd-legend">${sq('dot')} reading at its recorded time ${s.checkins ? `${sq('sq')} end-of-day check-in ` : ''}${d.untimed.length ? '· “No time”: readings without a recorded time, shown apart' : ''}</p>`;
    chart += `<ol class="rd-readings">${d.rows.map((r) => `<li><span class="t">${r.timed ? r.time : 'No time'}</span><span class="p">${r.pain != null ? `${r.pain}/10` : 'Not scored'}</span><span class="c">${esc(r.checkin ? 'End-of-day check-in' : cap(activityPhrase(r.e)) || (r.e.symptoms || []).join(', ') || 'Note')}${r.e.symptoms?.length && !r.checkin && activityPhrase(r.e) ? ` · ${esc(r.e.symptoms.join(', ').toLowerCase())}` : ''} ${refsOf(m, [r.ref])}</span></li>`).join('')}</ol>`;
  } else if (t === 'month') {
    chart = `<div class="rd-chart">${monthChart(m)}</div>`;
    if (s.daysScored < 4) chart += `<p class="rd-few">Pain was scored on only ${plural(s.daysScored, 'day')} of this month, too few to show a monthly trend.</p>`;
    legend = `<p class="rd-legend">${sq('dot')} average recorded pain that day ${sq('bar')} lowest to highest score that day · n = readings · ${sq('cov')} scored ${sq('cov-ring')} entries, no score ${sq('cov-none')} no entries${s.future ? ` ${sq('cov-fut')} still to come` : ''}</p>`;
  } else {
    chart = `<div class="rd-chart">${yearChart(m)}</div>`;
    const sm = m.months.filter((mo) => mo.avg != null).length;
    if (sm < 3) chart += `<p class="rd-few">Only ${plural(sm, 'month')} in this year ${sm === 1 ? 'has' : 'have'} pain scores, so a yearly trend cannot be read from this chart.</p>`;
    legend = `<p class="rd-legend">${sq('dot')} average recorded pain for the month (the mean of its daily averages, so days with many entries do not dominate) ${sq('bar')} range of daily averages</p>`;
  }
  const evs = m.events.filter((e) => e.onChart).sort((a, b) => a.n - b.n);
  const evHtml = evs.length ? `<ol class="rd-events">${evs.map((e) => `<li><span class="evn">${e.n}</span><div><b>${esc(e.title)}</b>${e.text ? `<p>${esc(e.text)} ${refsOf(m, e.refs)}</p>` : ` ${refsOf(m, e.refs)}`}</div></li>`).join('')}</ol>` : '';
  let detail = '';
  if (t === 'year') {
    const rows = m.months.filter((mo) => mo.withEntries);
    detail = rows.length ? `<div class="rd-sub-h">Monthly detail</div>
      <table class="rd-mt"><thead><tr><th>Month</th><th>Days with entries</th><th>Days scored</th><th>Readings</th><th>Average recorded pain</th><th>Lowest–highest score</th></tr></thead><tbody>
      ${rows.map((mo) => `<tr><td>${MONTHS_LONG[mo.i]}</td><td>${mo.withEntries} of ${mo.elapsed}</td><td>${mo.scored}</td><td>${mo.readings}</td><td>${mo.avg != null ? `${mo.avg}/10` : 'Not scored'}</td><td>${mo.min != null ? `${mo.min}–${mo.max}` : '–'}</td></tr>`).join('')}</tbody></table>
      <div class="rd-months screen-only">${rows.filter((mo) => mo.scored).map((mo) => `<details data-month="${mo.key}"><summary>${MONTHS_LONG[mo.i]}: daily detail</summary>${miniMonth(m, mo)}</details>`).join('')}</div>` : '';
  }
  return `<section class="rd-sec rd-pain"><h2><span>01</span>Pain ${t === 'day' ? 'over the day' : t === 'week' ? 'across the week' : t === 'month' ? 'across the month' : 'across the year'}</h2>
    <p class="rd-note">${note}${t === 'month' || t === 'year' ? ' Averages are “average recorded pain”: they describe the scores that were written down, not pain throughout the day.' : ''}</p>
    ${chart}${legend}${evHtml}${detail}</section>`;
}

function statCards(m) {
  const s = m.stats;
  const card = (big, small, sub = '') => `<div class="rd-stat"><b>${big}</b><span>${small}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `<div class="rd-stats">
    ${card(s.entries, 'journal entries', s.checkins ? `incl. ${plural(s.checkins, 'check-in')}` : '')}
    ${card(s.readings, 'pain readings', s.untimed ? `${s.untimed} without a time` : s.entries ? `${s.entries - s.readings} entries not scored` : '')}
    ${card(s.readings ? (s.min === s.max ? `${s.min}/10` : `${s.min}–${s.max}<em>/10</em>`) : '–', 'recorded pain range')}
    ${card(s.avg != null ? `${s.avg}<em>/10</em>` : '–', 'average recorded pain', s.daysScored > 1 ? `mean of ${s.daysScored} daily averages` : s.daysScored ? 'one day with scores' : '')}
    ${m.period.type === 'day' ? '' : card(`${s.daysWithEntries}<em>/${s.days}</em>`, 'days with entries', s.future ? `${s.future} still to come` : '')}
  </div>`;
}

function itemsList(m, arr, sidBase, cls = '') {
  if (!arr?.length) return '';
  return `<ul class="rd-list ${cls}">${arr.map((it, i) => `<li data-sid="${sidBase}.${i}">${esc(it.text)} ${refsOf(m, it.refs)}</li>`).join('')}</ul>`;
}
function panel(m, title, arr, sidBase, cls) {
  return `<div class="rd-panel ${cls}"><div class="rd-panel-h">${esc(title)}</div>${arr?.length ? arr.map((it, i) => `<div class="rd-pi" data-sid="${sidBase}.${i}"><b>${esc(it.activity)}</b><p>${esc(it.text)} ${refsOf(m, it.refs)}</p></div>`).join('') : '<p class="rd-none">Nothing recorded for this.</p>'}</div>`;
}

export function reportHTML(m, narrative, { audience = 'doctor', review = {}, logo = '/brand/dr-pocket-horizontal.svg', generatedAt = null, pdf = false } = {}) {
  const a = audience === 'me' ? 'me' : 'doctor';
  const L = AUD[a];
  const n = narrative?.[a] || {};
  const s = m.stats; const p = m.period;
  const title = m.problem?.title || 'All problems';
  const where = m.problem ? [m.problem.side && m.problem.side !== 'none' ? cap(m.problem.side === 'both' ? 'both sides' : m.problem.side) : '', m.problem.area].filter(Boolean).join(' ') : '';
  const onset = m.problem?.started_on ? `Onset reported: ${dayFull(m.problem.started_on)}` : '';
  const confirmed = review.status === 'confirmed';
  const status = confirmed
    ? `<div class="rd-status ok"><b>Reviewed by the patient</b> on ${esc(fmtStamp(review.confirmed_at, m.tz))}. Patient-reported information; not verified by a clinician.</div>`
    : `<div class="rd-status draft"><b>Draft</b>: awaiting the patient’s review.</div>`;
  const symLine = m.symptoms.length ? `<p class="rd-kv"><b>Symptoms recorded</b> ${m.symptoms.slice(0, 6).map((x) => `${esc(x.name)} <span class="muted">×${x.n}</span>`).join(' · ')}</p>` : '';
  const sum = n.summary?.length ? `<div class="rd-summary" data-sid="${a}.summary">${n.summary.map((it, i) => `<span data-sid="${a}.summary.${i}">${esc(it.text)} ${refsOf(m, it.refs)}</span>`).join(' ')}</div>` : '';

  const actTable = m.activities.length ? `<div class="rd-sub-h">Activities in the journal</div>
    <table class="rd-at"><thead><tr><th>Activity or exercise</th><th>Entries</th><th>Pain recorded in the same entry</th></tr></thead><tbody>
    ${m.activities.slice(0, 10).map((x) => `<tr><td>${esc(x.name)}</td><td>${x.n}</td><td>${x.scores.length ? `${x.min === x.max ? x.min : `${x.min}–${x.max}`}/10 <span class="muted">(${plural(x.scores.length, 'score')})</span>` : 'Not scored'}</td></tr>`).join('')}</tbody></table>
    <p class="rd-note">Counts of what was written down together. They do not show that an activity caused or relieved pain.</p>` : '';
  const others = m.events.filter((e) => !e.onChart);
  const attention = n.attention?.length ? `<div class="rd-attn"><div class="rd-panel-h">Mention to a clinician promptly</div>${itemsList(m, n.attention, `${a}.attention`)}</div>` : '';
  const sec3 = `<section class="rd-sec"><h2><span>03</span>Activities, symptoms and events</h2>
    ${attention}
    <div class="rd-panels">${panel(m, L.harder, n.harder_with, `${a}.harder_with`, 'warm')}${panel(m, L.easier, n.easier_after, `${a}.easier_after`, 'cool')}</div>
    <p class="rd-note">Observed associations only. “After” means it was recorded afterwards, not that one caused the other.</p>
    ${n.sequences?.length ? `<div class="rd-sub-h">${L.seq}</div><div class="rd-seq">${n.sequences.map((it, i) => `<div class="rd-seq-i" data-sid="${a}.sequences.${i}"><div class="rd-seq-l">${esc(it.label)}</div><p>${esc(it.text)} ${refsOf(m, it.refs)}</p></div>`).join('')}</div>` : ''}
    ${n.function_effects?.length ? `<div class="rd-sub-h">${L.func}</div>${itemsList(m, n.function_effects, `${a}.function_effects`)}` : ''}
    ${n.treatments?.length ? `<div class="rd-sub-h">${L.treat}</div>${itemsList(m, n.treatments, `${a}.treatments`)}` : ''}
    ${actTable}
    ${others.length ? `<div class="rd-sub-h">Other recorded events</div><ul class="rd-list">${others.map((e) => `<li><b>${esc(e.title)}.</b> ${esc(e.text)} ${refsOf(m, e.refs)}</li>`).join('')}</ul>` : ''}
  </section>`;

  const missAll = [...(n.missing || []), ...m.missing];
  const sec4 = `<section class="rd-sec"><h2><span>04</span>Questions and missing information</h2>
    <div class="rd-two">
      <div><div class="rd-sub-h">${L.q}</div>${n.questions?.length ? `<ul class="rd-list q">${n.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : '<p class="rd-none">None suggested.</p>'}</div>
      <div><div class="rd-sub-h">${L.miss}</div>${missAll.length ? `<ul class="rd-list muted">${missAll.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : '<p class="rd-none">Nothing obvious.</p>'}</div>
    </div>
    ${a === 'me' && n.track_next?.length ? `<div class="rd-sub-h">${L.track}</div><ul class="rd-list">${n.track_next.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
    <p class="rd-note">Missing information is not proof that a symptom was absent.</p>
  </section>`;

  const adds = review.additions || []; const cors = review.corrections || [];
  const sec5 = adds.length || cors.length ? `<section class="rd-sec rd-adds"><h2><span>05</span>Patient additions and clarifications</h2>
    <p class="rd-note">Written by the patient after reading this report. The original journal entries are kept unchanged in the table below.</p>
    <ul class="rd-addl">
      ${cors.map((c) => `<li class="${c.status === 'pending' ? 'pending' : ''}"><div class="rd-add-h">${esc(dayFull(zoned(c.at, m.tz).key))} · Correction${c.status === 'pending' ? ' (not yet applied)' : ''}</div><div class="rd-add-t">About: ${esc(c.target?.label || 'the report')}</div><p>${esc(c.text)}</p>${c.pain !== undefined && c.status !== 'pending' ? `<div class="rd-add-t">Pain score used in this report: ${c.pain == null ? 'removed' : `${c.pain}/10`} (originally ${c.target?.original ?? 'not scored'}).</div>` : ''}</li>`).join('')}
      ${adds.map((x) => `<li><div class="rd-add-h">${esc(dayFull(zoned(x.at, m.tz).key))} · Added context</div><p>${esc(x.text)}</p></li>`).join('')}
    </ul></section>` : '';

  const corrBy = {};
  for (const c of cors) if (c.target?.type === 'entry') (corrBy[c.target.ref] ||= []).push(c);
  const blank = (v) => v || '<span class="nr">Not recorded</span>';
  const tableRows = [];
  const emptyRun = [];
  const flush = () => {
    if (!emptyRun.length) return;
    const a0 = emptyRun[0]; const a1 = emptyRun[emptyRun.length - 1];
    tableRows.push(`<tr class="gap"><td>${a0 === a1 ? dayWd(a0) : `${dayShort(a0)} – ${dayShort(a1)}`}</td><td colspan="4">No entries</td></tr>`);
    emptyRun.length = 0;
  };
  for (const d of m.days) {
    if (!d.rows.length) { if (!d.future && (p.type === 'week' || p.type === 'month')) emptyRun.push(d.key); continue; }
    flush();
    for (const r of d.rows) {
      const e = r.e; const resp = [];
      if (e.symptoms?.length) resp.push(e.symptoms.join(', '));
      if (e.triggers) resp.push(`Worse with: ${e.triggers}`);
      if (e.relief) resp.push(`Eased by: ${e.relief}`);
      if (e.impact) resp.push(`Affected: ${e.impact}`);
      if (r.checkin && e.checkin) {
        const c = e.checkin; const bits = [];
        if (c.rating) bits.push(`day rated ${c.rating}/5`);
        if (c.sleep_h != null || c.sleep_q) bits.push(`sleep ${[c.sleep_h != null ? `${c.sleep_h} h` : '', c.sleep_q ? c.sleep_q.toLowerCase() : ''].filter(Boolean).join(', ')}`);
        if (c.energy) bits.push(`energy ${c.energy.toLowerCase()}`);
        if (c.mood) bits.push(`mood ${c.mood.toLowerCase()}`);
        resp.push(cap(bits.join(' · ')));
      }
      const ctx = [m.problems.length > 1 && !m.problem && r.problem ? r.problem : '', r.checkin ? 'End-of-day check-in' : cap(activityPhrase(e))].filter(Boolean).join(' · ');
      const pain = r.corrected ? `${r.pain != null ? `${r.pain}` : '–'} <small class="corr-n">corrected from ${r.painOriginal ?? 'not scored'}</small>` : r.pain != null ? `${r.pain}` : '<span class="nr">Not scored</span>';
      const cs = corrBy[r.ref] || [];
      tableRows.push(`<tr id="src-${r.ref}" data-day="${r.key}"><td><b>${esc(dayWd(r.key))}</b><br>${r.timed ? r.time : '<span class="nr">Time not recorded</span>'}<span class="rid">${r.ref}</span></td><td>${blank(esc(ctx))}</td><td class="pn">${pain}</td><td>${blank(esc(resp.join('. ')))}</td><td class="orig">${e.body?.trim() ? `<div class="q">${esc(e.body.trim())}</div>` : '<span class="nr">Not recorded</span>'}${cs.map((c) => `<div class="corr">Patient correction, ${esc(dayShort(zoned(c.at, m.tz).key))}${c.status === 'pending' ? ' (not yet applied)' : ''}: ${esc(c.text)}</div>`).join('')}</td></tr>`);
    }
  }
  flush();
  const sec6 = `<section class="rd-sec rd-src"><h2><span>${sec5 ? '06' : '05'}</span>Chronological record</h2>
    <p class="rd-note">Every entry in the period, oldest first. The last column is the patient’s original note, word for word; other columns come from the entry’s recorded fields. “Not recorded” and “Not scored” mark missing information, not zero pain.${s.corrected ? ' Corrected scores show the original value too.' : ''}</p>
    ${tableRows.length ? `<table class="rd-table"><thead><tr><th>Date and time</th><th>Activity or context</th><th>Pain /10</th><th>Symptoms and response</th><th>Original patient note</th></tr></thead><tbody>${tableRows.join('')}</tbody></table>` : '<div class="rd-empty">No entries in this period.</div>'}
  </section>`;

  return `<article class="rdoc${pdf ? ' pdf' : ''}" data-audience="${a}">
    <header class="rd-head">
      <div class="rd-id">
        <h1>${esc(title)}</h1>
        <p class="rd-subt">${L.sub}</p>
        <p class="rd-meta">${TYPES[p.type].toUpperCase()} REPORT · ${esc(m.label)}</p>
        <p class="rd-range">${p.type === 'day' ? `Date: ${esc(dayWd(p.start))} ${p.start.slice(0, 4)}` : `Start: ${esc(dayWd(p.start))} ${p.start.slice(0, 4)} · End: ${esc(dayWd(p.end))} ${p.end.slice(0, 4)}`}</p>
        <p class="rd-cov">${esc(coverageLine(m))}</p>
      </div>
      <img class="rd-logo" src="${esc(logo)}" alt="Dr Pocket" width="150" height="35">
    </header>
    ${status}
    ${painSection(m)}
    <section class="rd-sec"><h2><span>02</span>Summary</h2>
      ${where || onset ? `<p class="rd-kv">${[where ? `<b>Location</b> ${esc(where)}` : '', onset ? esc(onset) : '', m.problem?.diagnosis ? `<b>Diagnosis recorded</b> ${esc(m.problem.diagnosis)}` : ''].filter(Boolean).join(' · ')}</p>` : ''}
      ${sum}
      ${statCards(m)}
      ${symLine}
      ${n.changes?.length ? `<div class="rd-sub-h">Changes over the period</div>${itemsList(m, n.changes, `${a}.changes`)}` : ''}
    </section>
    ${sec3}${sec4}${sec5}${sec6}
    <footer class="rd-foot">
      <p>Patient-reported information from the Dr Pocket journal. Not a diagnosis or a treatment plan. Statistics and charts are calculated directly from the entries; the written explanations were drafted by Claude, Anthropic’s AI, from the same entries, and each statement links to its sources (E-numbers in the table).${generatedAt ? ` Created ${esc(fmtStamp(generatedAt, m.tz))} (${esc(m.tz)}).` : ''}</p>
    </footer>
  </article>`;
}

/* ---------- styles: the same sheet for the app preview and the PDF ---------- */
export const REPORT_CSS = `
.rdoc{--n:#0B2342;--t:#006F7F;--t2:#0A8394;--mut:#5A6B7D;--ln:#E1E8EE;--soft:#F1F7F8;--warm:#C2410C;--warm-soft:#FFF3EA;--cool-soft:#EAF6F4;
  background:#fff;color:var(--n);font:400 14px/1.5 'Montserrat',system-ui,sans-serif;padding:22px 18px 18px;border-radius:18px;max-width:820px;margin:0 auto;
  box-shadow:0 1px 2px rgba(11,35,66,.06),0 6px 22px rgba(11,35,66,.07);overflow-wrap:anywhere;color-scheme:light;position:relative}
.rdoc::before{content:"";position:absolute;left:0;right:0;top:0;height:6px;border-radius:18px 18px 0 0;background:linear-gradient(90deg,#00C7D9 0 18%,#006F7F 18%)}
.rdoc *{box-sizing:border-box}
.rdoc .muted{color:var(--mut)}
.rd-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-top:6px}
.rd-head h1{margin:0;font-size:1.9em;line-height:1.1;font-weight:800;letter-spacing:-.015em}
.rd-subt{margin:4px 0 6px;color:var(--t);font-weight:700;font-size:1.05em}
.rd-meta{margin:0;font-size:.8em;font-weight:700;letter-spacing:.06em;color:var(--n)}
.rd-range,.rd-cov{margin:2px 0 0;font-size:.86em;color:var(--mut)}
.rd-cov{color:var(--n);font-weight:600}
.rd-logo{width:132px;height:auto;flex:none;margin-top:4px}
.rd-status{margin:14px 0 4px;padding:9px 12px;border-radius:10px;font-size:.86em;border:1px solid}
.rd-status.draft{background:#FFF8E6;border-color:#F1D48A;color:#6B4A00}
.rd-status.ok{background:#EAF6F4;border-color:#B7DDD7;color:#0B4D45}
.rd-sec{margin-top:22px}
.rd-sec h2{display:flex;align-items:baseline;gap:10px;margin:0 0 8px;font-size:1.22em;font-weight:700;line-height:1.25;break-after:avoid}
.rd-sec h2 span{color:var(--t);font-weight:800;font-size:.86em;letter-spacing:.04em;flex:none;white-space:nowrap}
.rd-sec h2 span::after{content:" /";color:#9FB1BF;font-weight:600}
.rd-sub-h{margin:16px 0 6px;font-weight:700;font-size:1em;break-after:avoid}
.rd-note{margin:4px 0 10px;font-size:.78em;color:var(--mut);line-height:1.45}
.rd-legend{margin:6px 0 0;font-size:.76em;color:var(--mut);line-height:1.9}
.rd-legend .lg{display:inline-block;vertical-align:-1px;margin:0 3px 0 6px}
.lg.dot{width:9px;height:9px;border-radius:50%;background:#006F7F}
.lg.sq{width:9px;height:9px;border:2px solid #006F7F;border-radius:2px}
.lg.bar{width:6px;height:13px;border-radius:3px;background:#9FD3DA;vertical-align:-3px!important}
.lg.cov{width:9px;height:9px;border-radius:2px;background:#006F7F}
.lg.cov-ring{width:9px;height:9px;border-radius:2px;border:1.5px solid #006F7F}
.lg.cov-none{width:10px;height:0;border-top:1.5px solid #B9C5CF;vertical-align:3px!important}
.lg.cov-fut{width:9px;height:9px;border-radius:2px;background:#EEF2F5}
.rd-chart{background:var(--soft);border-radius:14px;padding:10px 8px 4px;break-inside:avoid}
.rd-chart svg,.wk svg,.rd-months svg{display:block;width:100%;height:auto}
.rd-few{margin:8px 0 0;padding:7px 10px;border-radius:8px;background:#FFF8E6;color:#6B4A00;font-size:.84em;font-weight:500}
.rd-empty{background:var(--soft);border-radius:14px;padding:18px;color:var(--mut);font-weight:500;text-align:center}
.wk{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.wk-p{background:var(--soft);border-radius:12px;padding:8px 6px 4px;break-inside:avoid;min-width:0}
.wk-h{display:flex;justify-content:space-between;align-items:baseline;gap:4px;padding:0 4px 2px;font-size:.84em}
.wk-h span{font-size:.82em;color:var(--mut)}
.wk-empty{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;min-height:82px;margin:4px;border-radius:9px;background:#fff;color:var(--mut);font-weight:600;font-size:.86em;padding:6px}
.wk-empty small{font-weight:400;font-size:.82em;margin-top:2px}
.wk-empty.future{background:repeating-linear-gradient(135deg,#fff 0 6px,#F3F6F8 6px 12px)}
.rd-events{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}
.rd-events li{display:flex;gap:10px;align-items:flex-start;background:var(--warm-soft);border-left:3px solid var(--warm);border-radius:0 10px 10px 0;padding:8px 10px;break-inside:avoid}
.rd-events b{color:#7A2A07;font-size:.92em}
.rd-events p{margin:2px 0 0;font-size:.88em}
.evn{flex:none;width:20px;height:20px;border-radius:50%;background:var(--warm);color:#fff;font-weight:700;font-size:.75em;display:grid;place-items:center;margin-top:1px}
.rd-readings{list-style:none;margin:10px 0 0;padding:0;font-size:.86em}
.rd-readings li{display:grid;grid-template-columns:62px 62px 1fr;gap:8px;padding:5px 2px;border-bottom:1px solid var(--ln)}
.rd-readings .t,.rd-readings .p{font-weight:600}
.rd-summary{background:var(--soft);border-radius:14px;padding:12px 14px;margin:6px 0 12px;font-size:.98em;line-height:1.6}
.rd-kv{margin:4px 0 8px;font-size:.88em}
.rd-kv b{font-weight:700;margin-right:4px}
.rd-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0}
.rd-stat{background:var(--soft);border-radius:12px;padding:10px 12px;break-inside:avoid}
.rd-stat b{display:block;font-size:1.55em;font-weight:800;color:var(--t);line-height:1.1}
.rd-stat b em{font-style:normal;font-size:.55em;font-weight:700;margin-left:1px}
.rd-stat span{display:block;font-size:.8em;color:var(--n);margin-top:2px;font-weight:500}
.rd-stat small{display:block;font-size:.72em;color:var(--mut)}
.rd-panels{display:grid;gap:10px}
.rd-panel{border-radius:14px;padding:12px 14px;break-inside:avoid}
.rd-panel.warm{background:var(--warm-soft)}
.rd-panel.cool{background:var(--cool-soft)}
.rd-panel-h{font-size:.74em;font-weight:800;letter-spacing:.07em;text-transform:uppercase;margin-bottom:6px}
.rd-panel.warm .rd-panel-h{color:var(--warm)}
.rd-panel.cool .rd-panel-h{color:var(--t)}
.rd-pi{margin:8px 0 0}
.rd-pi b{font-size:.98em}
.rd-pi p{margin:1px 0 0;font-size:.86em;color:#33475B}
.rd-none{margin:2px 0;color:var(--mut);font-size:.86em}
.rd-attn{background:#FDE8EA;border-left:3px solid #C8102E;border-radius:0 12px 12px 0;padding:10px 12px;margin-bottom:12px;break-inside:avoid}
.rd-attn .rd-panel-h{color:#A50D24}
.rd-seq{display:grid;gap:10px}
.rd-seq-i{break-inside:avoid}
.rd-seq-l{font-size:.74em;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--t)}
.rd-seq-i p{margin:2px 0 0;font-size:.93em}
.rd-list{margin:4px 0;padding-left:18px}
.rd-list li{margin:4px 0;font-size:.93em}
.rd-list.muted li{color:#3D5064}
.rd-two{display:grid;gap:4px}
.rdoc .ref{display:inline-block;font-size:.68em;font-weight:700;color:var(--t);background:#E3F3F5;border-radius:5px;padding:0 4px;margin:0 1px;text-decoration:none;vertical-align:1px;line-height:1.5}
.rd-at,.rd-mt{width:100%;border-collapse:collapse;font-size:.86em}
.rd-at th,.rd-mt th{white-space:nowrap;text-align:left;font-weight:700;font-size:.86em;color:var(--mut);border-bottom:2px solid var(--ln);padding:5px 6px}
.rd-at td,.rd-mt td{border-bottom:1px solid var(--ln);padding:6px}
.rd-months details{margin-top:8px;background:var(--soft);border-radius:12px;padding:8px 10px}
.rd-months summary{cursor:pointer;font-weight:600;font-size:.9em}
.rd-addl{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.rd-addl li{background:#F4F1FB;border-left:3px solid #6B4FBB;border-radius:0 12px 12px 0;padding:9px 12px;break-inside:avoid}
.rd-addl li.pending{background:#FFF8E6;border-left-color:#C99A1A}
.rd-add-h{font-size:.74em;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#4B3591}
.rd-add-t{font-size:.82em;color:var(--mut);margin-top:2px}
.rd-addl p{margin:4px 0 0;white-space:pre-wrap}
.rd-table{width:100%;border-collapse:collapse;font-size:.8em;table-layout:fixed}
.rd-table thead{display:table-header-group}
.rd-table th{background:var(--t);color:#fff;text-align:left;font-weight:700;padding:8px 7px;vertical-align:bottom}
.rd-table th:first-child{border-radius:8px 0 0 0}.rd-table th:last-child{border-radius:0 8px 0 0}
.rd-table td{padding:7px;vertical-align:top;border-bottom:1px solid var(--ln)}
.rd-table tbody tr:nth-child(even) td{background:#F7FAFB}
.rd-table tr{break-inside:avoid}
.rd-table col,.rd-table th:nth-child(1){width:15%}.rd-table th:nth-child(2){width:19%}.rd-table th:nth-child(3){width:10%}.rd-table th:nth-child(4){width:22%}
.rd-table tr.gap td{color:var(--mut);font-style:italic}
.rd-table .pn{font-weight:700;font-size:1.05em}
.rd-table .pn .nr{font-weight:400;font-size:.95em}
.rd-table .rid{display:block;font-size:.82em;color:var(--t);font-weight:700;margin-top:2px}
.rd-table .q{white-space:pre-wrap;font-style:italic;color:#24384C}
.rd-table .q::before{content:"“"}.rd-table .q::after{content:"”"}
.rd-table .corr{margin-top:6px;padding:5px 7px;border-radius:6px;background:#F4F1FB;color:#3E2C7A;font-size:.95em}
.rd-table .corr-n{display:block;font-weight:500;font-size:.72em;color:#6B4FBB}
.rdoc .nr{color:#8496A6;font-style:normal}
.rd-table tr.flash td{background:#FFF3C4!important;transition:background .3s}
.rd-foot{margin-top:22px;padding-top:10px;border-top:1px solid var(--ln);font-size:.74em;color:var(--mut)}
.rd-foot p{margin:0}
@media (min-width:640px){
  .rdoc{padding:30px 32px 22px;font-size:14.5px}
  .wk{grid-template-columns:repeat(4,minmax(0,1fr))}
  .rd-stats{grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}
  .rd-panels,.rd-two{grid-template-columns:1fr 1fr;gap:14px}
  .rd-logo{width:150px}
}
@media (max-width:520px){
  .rd-table,.rd-table tbody,.rd-table tr,.rd-table td{display:block;width:100%}
  .rd-table thead{display:none}
  .rd-table tr{border:1px solid var(--ln);border-radius:12px;margin:0 0 8px;overflow:hidden;background:#fff}
  .rd-table td{border:0;padding:4px 10px;background:transparent!important}
  .rd-table tbody tr:nth-child(even){background:#F7FAFB}
  .rd-table td:first-child{padding-top:9px}
  .rd-table td:last-child{padding-bottom:10px}
  .rd-table td:nth-child(n+2)::before{display:inline;margin-right:6px;font-size:.82em;font-weight:700;color:var(--mut);font-style:normal}
  .rd-table td.orig::before{display:block!important}
  .rd-table .corr-n{display:inline;margin-left:4px}
  .rd-table td:nth-child(2)::before{content:"Activity or context"}
  .rd-table td:nth-child(3)::before{content:"Pain /10"}
  .rd-table .pn{font-size:1em}
  .rd-table td:nth-child(4)::before{content:"Symptoms and response"}
  .rd-table td:nth-child(5)::before{content:"Original patient note"}
  .rd-table tr.gap td:nth-child(2)::before{content:none}
  .rd-table .rid{display:inline;margin-left:6px}
  .rd-head h1{font-size:1.6em}
  .rd-logo{width:104px}
}
.rdoc.pdf{box-shadow:none;border-radius:0;padding:0;max-width:none;font-size:10.4pt}
.rdoc.pdf::before{display:none}
.rdoc.pdf .screen-only{display:none}
.rdoc.pdf .wk{grid-template-columns:repeat(4,minmax(0,1fr))}
.rdoc.pdf .rd-stats{grid-template-columns:repeat(5,minmax(0,1fr))}
.rdoc.pdf .rd-panels,.rdoc.pdf .rd-two{grid-template-columns:1fr 1fr;gap:14px}
.rdoc.pdf .rd-src{break-before:page}
.rdoc.pdf .rd-src h2{margin-top:0}
.rdoc.pdf .rd-sec{margin-top:18px}
.rdoc.pdf .rd-logo{width:150px}
`;

// A complete HTML page around a report, for the PDF. fontCss embeds Montserrat so servers need no fonts.
export function pageHTML(body, { fontCss = '', title = 'Dr Pocket report' } = {}) {
  return `<!doctype html><html lang="en-ZA"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${fontCss}
@page{size:A4;margin:16mm 14mm 18mm}
html,body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
${REPORT_CSS}</style></head><body>${body}</body></html>`;
}
