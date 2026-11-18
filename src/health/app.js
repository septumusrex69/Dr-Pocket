// Dr Pocket: a personal health record and symptom journal (the brand + app guide of 16 Nov 2026).
// Problems hold dated entries: the person's own words (typed or dictated), an optional pain score,
// symptom tags, activity, triggers, relief and impact, plus exercise logs and files. Insights are
// worked out on the device from what was recorded; the doctor summary is written by Claude only when
// the person asks for it and agrees to send the entries.
import './health.css';
import { sb, auth, problems, entries, files, reports, routines } from './db.js';
import { dictation } from './dictate.js';
import { icon, mark, lockup } from './icons.js';
import { MODES, currentMode, applyMode } from './appearance.js';
import { VAPID_PUBLIC_KEY } from './config.js';
import { buildModel, periodFor, reportHTML, REPORT_CSS, coverageLine, zoned, dayWd, dayShort, activityPhrase } from './report.js';

const app = document.getElementById('app');
let session = null;
let stopDictation = [];

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = app) => root.querySelector(sel);
const $$ = (sel, root = app) => [...root.querySelectorAll(sel)];
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
const params = () => new URLSearchParams(location.hash.split('?')[1] || '');

const AREAS = ['Head', 'Face / jaw', 'Eyes', 'Ears / nose / throat', 'Neck', 'Shoulder', 'Upper arm', 'Elbow', 'Forearm', 'Wrist / hand', 'Chest', 'Heart', 'Lungs / breathing', 'Upper back', 'Lower back', 'Abdomen / stomach', 'Pelvis / groin', 'Hip', 'Thigh', 'Knee', 'Lower leg / calf', 'Ankle / foot', 'Skin', 'Mental health / sleep', 'Whole body', 'Other'];
const SIDES = { none: '', left: 'Left', right: 'Right', both: 'Both sides' };
const STATUS = { active: 'Active', improving: 'Improving', resolved: 'Resolved', archived: 'Archived' };
const SYMPTOMS = ['Pain', 'Stiffness', 'Instability', 'Clicking / catching', 'Weakness', 'Numbness / tingling', 'Swelling', 'Fatigue'];
const ACTIVITIES = ['Computer work', 'Sitting', 'Standing', 'Walking', 'Driving', 'Phone use', 'Housework', 'Lifting / carrying', 'Exercise', 'Sport', 'Gardening', 'Sleeping', 'Lying down', 'Resting'];
// Activities as a list; older entries only have the single text field.
const actsOf = (e) => (e.activities?.length ? e.activities : e.activity ? e.activity.split(', ').filter(Boolean) : []);

const D = (d) => new Date(d);
const fmtDate = (d) => D(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (d) => D(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
const fmtWhen = (e) => (e.time_known === false ? `${fmtDate(e.at)} · time not recorded` : `${fmtDate(e.at)}, ${fmtTime(e.at)}`);
const dayKey = (d) => { const x = D(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
function dayLabel(d) {
  const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (dayKey(d) === dayKey(t)) return 'Today';
  if (dayKey(d) === dayKey(y)) return 'Yesterday';
  return D(d).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
}
const localInput = (d = new Date()) => { const x = D(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const n = (k, word, many = `${word}s`) => `${k} ${k === 1 ? word : many}`;
const where = (p) => [SIDES[p.side], p.area].filter(Boolean).join(' ');
const painLevel = (v) => (v <= 3 ? 'low' : v <= 6 ? 'mid' : 'high');
const painChip = (v) => (v == null ? '' : `<span class="pain-chip ${painLevel(v)}">Pain ${v}/10</span>`);

function busy(btn, on, text) {
  if (!btn) return;
  if (on) { btn.dataset.t = btn.innerHTML; btn.textContent = text || 'Saving…'; btn.disabled = true; }
  else { btn.innerHTML = btn.dataset.t || btn.innerHTML; btn.disabled = false; }
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}
const errMsg = (e) => {
  const m = e?.message || String(e);
  return /Failed to fetch|NetworkError|Load failed/i.test(m) ? 'No connection. Check your signal and try again.' : m;
};

/* ---------- frame: header + bottom navigation ---------- */
const NAV = [['home', '#/', 'Home', 'home'], ['problems', '#/problems', 'Problems', 'folder'], ['add', '#/add', 'Add Note', 'plus'], ['timeline', '#/timeline', 'Timeline', 'list'], ['reports', '#/reports', 'Reports', 'report']];

function shell({ back = null, tab = null, body, foot = '' }) {
  stopDictation.forEach((s) => s.stop()); stopDictation = [];
  app.innerHTML = `
    <header class="top">
      <div class="top-l">${back ? `<a class="icon-btn" href="${back}" aria-label="Back">${icon('back')}</a>` : ''}</div>
      <a class="top-c" href="#/" aria-label="Dr Pocket home">${lockup(32)}</a>
      <div class="top-r">${session ? `<a class="icon-btn" href="#/settings" aria-label="Settings">${icon('settings')}</a>` : ''}</div>
    </header>
    <main class="page">${body}</main>
    ${foot}
    ${session ? `<nav class="nav" aria-label="Main">${NAV.map(([k, href, label, ic]) => `<a href="${href}" class="${k === 'add' ? 'nav-add' : ''}" ${tab === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`).join('')}</nav>` : ''}`;
  document.body.classList.toggle('signed-in', !!session);
  document.body.classList.toggle('has-cta', !!foot);
  window.scrollTo(0, 0);
}

/* ---------- shared pieces ---------- */
function chipsPicker(host, { options, selected = [], multi = true, label, other = true }) {
  let sel = [...selected];
  const all = () => [...new Set([...options, ...sel])];
  const paint = () => {
    host.innerHTML = `<div class="lbl">${esc(label)}</div><div class="chips" role="group" aria-label="${esc(label)}">
      ${all().map((o) => `<button type="button" class="chip-btn" aria-pressed="${sel.includes(o)}" data-v="${esc(o)}">${sel.includes(o) ? icon('check') : ''}${esc(o)}</button>`).join('')}
      ${other ? '<button type="button" class="chip-btn add" data-other>+ Other</button>' : ''}</div>`;
    host.querySelectorAll('[data-v]').forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.v;
        if (sel.includes(v)) sel = sel.filter((x) => x !== v);
        else sel = multi ? [...sel, v] : [v];
        paint();
      };
    });
    host.querySelector('[data-other]')?.addEventListener('click', () => {
      const v = (prompt(`Add your own: ${label.toLowerCase()}`) || '').trim().slice(0, 40);
      if (v) { sel = multi ? [...new Set([...sel, v])] : [v]; paint(); }
    });
  };
  paint();
  return () => sel;
}

function painPicker(host, value = null, label = 'Pain level') {
  let v = value;
  const paint = () => {
    host.innerHTML = `<div class="lbl">${esc(label)} <span class="hint">${v == null ? 'not recorded' : `${v}/10`}</span></div>
      <div class="pain" role="group" aria-label="${esc(label)}, 0 none to 10 worst">${Array.from({ length: 11 }, (_, i) => `<button type="button" data-v="${i}" class="${painLevel(i)}" aria-pressed="${v === i}">${i}</button>`).join('')}</div>
      <div class="pain-ends"><span>0 none</span><span>10 worst</span></div>`;
    host.querySelectorAll('button').forEach((b) => { b.onclick = () => { const k = Number(b.dataset.v); v = v === k ? null : k; paint(); }; });
  };
  paint();
  return () => v;
}

function filePicker(host, onChange = () => {}) {
  const picked = [];
  host.innerHTML = `<div class="lbl">Photos, X-rays, scans or letters</div>
    <div class="row-btns">
      <label class="btn">${icon('camera')}<input type="file" accept="image/*" capture="environment" hidden> Take photo</label>
      <label class="btn">${icon('clip')}<input type="file" accept="image/*,application/pdf" multiple hidden> Add file</label>
    </div><ul class="picked"></ul>`;
  const list = host.querySelector('.picked');
  const paint = () => {
    list.innerHTML = picked.map((f, i) => `<li><span>${esc(f.name)}</span><button type="button" class="link" data-i="${i}">Remove</button></li>`).join('');
    list.querySelectorAll('button').forEach((b) => { b.onclick = () => { picked.splice(Number(b.dataset.i), 1); paint(); }; });
    onChange(picked.length);
  };
  host.querySelectorAll('input').forEach((inp) => {
    inp.onchange = () => {
      for (const f of inp.files) { if (f.size > 25e6) toast(`${f.name} is over 25 MB.`); else picked.push(f); }
      inp.value = ''; paint();
    };
  });
  return () => picked.slice();
}

// When did it happen? Never silently "now" for something that happened earlier.
function whenPicker(host, entry = null) {
  let mode = entry ? (entry.time_known === false ? 'date' : 'earlier') : 'now';
  host.innerHTML = `<div class="lbl">When did this happen?</div>
    <div class="seg" role="radiogroup" aria-label="When did this happen">
      <button type="button" role="radio" data-m="now">Just now</button>
      <button type="button" role="radio" data-m="earlier">Date and time</button>
      <button type="button" role="radio" data-m="date">Date only</button>
    </div>
    <input type="datetime-local" class="w-dt" value="${localInput(entry?.at || new Date())}" aria-label="Date and time">
    <input type="date" class="w-d" value="${dayKey(entry?.at || new Date())}" aria-label="Date">`;
  const dt = host.querySelector('.w-dt'); const d = host.querySelector('.w-d');
  const paint = () => {
    host.querySelectorAll('[data-m]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.m === mode)));
    dt.hidden = mode !== 'earlier'; d.hidden = mode !== 'date';
  };
  host.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { mode = b.dataset.m; paint(); }; });
  paint();
  return () => {
    if (mode === 'now') return { at: new Date().toISOString(), time_known: true, now: true };
    if (mode === 'earlier') return { at: new Date(dt.value).toISOString(), time_known: true };
    return { at: new Date(`${d.value}T12:00`).toISOString(), time_known: false };
  };
}

/* ---------- entries: title, summary, timeline rows ---------- */
const RATING = ['', 'Very bad day', 'Bad day', 'OK day', 'Good day', 'Great day'];
function titleOf(e) {
  if (e.kind === 'day') return `End of day · ${RATING[e.checkin?.rating] || 'check-in'}`;
  if (e.kind === 'exercise') return e.exercise?.name || 'Exercise';
  const t = (e.body || '').trim();
  if (!t) return e.pain != null ? 'Pain score' : (e.files?.length ? 'File added' : 'Note');
  const first = t.split(/(?<=[.!?])\s|\n/)[0];
  return first.length > 64 ? `${first.slice(0, 62).trim()}…` : first;
}
function summaryOf(e) {
  if (e.kind === 'day') {
    const c = e.checkin || {}; const bits = [];
    if (c.sleep_h != null) bits.push(`slept ${c.sleep_h} h${c.sleep_q ? ` (${c.sleep_q.toLowerCase()})` : ''}`);
    else if (c.sleep_q) bits.push(`sleep ${c.sleep_q.toLowerCase()}`);
    if (c.energy) bits.push(`energy ${c.energy.toLowerCase()}`);
    if (c.mood) bits.push(`mood ${c.mood.toLowerCase()}`);
    return [bits.join(' · '), e.body].filter(Boolean).join('. ');
  }
  if (e.kind === 'exercise' && e.exercise?.items) {
    const x = e.exercise; const done = x.items.filter((i) => i.done !== false).length;
    const bits = [x.items.length ? `${done} of ${x.items.length} done` : 'Routine done'];
    if (x.minutes) bits.push(`${x.minutes} min`);
    return [bits.join(' · '), e.body].filter(Boolean).join('. ');
  }
  if (e.kind === 'exercise') {
    const x = e.exercise || {}; const bits = [];
    if (x.sets) bits.push(`${x.sets} × ${x.reps || '?'} reps`); else if (x.reps) bits.push(`${x.reps} reps`);
    if (x.weight) bits.push(`${x.weight} kg`); if (x.minutes) bits.push(`${x.minutes} min`); if (x.km) bits.push(`${x.km} km`);
    return [bits.join(' · '), e.body].filter(Boolean).join('. ');
  }
  const t = (e.body || '').trim(); const first = t.split(/(?<=[.!?])\s|\n/)[0];
  return t.slice(first.length).trim();
}
function tagsOf(e) {
  const tags = [];
  if (e.kind === 'day') tags.push(`${icon('moon')}End of day`);
  if (e.kind === 'exercise') tags.push(`${icon('dumbbell')}Exercise`);
  else actsOf(e).slice(0, 2).forEach((a, i) => tags.push(`${i ? '' : icon('walk')}${esc(a)}`));
  (e.symptoms || []).slice(0, 3).forEach((s) => tags.push(esc(s)));
  if (e.files?.length) tags.push(`${icon('image')}${e.files.length}`);
  return tags.map((t) => `<span class="tag">${t}</span>`).join('');
}
function entryRow(e, { showProblem = null, showDay = false } = {}) {
  const time = e.time_known === false ? 'No time' : fmtTime(e.at);
  const lbl = dayLabel(e.at);
  const day = showDay ? `<small>${esc(lbl === 'Today' || lbl === 'Yesterday' ? lbl : D(e.at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }))}</small>` : '';
  return `<li><a class="tl-row" href="#/e/${e.id}">
    <div class="tl-time">${day}<b class="${e.time_known === false ? 'none' : ''}">${time}</b></div>
    <div class="tl-card">
      ${showProblem ? `<div class="tl-prob">${esc(showProblem)}</div>` : ''}
      <div class="tl-title">${esc(titleOf(e))}</div>
      ${summaryOf(e) ? `<div class="tl-sum">${esc(summaryOf(e))}</div>` : ''}
      <div class="tl-tags">${painChip(e.pain)}${tagsOf(e)}</div>
    </div>
    <span class="tl-go">${icon('chevron')}</span>
  </a></li>`;
}
function daySummary(items) {
  const pains = items.filter((e) => e.pain != null).map((e) => e.pain);
  const bits = [n(items.length, 'entry', 'entries')];
  if (pains.length) bits.push(`pain ${Math.min(...pains)}${Math.max(...pains) !== Math.min(...pains) ? `–${Math.max(...pains)}` : ''}/10`);
  const ex = items.filter((e) => e.kind === 'exercise').length;
  if (ex) bits.push(n(ex, 'exercise session'));
  return bits.join(' · ');
}

// The timeline with search, filter and a day picker. Today is open; earlier days fold to one line.
function timeline(host, list, { problemName = null, filters = true } = {}) {
  const today = dayKey(new Date());
  host.innerHTML = `
    ${filters ? `<div class="tl-tools">
      <label class="search">${icon('search')}<input type="search" placeholder="Search entries" aria-label="Search entries"></label>
      <select aria-label="Show"><option value="">All entries</option><option value="note">Notes</option><option value="exercise">Exercise</option><option value="pain">With pain score</option></select>
      <label class="icon-btn boxed" title="Go to a day">${icon('calendar')}<input type="date" aria-label="Go to a day"></label>
    </div>` : ''}
    <p class="filter-note" hidden></p>
    <div class="tl-days"></div>`;
  const q = host.querySelector('input[type=search]'); const kind = host.querySelector('select'); const day = host.querySelector('input[type=date]');
  const note = host.querySelector('.filter-note');
  const paint = () => {
    const text = (q?.value || '').trim().toLowerCase();
    let shown = list;
    if (text) shown = shown.filter((e) => `${e.body} ${e.exercise?.name || ''} ${(e.symptoms || []).join(' ')} ${actsOf(e).join(' ')} ${e.activity_detail || ''} ${e.triggers} ${e.relief} ${e.impact}`.toLowerCase().includes(text));
    if (kind?.value === 'pain') shown = shown.filter((e) => e.pain != null);
    else if (kind?.value) shown = shown.filter((e) => e.kind === kind.value);
    if (day?.value) shown = shown.filter((e) => dayKey(e.at) === day.value);
    const filtered = !!(text || kind?.value || day?.value);
    note.hidden = !filtered;
    note.innerHTML = filtered ? `${n(shown.length, 'entry', 'entries')} found · <button class="link" type="button">Clear</button>` : '';
    note.querySelector('button')?.addEventListener('click', () => { q.value = ''; kind.value = ''; day.value = ''; paint(); });
    const groups = [];
    for (const e of shown) {
      const k = dayKey(e.at);
      if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, items: [] });
      groups[groups.length - 1].items.push(e);
    }
    host.querySelector('.tl-days').innerHTML = groups.length ? groups.map((g) => `
      <details class="tl-day" ${g.k === today || filtered ? 'open' : ''}>
        <summary><span class="tl-day-l">${esc(dayLabel(g.items[0].at))}</span><span class="tl-day-s">${esc(daySummary(g.items))}</span>${icon('down', 'tl-caret')}</summary>
        <ol class="tl rows">${g.items.map((e) => entryRow(e, { showProblem: problemName ? problemName(e) : null })).join('')}</ol>
      </details>`).join('') : `<div class="empty">${filtered ? 'Nothing matches.' : 'Nothing recorded yet.'}</div>`;
  };
  q?.addEventListener('input', paint); kind?.addEventListener('change', paint); day?.addEventListener('change', paint);
  paint();
}

// Pain trend, interactive like a stock chart: drag to move through time, pinch (or scroll) to zoom,
// double-tap a day to see just that day, tap a dot for that entry.
// Only recorded scores are drawn, on a fixed 0–10 axis; a missing score stays missing, never zero.
const HOUR = 36e5; const DAY = 864e5;
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
const PRESETS = [['day', 'Day', DAY], ['week', 'Week', 7 * DAY], ['month', 'Month', 30 * DAY], ['q', '3 months', 91 * DAY], ['all', 'All', 0]];

function mountPainChart(host, list) {
  const pts = list.filter((e) => e.pain != null).map((e) => ({ t: +D(e.at), v: e.pain, e })).sort((a, b) => a.t - b.t);
  const maxT = startOfDay(Date.now()) + DAY;
  // You can always move back at least 30 days; "All" means from your first score.
  const firstT = pts.length ? Math.min(startOfDay(pts[0].t), maxT - DAY) : maxT - 7 * DAY;
  const minT = Math.min(firstT, maxT - 30 * DAY);
  const MIN_SPAN = 2 * HOUR;
  const todayCount = pts.filter((p) => p.t >= maxT - DAY).length;
  let win = todayCount >= 2 ? [maxT - DAY, maxT] : [maxT - 7 * DAY, maxT];
  const clampWin = ([a, b]) => {
    let span = Math.min(Math.max(b - a, MIN_SPAN), maxT - minT);
    a = Math.max(minT, Math.min(a, maxT - span));
    return [a, a + span];
  };
  const W = () => Math.max(260, host.clientWidth - 2);
  const H = 196; const L = 28; const R = 12; const T = 22; const B = 28;

  host.innerHTML = `<figure class="card chart pchart">
    <div class="card-h"><h3>Pain trend</h3>${pts.length ? `<span class="pain-chip ${painLevel(pts[pts.length - 1].v)}">Latest ${pts[pts.length - 1].v}/10</span>` : ''}</div>
    <div class="seg pc-range" role="tablist">${PRESETS.map(([k, l]) => `<button type="button" data-p="${k}">${l}</button>`).join('')}</div>
    <div class="pc-nav">
      <button type="button" class="icon-btn" data-step="-1" aria-label="Earlier">${icon('back')}</button>
      <b class="pc-label"></b>
      <button type="button" class="icon-btn" data-step="1" aria-label="Later">${icon('chevron')}</button>
    </div>
    <div class="pc-tools">
      <button type="button" class="chip-btn small-chip" data-today>Today</button>
      <label class="chip-btn small-chip pc-date">${icon('calendar')}<span>Pick a day</span><input type="date" aria-label="Show one day" max="${dayKey(Date.now())}"></label>
      <button type="button" class="chip-btn small-chip" data-zoom="out" aria-label="Zoom out">−</button>
      <button type="button" class="chip-btn small-chip" data-zoom="in" aria-label="Zoom in">+</button>
    </div>
    <div class="pc-stage"><svg class="pc-main" role="img"></svg><div class="pc-tip" hidden></div></div>
    <figcaption class="small muted pc-cap"></figcaption>
    <p class="pc-hint">Drag to move · pinch or scroll to zoom · double-tap a day to see just that day · tap a dot for its entry</p>
  </figure>`;
  const svg = host.querySelector('.pc-main');
  const tip = host.querySelector('.pc-tip'); const label = host.querySelector('.pc-label'); const cap = host.querySelector('.pc-cap');

  const tickFor = (span) => {
    const steps = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 61 * DAY, 91 * DAY];
    return steps.find((s) => span / s <= 7.2) || 182 * DAY;
  };
  const fmtTick = (t, step, span) => {
    const d = new Date(t);
    if (step < DAY) return d.getHours() === 0 ? d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric' }) : `${String(d.getHours()).padStart(2, '0')}:00`;
    if (span <= 10 * DAY) return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric' });
    if (step >= 30 * DAY) return d.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' });
    return `${d.getDate()} ${d.toLocaleDateString('en-ZA', { month: 'short' })}`;
  };
  const sameDayWin = () => win[1] - win[0] === DAY && win[0] === startOfDay(win[0]);

  function render() {
    const w = W(); const [a, b] = win; const span = b - a;
    const x = (t) => L + ((t - a) / span) * (w - L - R);
    const y = (v) => T + (1 - v / 10) * (H - T - B);
    svg.setAttribute('viewBox', `0 0 ${w} ${H}`); svg.setAttribute('width', w); svg.setAttribute('height', H);
    const inWin = pts.filter((p) => p.t >= a && p.t <= b);
    // grid, ticks, midnight lines with day names when a few days are visible
    const grid = [0, 2, 4, 6, 8, 10].map((v) => `<line x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 7}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`).join('');
    const step = tickFor(span); const ticks = []; const labels = [];
    let t0 = step < DAY ? Math.ceil(a / HOUR) * HOUR : startOfDay(a) + (startOfDay(a) < a ? DAY : 0);
    if (step < DAY) { while (new Date(t0).getHours() % Math.round(step / HOUR)) t0 += HOUR; }
    for (let t = t0; t <= b; t += step) {
      if (step >= DAY) t = startOfDay(t + HOUR * 3); // keep on midnights across clock changes
      const xt = x(t);
      ticks.push(`<line class="tk" x1="${xt}" x2="${xt}" y1="${T}" y2="${H - B}"/>`);
      if (xt > L + 16 && xt < w - R - 16) labels.push(`<text x="${xt}" y="${H - 9}" text-anchor="middle">${fmtTick(t, step, span)}</text>`); // never cut a label at the edge
    }
    let days = '';
    if (span <= 4 * DAY) for (let t = startOfDay(a); t < b; t += DAY) {
      const m = startOfDay(t + 3 * HOUR); const xm = Math.max(L, x(m)); const xe = Math.min(w - R, x(m + DAY));
      if (xe - xm > 34) days += `<text class="dayname" x="${(xm + xe) / 2}" y="${T - 8}" text-anchor="middle">${esc(dayLabel(m) === 'Today' || dayLabel(m) === 'Yesterday' ? dayLabel(m) : new Date(m).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }))}</text>`;
      if (m > a) days += `<line class="midnight" x1="${x(m)}" x2="${x(m)}" y1="${T - 2}" y2="${H - B}"/>`;
    }
    // line: every score when up to ~10 days are visible, otherwise the daily average
    let lp = inWin.map((p) => [p.t, p.v]);
    const avgMode = span > 10 * DAY;
    if (avgMode) {
      const by = {}; inWin.forEach((p) => { (by[dayKey(p.t)] ||= []).push(p.v); });
      lp = Object.entries(by).sort().map(([k, vs]) => [+new Date(`${k}T12:00`), vs.reduce((s, v) => s + v, 0) / vs.length]);
    }
    const path = lp.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = lp.length > 1 ? `${path} L${x(lp[lp.length - 1][0]).toFixed(1)},${y(0)} L${x(lp[0][0]).toFixed(1)},${y(0)} Z` : '';
    const r = span <= 2 * DAY ? 6 : span <= 10 * DAY ? 4.5 : 3;
    svg.innerHTML = `<defs><linearGradient id="pcfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00C7D9" stop-opacity=".3"/><stop offset="1" stop-color="#00C7D9" stop-opacity="0"/></linearGradient>
        <clipPath id="pcclip"><rect x="${L}" y="0" width="${w - L - R}" height="${H}"/></clipPath></defs>
      <g class="grid">${grid}</g><g class="ticks" clip-path="url(#pcclip)">${ticks.join('')}</g><g class="ticks">${labels.join('')}</g><g clip-path="url(#pcclip)">${days}
      ${area ? `<path class="area" d="${area}"/>` : ''}${lp.length > 1 ? `<path class="line" d="${path}"/>` : ''}
      ${inWin.map((p) => `<circle class="dot ${painLevel(p.v)} ${p.e.time_known === false ? 'nt' : ''}" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${r}"/>`).join('')}</g>
      ${!inWin.length ? `<text class="empty-t" x="${(w + L) / 2}" y="${H / 2}" text-anchor="middle">No pain scores here · drag or zoom out</text>` : ''}`;
    // header label and summary
    const last = new Date(b - 1);
    label.textContent = sameDayWin() ? (['Today', 'Yesterday'].includes(dayLabel(a)) ? `${dayLabel(a)}, ${new Date(a).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` : new Date(a).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'short' }))
      : span < DAY && dayKey(a) === dayKey(b - 1) ? `${new Date(a).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}, ${fmtTime(a)}–${fmtTime(b)}`
        : `${new Date(a).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} – ${last.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: last.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })}`;
    const avg = inWin.length ? (inWin.reduce((s, p) => s + p.v, 0) / inWin.length).toFixed(1) : null;
    cap.textContent = inWin.length ? `${n(inWin.length, 'pain score')} · low ${Math.min(...inWin.map((p) => p.v))} · high ${Math.max(...inWin.map((p) => p.v))} · average ${avg}${avgMode ? '. The line shows the daily average.' : ''}` : 'No pain scores in this period.';
    svg.setAttribute('aria-label', `${label.textContent}: ${cap.textContent}`);
    host.querySelectorAll('[data-p]').forEach((bt) => {
      const pr = PRESETS.find((p) => p[0] === bt.dataset.p);
      const on = pr[0] === 'all' ? Math.abs(a - firstT) < HOUR && b >= maxT : pr[0] === 'day' ? sameDayWin() : Math.abs(span - pr[2]) < HOUR;
      bt.setAttribute('aria-selected', String(on));
    });
    host.querySelector('[data-step="1"]').disabled = b >= maxT;
    host.querySelector('[data-step="-1"]').disabled = a <= minT;
    hideTip();
  }
  let raf = 0; const draw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  const setWin = (wn) => { win = clampWin(wn); draw(); };
  const showDay = (t) => setWin([startOfDay(t), startOfDay(t) + DAY]);

  // tooltip for the nearest dot
  function hideTip() { tip.hidden = true; }
  function showTipAt(px, py) {
    const w = W(); const [a, b] = win; const span = b - a;
    const x = (t) => L + ((t - a) / span) * (w - L - R); const y = (v) => T + (1 - v / 10) * (H - T - B);
    let best = null; let bd = 22;
    pts.forEach((p) => { if (p.t < a || p.t > b) return; const d = Math.hypot(x(p.t) - px, y(p.v) - py); if (d < bd) { bd = d; best = p; } });
    if (!best) { hideTip(); return false; }
    tip.innerHTML = `<b>${best.v}/10</b> <span>${esc(fmtWhen(best.e))}</span><br><a href="#/e/${best.e.id}">${esc(titleOf(best.e))} ›</a>`;
    tip.hidden = false;
    const tx = Math.min(Math.max(x(best.t) - 90, 4), w - 184); tip.style.left = `${tx}px`;
    tip.style.top = `${Math.max(y(best.v) - 74, 0)}px`;
    return true;
  }

  // gestures on the main chart: drag = move, two fingers = zoom, double-tap = that day, tap = nearest dot
  const ptrs = new Map(); let g = null; let lastTap = 0;
  const pxToT = (clientX) => { const rc = svg.getBoundingClientRect(); const fx = (clientX - rc.left - L) / (rc.width - L - R); return win[0] + fx * (win[1] - win[0]); };
  svg.addEventListener('pointerdown', (ev) => {
    svg.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ptrs.size === 1) g = { mode: 'pan', x0: ev.clientX, y0: ev.clientY, win0: [...win], moved: false, at: Date.now() };
    if (ptrs.size === 2) { const [p1, p2] = [...ptrs.values()]; g = { mode: 'pinch', d0: Math.abs(p1.x - p2.x) || 1, c0: pxToT((p1.x + p2.x) / 2), win0: [...win], moved: true }; }
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!ptrs.has(ev.pointerId) || !g) return;
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const rc = svg.getBoundingClientRect(); const plot = rc.width - L - R;
    if (g.mode === 'pan' && ptrs.size === 1) {
      const dx = ev.clientX - g.x0;
      if (Math.abs(dx) > 5) g.moved = true;
      if (g.moved) { const span = g.win0[1] - g.win0[0]; setWin([g.win0[0] - (dx / plot) * span, g.win0[1] - (dx / plot) * span]); }
    } else if (g.mode === 'pinch' && ptrs.size === 2) {
      const [p1, p2] = [...ptrs.values()]; const d = Math.abs(p1.x - p2.x) || 1;
      const span = (g.win0[1] - g.win0[0]) * (g.d0 / d);
      const f = (g.c0 - g.win0[0]) / (g.win0[1] - g.win0[0]);
      setWin([g.c0 - f * span, g.c0 + (1 - f) * span]);
    }
  });
  const up = (ev) => {
    if (!ptrs.has(ev.pointerId)) return;
    ptrs.delete(ev.pointerId);
    if (g && g.mode === 'pan' && !g.moved && ev.type === 'pointerup' && Date.now() - g.at < 400) {
      const rc = svg.getBoundingClientRect();
      if (Date.now() - lastTap < 320) { showDay(pxToT(ev.clientX)); lastTap = 0; } else { lastTap = Date.now(); showTipAt(ev.clientX - rc.left, ev.clientY - rc.top) || hideTip(); }
    }
    if (ptrs.size === 0) g = null;
    else if (ptrs.size === 1) { const [p] = [...ptrs.values()]; g = { mode: 'pan', x0: p.x, y0: p.y, win0: [...win], moved: true, at: 0 }; }
  };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', (ev) => {
    if (!ev.ctrlKey && Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) { ev.preventDefault(); const span = win[1] - win[0]; const sh = (ev.deltaX / svg.getBoundingClientRect().width) * span; setWin([win[0] + sh, win[1] + sh]); return; }
    ev.preventDefault();
    const c = pxToT(ev.clientX); const k = Math.exp(ev.deltaY * 0.0025);
    setWin([c - (c - win[0]) * k, c + (win[1] - c) * k]);
  }, { passive: false });

  // buttons
  host.querySelectorAll('[data-p]').forEach((bt) => {
    bt.onclick = () => {
      const pr = PRESETS.find((p) => p[0] === bt.dataset.p);
      if (pr[0] === 'all') return setWin([firstT, maxT]);
      if (pr[0] === 'day') return showDay(Math.min(win[1] - 1, maxT - 1));
      const end = Math.min(startOfDay(win[1] - 1) + DAY, maxT); setWin([end - pr[2], end]);
    };
  });
  host.querySelectorAll('[data-step]').forEach((bt) => { bt.onclick = () => { const span = win[1] - win[0]; const s = Number(bt.dataset.step) * span; setWin([win[0] + s, win[1] + s]); }; });
  host.querySelector('[data-today]').onclick = () => showDay(maxT - 1);
  host.querySelectorAll('[data-zoom]').forEach((bt) => { bt.onclick = () => { const c = (win[0] + win[1]) / 2; const k = bt.dataset.zoom === 'in' ? 0.5 : 2; const span = (win[1] - win[0]) * k; setWin([c - span / 2, c + span / 2]); }; });
  host.querySelector('.pc-date input').onchange = (ev) => { if (ev.target.value) showDay(+new Date(`${ev.target.value}T12:00`)); };
  new ResizeObserver(() => draw()).observe(host);
  render();
}

/* ---------- sign in ---------- */
function renderLogin(mode = 'in') {
  shell({
    body: `
    <section class="login">
      ${mark(64)}
      <h1>${mode === 'up' ? 'Create your account' : 'Welcome back'}</h1>
      <p class="muted">Capture symptoms as they happen and arrive at your appointment with a clear, dated history.</p>
      <form id="f" class="card stack">
        <label class="field">Email<input type="email" name="email" autocomplete="email" required></label>
        <label class="field">Password<input type="password" name="password" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}" minlength="8" ${mode === 'up' ? 'required' : ''}></label>
        <p class="err" role="alert"></p><p class="ok" role="status"></p>
        <button class="btn primary big" type="submit">${mode === 'up' ? 'Create account' : 'Sign in'}</button>
        ${mode === 'in' ? '<button class="btn" type="button" id="link">Email me a sign-in link</button><button class="link center" type="button" id="reset">Forgot password?</button>' : ''}
      </form>
      <p class="muted small center">${mode === 'up' ? 'Already have an account? <a href="#/login">Sign in</a>' : 'New to Dr Pocket? <a href="#/signup">Create an account</a>'}</p>
      <p class="muted small center">Your journal is private to your account. Dr Pocket is a record, not medical advice.</p>
    </section>`,
  });
  const f = $('#f');
  const say = (e, o = '') => { $('.err').textContent = e || ''; $('.ok').textContent = o; };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const email = f.email.value.trim(); const password = f.password.value;
    if (mode === 'in' && !password) return say('Enter your password, or tap "Email me a sign-in link".');
    const btn = f.querySelector('[type=submit]');
    busy(btn, true, mode === 'up' ? 'Creating…' : 'Signing in…');
    const { data, error } = mode === 'up' ? await auth.signUp(email, password) : await auth.signIn(email, password);
    busy(btn, false);
    if (error) return say(/invalid login/i.test(error.message) ? 'That email and password do not match.' : /not confirmed/i.test(error.message) ? 'Confirm your email first: open the link we sent you.' : errMsg(error));
    if (mode === 'up' && !data.session) say('', `Almost there: we sent a confirmation link to ${email}. Open it, then sign in here.`);
  };
  $('#link')?.addEventListener('click', async () => {
    const email = f.email.value.trim();
    if (!email) return say('Enter your email first.');
    const { error } = await auth.link(email);
    if (error && !/signups? not allowed/i.test(error.message)) return say(errMsg(error));
    say('', `A sign-in link is on its way to ${email}. In the installed phone app, signing in with your password is quicker: links open in the browser.`);
  });
  $('#reset')?.addEventListener('click', async () => {
    const email = f.email.value.trim();
    if (!email) return say('Enter your email first, then tap "Forgot password?".');
    const { error } = await auth.reset(email);
    if (error) return say(errMsg(error));
    say('', 'Check your inbox for a link to choose a new password.');
  });
}

function renderPassword() {
  shell({ back: '#/settings', body: `<h1 class="h1">New password</h1><form id="f" class="card stack">
    <label class="field">New password<input type="password" name="p" minlength="8" autocomplete="new-password" required></label>
    <p class="err" role="alert"></p><button class="btn primary big">Save password</button></form>` });
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await auth.setPassword(e.target.p.value);
    if (error) { $('.err').textContent = error.message; return; }
    toast('Password saved'); go('#/');
  };
}

/* ---------- home ---------- */
async function renderHome() {
  const h = new Date().getHours();
  shell({
    tab: 'home',
    body: `
      <section class="greet">
        <p class="eyebrow">${esc(new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
        <h1 class="h1">${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}</h1>
        <p class="muted" id="today-line">&nbsp;</p>
      </section>
      <div class="quick">
        <a class="qa primary" href="#/add">${icon('plus')}<span><b>Add note</b><small>Type or dictate</small></span></a>
        <a class="qa" href="#/exercise">${icon('dumbbell')}<span><b>Log exercise</b><small>A routine or one exercise</small></span></a>
      </div>
      <div id="eod"></div>
      <div class="sec-h"><h2>Active problems</h2><a class="link" href="#/problems">See all</a></div>
      <ul class="cards" id="probs"><li class="empty">Loading…</li></ul>
      <div class="sec-h"><h2>Recent entries</h2><a class="link" href="#/timeline">Timeline</a></div>
      <ol class="tl rows" id="recent"></ol>
      <a class="card link-card" href="#/reports">${icon('report')}<span><b>Doctor summary</b><small>A dated summary for your next appointment</small></span>${icon('chevron')}</a>
      <div class="sec-h"><h2>Tools</h2></div>
      <div class="tools">
        <a class="tool" href="/">${icon('body')}<span>3D body</span></a>
        <a class="tool" href="/#report">${icon('scan')}<span>Explain a scan report</span></a>
        <a class="tool" href="/shoulder/">${icon('pulse')}<span>Shoulder walkthrough</span></a>
      </div>`,
  });
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [list, all] = await Promise.all([problems.list(), entries.list({ limit: 300 })]);
    const today = all.filter((e) => D(e.at) >= start);
    const withPain = today.find((e) => e.pain != null);
    const done = today.find((e) => e.kind === 'day');
    const eod = $('#eod');
    if (eod) eod.innerHTML = done
      ? `<a class="card link-card eod done" href="#/e/${done.id}">${icon('moon')}<span><b>Today’s check-in: ${esc(RATING[done.checkin?.rating] || 'done')}</b><small>${esc(summaryOf(done) || 'Tap to see or change it')}</small></span>${icon('chevron')}</a>`
      : `<a class="card link-card eod ${h >= 17 ? 'due' : ''}" href="#/checkin">${icon('moon')}<span><b>End-of-day check-in</b><small>${h >= 17 ? 'One minute: how was your day overall?' : 'Do it this evening; a reminder comes at 21:00 if it is switched on.'}</small></span>${icon('chevron')}</a>`;
    const tl = $('#today-line');
    if (tl) tl.textContent = today.length ? `Today: ${n(today.length, 'entry', 'entries')} recorded${withPain ? ` · latest pain ${withPain.pain}/10` : ''}.` : 'Nothing recorded yet today.';
    const active = list.filter((p) => p.status === 'active' || p.status === 'improving');
    const byProb = (id) => all.filter((e) => e.problem_id === id);
    $('#probs').innerHTML = active.length ? active.map((p) => problemCard(p, byProb(p.id))).join('')
      : `<li class="card empty-card"><b>Start with your first problem</b><span class="muted">For example "Right shoulder" or "Lower back after the fall". Then add notes as things happen.</span><a class="btn primary" href="#/problem/new">${icon('plus')} New problem</a></li>`;
    const names = Object.fromEntries(list.map((p) => [p.id, p.title]));
    $('#recent').innerHTML = all.slice(0, 3).map((e) => entryRow(e, { showProblem: names[e.problem_id] || 'General', showDay: true })).join('') || '<li class="empty">Your entries will appear here.</li>';
  } catch (e) { $('#probs').innerHTML = `<li class="err">${esc(errMsg(e))}</li>`; }
}

function problemCard(p, list) {
  const pains = list.filter((e) => e.pain != null);
  const last = list[0];
  return `<li><a class="card prob" href="#/p/${p.id}">
    <div class="prob-h"><div><b>${esc(p.title)}</b><span class="muted small">${esc(p.diagnosis || where(p))}</span></div><span class="status ${p.status}">${STATUS[p.status]}</span></div>
    <div class="prob-stats">
      <span><b>${list.length}</b> ${list.length === 1 ? 'entry' : 'entries'}</span>
      <span><b>${pains.length ? `${pains[0].pain}/10` : '—'}</b> latest pain</span>
      <span><b>${last ? esc(last.at ? dayLabel(last.at).replace(/^\w+day, /, '') : '—') : '—'}</b> last entry</span>
    </div></a></li>`;
}

/* ---------- problems ---------- */
async function renderProblems() {
  const f = params().get('f') || 'active';
  shell({
    tab: 'problems',
    body: `<div class="page-h"><h1 class="h1">Problems</h1><a class="btn primary" href="#/problem/new">${icon('plus')} New</a></div>
      <div class="seg" role="tablist">${[['active', 'Active'], ['all', 'All'], ['archived', 'Archived']].map(([k, l]) => `<a role="tab" href="#/problems?f=${k}" aria-selected="${f === k}">${l}</a>`).join('')}</div>
      <ul class="cards" id="list"><li class="empty">Loading…</li></ul>`,
  });
  const [list, all] = await Promise.all([problems.list(), entries.list({ limit: 1000 })]);
  const shown = list.filter((p) => (f === 'all' ? true : f === 'archived' ? p.status === 'archived' || p.status === 'resolved' : p.status === 'active' || p.status === 'improving'));
  $('#list').innerHTML = shown.map((p) => problemCard(p, all.filter((e) => e.problem_id === p.id))).join('') || '<li class="empty">Nothing here.</li>';
}

async function renderProblemForm(id) {
  const p = id ? await problems.get(id) : { title: '', area: 'Shoulder', side: 'none', detail: '', diagnosis: '', started_on: '', status: 'active' };
  shell({
    back: id ? `#/p/${id}?t=details` : '#/problems', tab: 'problems',
    body: `<h1 class="h1">${id ? 'Edit problem' : 'New problem'}</h1><form id="f" class="card stack">
      <label class="field">Name<input name="title" maxlength="200" required placeholder="e.g. Right shoulder" value="${esc(p.title)}"></label>
      <div class="two">
        <label class="field">Area of the body<select name="area">${AREAS.map((a) => `<option ${a === p.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
        <label class="field">Side<select name="side">${Object.entries({ none: 'Not applicable', left: 'Left', right: 'Right', both: 'Both' }).map(([k, v]) => `<option value="${k}" ${k === p.side ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <label class="field">When did it start? <span class="hint">optional</span><input type="date" name="started_on" value="${esc(p.started_on || '')}"></label>
      <label class="field">Diagnosis from a clinician <span class="hint">optional, only what a doctor or physio confirmed</span><input name="diagnosis" maxlength="200" placeholder="e.g. Post-op · Bankart repair" value="${esc(p.diagnosis || '')}"></label>
      <label class="field">In your own words <span class="hint">optional: how it started, what it feels like</span><textarea name="detail" rows="4">${esc(p.detail)}</textarea></label>
      <div id="dict"></div>
      ${id ? `<label class="field">Status<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
      <p class="err" role="alert"></p>
      <button class="btn primary big">${id ? 'Save' : 'Create problem'}</button>
    </form>`,
  });
  const f = $('#f');
  stopDictation.push(dictation($('#dict'), f.detail));
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('.primary'); busy(btn, true);
    const row = { title: f.title.value.trim(), area: f.area.value, side: f.side.value, started_on: f.started_on.value || null, diagnosis: f.diagnosis.value.trim(), detail: f.detail.value.trim() };
    if (id) row.status = f.status.value;
    try { const saved = id ? await problems.update(id, row) : await problems.create(row); go(`#/p/${saved.id}`); } catch (err) { busy(btn, false); $('.err').textContent = errMsg(err); }
  };
}

/* ---------- one problem: Timeline, Insights, Exercise, Media, Details ---------- */
const PTABS = [['timeline', 'Timeline', 'list'], ['insights', 'Insights', 'chart'], ['exercise', 'Exercise', 'dumbbell'], ['media', 'Media', 'image'], ['details', 'Details', 'info']];

async function renderProblem(id) {
  const general = id === 'none';
  const t = params().get('t') || 'timeline';
  let p;
  try { p = general ? { id: 'none', title: 'General', area: '', side: 'none', detail: '', diagnosis: 'Notes not tied to one problem', status: 'active' } : await problems.get(id); } catch { return go('#/problems'); }
  const list = await entries.list({ problemId: id, limit: 2000 });
  const pains = list.filter((e) => e.pain != null);
  const firstDay = p.started_on ? D(`${p.started_on}T12:00`) : (list.length ? D(list[list.length - 1].at) : new Date());
  const tracking = Math.max(1, Math.round((Date.now() - firstDay) / 864e5) + 1);
  shell({
    back: '#/problems', tab: 'problems',
    body: `
      <section class="prob-head">
        <p class="eyebrow">Problem</p>
        <h1 class="h1">${esc(p.title)}</h1>
        <p class="muted">${esc(p.diagnosis || where(p) || '')}</p>
        ${general ? '' : `<span class="status ${p.status}">${STATUS[p.status]}</span>`}
      </section>
      <nav class="ptabs" role="tablist">${PTABS.filter(([k]) => !general || k === 'timeline' || k === 'exercise').map(([k, l, ic]) => `<a role="tab" href="#/p/${id}?t=${k}" aria-selected="${t === k}">${icon(ic)}<span>${l}</span></a>`).join('')}</nav>
      <div id="pt"></div>`,
    foot: `<div class="sticky-cta"><a class="btn primary big" href="#/add?p=${id}">${icon('plus')} Add Note / Symptom</a></div>`,
  });
  const host = $('#pt');
  if (t === 'timeline') {
    host.innerHTML = `
      <div class="stats">
        <div class="stat">${icon('calendar')}<span><small>Tracking</small><b>${tracking}</b> ${tracking === 1 ? 'day' : 'days'}</span></div>
        <div class="stat">${icon('file')}<span><small>Entries</small><b>${list.length}</b></span></div>
        <div class="stat">${icon('pulse')}<span><small>Avg pain</small>${pains.length ? `<b>${(pains.reduce((a, e) => a + e.pain, 0) / pains.length).toFixed(1)}</b>/10` : '<b>—</b>'}</span></div>
      </div>
      <div id="pc"></div>
      <div class="sec-h"><h2>Timeline</h2></div>
      <div id="tl"></div>`;
    mountPainChart($('#pc'), list);
    timeline($('#tl'), list);
  } else if (t === 'insights') renderInsights(host, p, list);
  else if (t === 'exercise') {
    const ex = list.filter((e) => e.kind === 'exercise');
    const recent = ex.filter((e) => Date.now() - D(e.at) < 14 * 864e5);
    host.innerHTML = `<div class="stats two-stats">
        <div class="stat">${icon('dumbbell')}<span><small>Last 14 days</small><b>${recent.length}</b> ${recent.length === 1 ? 'session' : 'sessions'}</span></div>
        <div class="stat">${icon('clock')}<span><small>Minutes logged</small><b>${recent.reduce((a, e) => a + (Number(e.exercise?.minutes) || 0), 0)}</b></span></div>
      </div>
      <a class="btn big wide" href="#/exercise?p=${id}">${icon('dumbbell')} Log exercise</a>
      <div id="tl"></div>`;
    timeline($('#tl'), ex, { filters: false });
  } else if (t === 'media') {
    const fl = await files.list(id).catch(() => []);
    const urls = await files.urls(fl.map((f) => f.path)).catch(() => ({}));
    host.innerHTML = `<div class="card stack" id="up"></div><button class="btn primary big wide" id="upload" hidden>Upload</button>
      <div class="media">${fl.map((f) => `<a class="media-item" href="${esc(urls[f.path] || '#')}" target="_blank" rel="noopener">
        ${/^image\//.test(f.mime) && urls[f.path] ? `<img src="${esc(urls[f.path])}" alt="${esc(f.name)}" loading="lazy">` : `<span class="media-file">${icon('file')}<small>${esc(f.name)}</small></span>`}
        <span class="media-d">${esc(fmtDate(f.at))}</span></a>`).join('') || '<div class="empty">No photos, X-rays or files yet.</div>'}</div>`;
    const btn = $('#upload');
    const picked = filePicker($('#up'), (k) => { btn.hidden = !k; });
    btn.onclick = async () => {
      busy(btn, true, 'Uploading…');
      try { for (const f of picked()) await files.upload({ uid: session.user.id, problemId: id, entryId: null, file: f, at: new Date().toISOString() }); toast('Uploaded'); route(); } catch (e) { busy(btn, false); toast(errMsg(e)); }
    };
  } else if (t === 'details') {
    host.innerHTML = `<dl class="card details">
        <dt>Name</dt><dd>${esc(p.title)}</dd>
        <dt>Area</dt><dd>${esc(where(p) || '—')}</dd>
        <dt>Started</dt><dd>${p.started_on ? esc(fmtDate(`${p.started_on}T12:00`)) : 'Not recorded'}</dd>
        <dt>Clinician diagnosis</dt><dd>${esc(p.diagnosis || 'None recorded')}</dd>
        <dt>In your own words</dt><dd class="pre">${esc(p.detail || '—')}</dd>
        <dt>Status</dt><dd>${STATUS[p.status]}</dd>
      </dl>
      <a class="btn big wide" href="#/problem/${id}/edit">${icon('edit')} Edit details</a>
      <button class="btn big wide" id="arch">${p.status === 'archived' ? 'Bring back to active' : 'Archive this problem'}</button>
      <button class="btn danger wide" id="del">${icon('trash')} Delete problem and all its entries</button>`;
    $('#arch').onclick = async () => { await problems.update(id, { status: p.status === 'archived' ? 'active' : 'archived' }); toast(p.status === 'archived' ? 'Active again' : 'Archived'); route(); };
    $('#del').onclick = async () => {
      if (!confirm(`Delete "${p.title}" with all its entries, files and summaries? This cannot be undone.`)) return;
      try { await problems.remove(id); toast('Deleted'); go('#/problems'); } catch (e) { toast(errMsg(e)); }
    };
  }
}

/* ---------- insights: only what was recorded, worked out on this device ---------- */
function bars(rows, total) {
  return `<ul class="bars">${rows.map(([label, k, extra = '']) => `<li><span class="bar-l">${esc(label)}</span><span class="bar-t"><i style="width:${total ? Math.round((k / total) * 100) : 0}%"></i></span><span class="bar-n">${k}${extra}</span></li>`).join('')}</ul>`;
}
function renderInsights(host, p, all) {
  const days = Number(params().get('d') ?? 30);
  const since = days ? Date.now() - days * 864e5 : 0;
  const list = all.filter((e) => +D(e.at) >= since);
  const pains = list.filter((e) => e.pain != null);
  const exN = list.filter((e) => e.kind === 'exercise').length;
  const tags = {}; list.forEach((e) => (e.symptoms || []).forEach((s) => { tags[s] = (tags[s] || 0) + 1; }));
  const acts = {}; list.forEach((e) => { const as = actsOf(e).length ? actsOf(e) : (e.kind === 'exercise' ? ['Exercise'] : []); as.forEach((a) => (acts[a] ||= []).push(e)); });
  const buckets = [['0–1', 0, 1], ['2–3', 2, 3], ['4–5', 4, 5], ['6–7', 6, 7], ['8–10', 8, 10]].map(([l, a, b]) => [l, pains.filter((e) => e.pain >= a && e.pain <= b).length]);
  const written = list.filter((e) => e.triggers || e.relief || e.impact);
  const avg = pains.length ? (pains.reduce((a, e) => a + e.pain, 0) / pains.length).toFixed(1) : null;
  const missing = list.length - pains.length;
  host.innerHTML = `
    <div class="seg">${[[14, '14 days'], [30, '30 days'], [90, '90 days'], [0, 'All']].map(([k, l]) => `<a href="#/p/${p.id}?t=insights&d=${k}" aria-selected="${days === k}">${l}</a>`).join('')}</div>
    <section class="card">
      <div class="card-h"><h3>${icon('sparkle')} Summary</h3></div>
      <p>${list.length ? `In ${days ? `the last ${days} days` : 'all your entries'} you recorded <b>${n(list.length, 'entry', 'entries')}</b>${exN ? `, including ${n(exN, 'exercise session')}` : ''}. ${pains.length ? `${n(pains.length, 'entry has', 'entries have')} a pain score: recorded pain ranged from <b>${Math.min(...pains.map((e) => e.pain))} to ${Math.max(...pains.map((e) => e.pain))}</b> out of 10, average <b>${avg}</b>.` : 'None of them has a pain score yet.'} ${missing ? `${n(missing, 'entry has', 'entries have')} no pain score; those count as unknown, not as zero.` : ''}` : 'Nothing recorded in this period.'}</p>
      <p class="small muted">Counts of what you wrote down. Not a diagnosis, and it cannot say why something happened.</p>
    </section>
    <section class="card"><div class="card-h"><h3>Symptoms <span class="muted">(how often tagged)</span></h3></div>
      ${Object.keys(tags).length ? bars(Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, ` of ${list.length}`]), list.length) : '<p class="small muted">No symptom tags in this period. Tap symptoms when you add a note to see them counted here.</p>'}</section>
    <section class="card"><div class="card-h"><h3>Pain level distribution</h3></div>
      ${pains.length ? bars([...buckets, ['Not recorded', missing]], list.length) : '<p class="small muted">No pain scores in this period.</p>'}</section>
    <section class="card"><div class="card-h"><h3>Recorded with activities</h3></div>
      ${Object.keys(acts).length ? `<ul class="plain">${Object.entries(acts).sort((a, b) => b[1].length - a[1].length).map(([a, es]) => { const ps = es.filter((e) => e.pain != null); return `<li><b>${esc(a)}</b>: ${n(es.length, 'entry', 'entries')}${ps.length ? `, recorded pain ${Math.min(...ps.map((e) => e.pain))}–${Math.max(...ps.map((e) => e.pain))}/10` : ', no pain scores'}</li>`; }).join('')}</ul><p class="small muted">Shown together because you recorded them together, not because one caused the other.</p>` : '<p class="small muted">No activities recorded in this period.</p>'}</section>
    ${written.length ? `<section class="card"><div class="card-h"><h3>Triggers, relief and impact you wrote down</h3></div><ul class="plain">${written.map((e) => `<li><a href="#/e/${e.id}" class="src">${esc(fmtDate(e.at))}</a> ${[e.triggers && `Trigger: ${esc(e.triggers)}`, e.relief && `Helped: ${esc(e.relief)}`, e.impact && `Impact: ${esc(e.impact)}`].filter(Boolean).join(' · ')}</li>`).join('')}</ul></section>` : ''}
    <div class="row-btns">
      <a class="btn primary big" href="#/reports?p=${p.id}">${icon('report')} Create doctor summary</a>
      <button class="btn big" id="pdf">${icon('download')} Export PDF</button>
    </div>`;
  $('#pdf').onclick = () => window.print();
}

/* ---------- add or edit a note ---------- */
async function renderAdd() {
  const ps = params();
  const editing = ps.get('e') ? await entries.get(ps.get('e')) : null;
  const list = (await problems.list()).filter((p) => p.status !== 'archived' || p.id === editing?.problem_id);
  const pid = editing ? (editing.problem_id || 'none') : (ps.get('p') || list.find((p) => p.status === 'active')?.id || 'none');
  shell({
    back: editing ? `#/e/${editing.id}` : (ps.get('p') ? `#/p/${pid}` : '#/'), tab: editing ? null : 'add',
    body: `<h1 class="h1">${editing ? 'Edit entry' : 'Add note'}</h1>
      <form id="f" class="stack">
        <label class="field">About<select name="problem">${list.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}<option value="none" ${pid === 'none' ? 'selected' : ''}>General (not one problem)</option></select></label>
        <div class="card stack">
          <label class="field">What happened? <span class="hint">in your own words</span>
            <textarea name="body" rows="5" placeholder="e.g. Shoulder felt unstable while walking. Better when I supported the arm.">${esc(editing?.body || '')}</textarea></label>
          <div id="dict"></div>
        </div>
        <div class="card stack" id="when"></div>
        <div class="card stack" id="pain"></div>
        <div class="card stack" id="sym"></div>
        <div class="card stack"><div id="act"></div>
          <label class="field">How long, how far? <span class="hint">optional</span><input name="actdetail" maxlength="300" value="${esc(editing?.activity_detail || '')}" placeholder="e.g. 2 h at the computer, walked 3 km"></label></div>
        <details class="card more" ${editing && (editing.triggers || editing.relief || editing.impact) ? 'open' : ''}>
          <summary>More details <span class="hint">triggers, what helped, impact</span></summary>
          <div class="stack">
            <label class="field">What set it off? <span class="hint">trigger</span><input name="triggers" maxlength="300" value="${esc(editing?.triggers || '')}" placeholder="e.g. 30 minutes sitting upright"></label>
            <label class="field">What helped? <span class="hint">relief</span><input name="relief" maxlength="300" value="${esc(editing?.relief || '')}" placeholder="e.g. Ice, stretching, rest"></label>
            <label class="field">What couldn't you do? <span class="hint">impact</span><input name="impact" maxlength="300" value="${esc(editing?.impact || '')}" placeholder="e.g. Could not reach the top shelf"></label>
          </div>
        </details>
        ${editing ? '' : '<div class="card stack" id="files"></div>'}
        <p class="err" role="alert"></p>
      </form>`,
    foot: `<div class="sticky-cta"><button class="btn primary big" id="save" form="f">${icon('check')} ${editing ? 'Save changes' : 'Save note'}</button></div>`,
  });
  const f = $('#f');
  stopDictation.push(dictation($('#dict'), f.body));
  const when = whenPicker($('#when'), editing);
  const pain = painPicker($('#pain'), editing?.pain ?? null);
  const sym = chipsPicker($('#sym'), { options: SYMPTOMS, selected: editing?.symptoms || [], label: 'Symptoms' });
  const act = chipsPicker($('#act'), { options: ACTIVITIES, selected: editing ? actsOf(editing) : [], multi: true, label: 'What were you doing? (choose all that apply)' });
  const picked = editing ? () => [] : filePicker($('#files'));
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const text = f.body.value.trim(); const pv = pain(); const fl = picked();
    const row = { body: text, pain: pv, symptoms: sym(), activities: act(), activity: act().join(', '), activity_detail: f.actdetail.value.trim(), triggers: f.triggers.value.trim(), relief: f.relief.value.trim(), impact: f.impact.value.trim() };
    if (!text && pv == null && !fl.length && !row.symptoms.length) { $('.err').textContent = 'Write or dictate what happened, or add a pain score, symptom or file.'; return; }
    const w = when();
    const problemId = f.problem.value === 'none' ? null : f.problem.value;
    const btn = $('#save'); busy(btn, true, fl.length ? 'Uploading…' : 'Saving…');
    try {
      let e;
      if (editing) e = await entries.update(editing.id, { ...row, problem_id: problemId, at: w.at, time_known: w.time_known });
      else {
        // Saved within 15 minutes of your last note on the same problem: it belongs to that note.
        if (w.now) {
          const [last] = await entries.list({ problemId: problemId || 'none', kind: 'note', limit: 1 });
          if (last && last.time_known !== false && Date.now() - D(last.at) < 15 * 60e3) {
            e = await entries.update(last.id, {
              body: [last.body, text].filter(Boolean).join('\n'), pain: pv ?? last.pain,
              symptoms: [...new Set([...(last.symptoms || []), ...row.symptoms])],
              activities: [...new Set([...actsOf(last), ...row.activities])], activity: [...new Set([...actsOf(last), ...row.activities])].join(', '),
              activity_detail: [last.activity_detail, row.activity_detail].filter(Boolean).join('; '),
              triggers: row.triggers || last.triggers, relief: row.relief || last.relief, impact: row.impact || last.impact,
            });
            toast(`Added to your ${fmtTime(last.at)} note`);
          }
        }
        if (!e) { e = await entries.create({ ...row, problem_id: problemId, kind: 'note', at: w.at, time_known: w.time_known }); toast('Saved'); }
        for (const file of fl) await files.upload({ uid: session.user.id, problemId, entryId: e.id, file, at: w.at });
      }
      go(`#/p/${problemId || 'none'}`);
    } catch (err) { busy(btn, false); $('.err').textContent = errMsg(err); }
  };
}

/* ---------- end-of-day check-in ---------- */
// The 21:00 reminder opens this. The summary at the top is worked out on this device from today's entries;
// nothing is sent to an AI service. The check-in itself is a 'day' entry (General, not tied to one problem).
function daySoFar(list) {
  if (!list.length) return '<p class="muted">Nothing else recorded today.</p>';
  const pains = list.filter((e) => e.pain != null).map((e) => e.pain);
  const ex = list.filter((e) => e.kind === 'exercise');
  const sym = {}; list.forEach((e) => (e.symptoms || []).forEach((t) => { sym[t] = (sym[t] || 0) + 1; }));
  const bits = [n(list.length, 'entry', 'entries')];
  if (pains.length) bits.push(`pain ${Math.min(...pains)}${Math.max(...pains) !== Math.min(...pains) ? `–${Math.max(...pains)}` : ''}/10`);
  if (ex.length) bits.push(`${n(ex.length, 'exercise session')} (${ex.map((e) => e.exercise?.name).filter(Boolean).slice(0, 2).join(', ')})`);
  const top = Object.entries(sym).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  return `<p><b>${esc(bits.join(' · '))}</b>${top.length ? `<br><span class="muted small">Symptoms tagged: ${esc(top.join(', '))}</span>` : ''}</p>
    <ol class="tl rows compact">${list.slice(0, 6).map((e) => entryRow(e)).join('')}</ol>`;
}

async function renderCheckin() {
  const ps = params();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const todayList = (await entries.list({ from: start.toISOString(), limit: 200 })).filter((e) => e.kind !== 'day');
  const existing = ps.get('e') ? await entries.get(ps.get('e')) : (await entries.list({ problemId: 'none', kind: 'day', from: start.toISOString(), limit: 1 }))[0];
  const c = existing?.checkin || {};
  const seg = (name, opts, cur) => `<div class="seg" role="radiogroup" data-name="${name}">${opts.map((o) => `<button type="button" role="radio" data-v="${esc(o)}" aria-checked="${o === cur}">${esc(o)}</button>`).join('')}</div>`;
  shell({
    back: '#/', tab: 'home',
    body: `<p class="eyebrow">${esc((existing ? D(existing.at) : new Date()).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
      <h1 class="h1">End of day</h1>
      <section class="card"><div class="card-h"><h3>${icon('sparkle')} Your day so far</h3></div>${daySoFar(todayList)}</section>
      <form id="f" class="stack">
        <div class="card stack"><div class="lbl">How was your day overall?</div>
          <div class="rating" role="radiogroup" aria-label="How was your day overall">${[1, 2, 3, 4, 5].map((v) => `<button type="button" role="radio" data-v="${v}" aria-checked="${c.rating === v}"><b>${v}</b><span>${RATING[v].replace(' day', '')}</span></button>`).join('')}</div></div>
        <div class="card stack" id="pain"></div>
        <div class="card stack"><div class="lbl">Sleep last night <span class="hint">optional</span></div>
          <div class="two"><label class="field">Hours<input name="sleep_h" type="number" inputmode="decimal" min="0" max="24" step="0.5" value="${esc(c.sleep_h ?? '')}"></label>
          <div class="field">Quality${seg('sleep_q', ['Poor', 'OK', 'Good'], c.sleep_q)}</div></div></div>
        <div class="card stack"><div class="field">Energy <span class="hint">optional</span>${seg('energy', ['Low', 'OK', 'High'], c.energy)}</div>
          <div class="field">Mood <span class="hint">optional</span>${seg('mood', ['Low', 'OK', 'Good'], c.mood)}</div></div>
        <div class="card stack"><label class="field">Anything else about today? <span class="hint">optional, in your own words</span><textarea name="body" rows="3" placeholder="e.g. Long day at the desk, shoulder stiff by the evening.">${esc(existing?.body || '')}</textarea></label><div id="dict"></div></div>
        <p class="err" role="alert"></p>
      </form>`,
    foot: `<div class="sticky-cta"><button class="btn primary big" id="save" form="f">${icon('check')} ${existing ? 'Save changes' : 'Save check-in'}</button></div>`,
  });
  const f = $('#f');
  let rating = c.rating || null;
  $$('.rating button').forEach((b) => { b.onclick = () => { rating = Number(b.dataset.v); $$('.rating button').forEach((x) => x.setAttribute('aria-checked', String(x === b))); }; });
  const pick = {};
  $$('.seg[data-name]').forEach((g) => {
    pick[g.dataset.name] = c[g.dataset.name] || null;
    g.querySelectorAll('button').forEach((b) => { b.onclick = () => { const v = pick[g.dataset.name] === b.dataset.v ? null : b.dataset.v; pick[g.dataset.name] = v; g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.v === v))); }; });
  });
  const pain = painPicker($('#pain'), existing?.pain ?? null, 'Overall pain today');
  stopDictation.push(dictation($('#dict'), f.body));
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!rating) { $('.err').textContent = 'Choose how your day was, from 1 to 5.'; return; }
    const sleep = f.sleep_h.value === '' ? null : Number(f.sleep_h.value);
    const row = { kind: 'day', problem_id: null, body: f.body.value.trim(), pain: pain(), checkin: { rating, sleep_h: sleep, sleep_q: pick.sleep_q, energy: pick.energy, mood: pick.mood } };
    const btn = $('#save'); busy(btn, true);
    try {
      if (existing) await entries.update(existing.id, row);
      else await entries.create({ ...row, at: new Date().toISOString(), time_known: true });
      toast('Check-in saved'); go('#/');
    } catch (err) { busy(btn, false); $('.err').textContent = errMsg(err); }
  };
}

/* ---------- one entry ---------- */
async function renderEntry(id) {
  let e;
  try { e = await entries.get(id); } catch { return go('#/timeline'); }
  const p = e.problem_id ? await problems.get(e.problem_id).catch(() => null) : null;
  const urls = await files.urls((e.files || []).map((f) => f.path)).catch(() => ({}));
  const field = (label, v) => (v ? `<dt>${label}</dt><dd>${esc(v)}</dd>` : '');
  shell({
    back: `#/p/${e.problem_id || 'none'}`, tab: 'timeline',
    body: `
      <p class="eyebrow"><a href="#/p/${e.problem_id || 'none'}">${esc(p?.title || 'General')}</a></p>
      <h1 class="h1">${esc(titleOf(e))}</h1>
      <p class="muted when-line">${icon('clock')} ${esc(fmtWhen(e))}</p>
      <div class="tl-tags">${painChip(e.pain)}${e.pain == null ? '<span class="tag">Pain not recorded</span>' : ''}${tagsOf(e)}</div>
      ${e.body ? `<section class="card"><div class="card-h"><h3>Your words</h3></div><p class="pre">${esc(e.body)}</p></section>` : ''}
      ${e.kind === 'day' ? `<dl class="card details">${field('Day', RATING[e.checkin?.rating])}${field('Sleep', [e.checkin?.sleep_h != null ? `${e.checkin.sleep_h} hours` : '', e.checkin?.sleep_q].filter(Boolean).join(', '))}${field('Energy', e.checkin?.energy)}${field('Mood', e.checkin?.mood)}</dl>` : ''}
      ${e.kind === 'exercise' && e.exercise?.items ? `<section class="card"><div class="card-h"><h3>${icon('dumbbell')} Routine: ${esc(e.exercise.name)}</h3></div>${e.exercise.items.length ? `<ul class="rt-done">${e.exercise.items.map((i) => `<li class="${i.done === false ? 'skip' : ''}">${icon(i.done === false ? 'down' : 'check')}<span>${esc(i.name)}${i.detail ? ` <small>${esc(i.detail)}</small>` : ''}${i.done === false ? ' <small>not done</small>' : ''}</span></li>`).join('')}</ul>` : ''}${e.exercise.minutes ? `<p class="muted small">${e.exercise.minutes} minutes</p>` : ''}</section>` : e.kind === 'exercise' ? `<section class="card"><div class="card-h"><h3>Exercise</h3></div><p>${esc([e.exercise?.name, summaryOf({ ...e, body: '' })].filter(Boolean).join(': '))}</p></section>` : ''}
      ${(e.symptoms?.length || (actsOf(e).length && e.kind !== 'exercise') || e.activity_detail || e.triggers || e.relief || e.impact) ? `<dl class="card details">
        ${field('Symptoms', (e.symptoms || []).join(', '))}${e.kind !== 'exercise' ? field('Doing', actsOf(e).join(', ')) : ''}${field('How long, how far', e.activity_detail)}${field('Trigger', e.triggers)}${field('What helped', e.relief)}${field('Impact', e.impact)}</dl>` : ''}
      ${(e.files || []).length ? `<div class="media">${e.files.map((f) => `<a class="media-item" href="${esc(urls[f.path] || '#')}" target="_blank" rel="noopener">${/^image\//.test(f.mime) && urls[f.path] ? `<img src="${esc(urls[f.path])}" alt="${esc(f.name)}">` : `<span class="media-file">${icon('file')}<small>${esc(f.name)}</small></span>`}</a>`).join('')}</div>` : ''}
      <p class="small muted">Written down ${esc(fmtDate(e.created_at))}, ${esc(fmtTime(e.created_at))}${e.edits?.length ? ` · edited ${n(e.edits.length, 'time')}` : ''}</p>
      ${e.edits?.length ? `<details class="card more"><summary>Earlier versions</summary><ol class="plain">${e.edits.slice().reverse().map((v) => `<li><span class="small muted">${esc(fmtDate(v.saved_at))}, ${esc(fmtTime(v.saved_at))}</span><p class="pre">${esc(v.body || '(no text)')}${v.pain != null ? ` · pain ${v.pain}/10` : ''}</p></li>`).join('')}</ol></details>` : ''}
      <div class="row-btns">
        <a class="btn big" href="${e.kind === 'exercise' ? `#/exercise?e=${e.id}` : e.kind === 'day' ? `#/checkin?e=${e.id}` : `#/add?e=${e.id}`}">${icon('edit')} Edit</a>
        <button class="btn big danger" id="del">${icon('trash')} Delete</button>
      </div>`,
  });
  $('#del').onclick = async () => {
    if (!confirm('Delete this entry and its files?')) return;
    try { await entries.remove(e.id); toast('Deleted'); go(`#/p/${e.problem_id || 'none'}`); } catch (err) { toast(errMsg(err)); }
  };
}

/* ---------- log exercise: a routine (the usual way) or one exercise ---------- */
const ROUTINE_NAMES = ['Stretching routine', 'Biokinetics exercises', 'Physio exercises', 'Morning stretches', 'Gym routine'];
async function renderExercise() {
  const ps = params(); const editing = ps.get('e');
  const [list, names, existing, rts] = await Promise.all([problems.list().catch(() => []), entries.exerciseNames().catch(() => []), editing ? entries.get(editing) : null, routines.list().catch(() => [])]);
  const x = existing?.exercise || {};
  const pid = existing ? (existing.problem_id || 'none') : (ps.get('p') || list.find((p) => p.status === 'active')?.id || 'none');
  let mode = existing ? (x.items ? 'routine' : 'single') : (ps.get('m') === 'single' ? 'single' : 'routine');
  let rid = x.routine_id || ps.get('r') || (rts.length === 1 ? rts[0].id : '');
  shell({
    back: existing ? `#/e/${existing.id}` : (ps.get('p') ? `#/p/${pid}?t=exercise` : '#/'), tab: 'home',
    body: `<h1 class="h1">${editing ? 'Edit exercise' : 'Log exercise'}</h1>
      <form id="f" class="stack">
        ${editing ? '' : `<div class="seg" role="radiogroup" id="mode"><button type="button" role="radio" data-k="routine" aria-checked="${mode === 'routine'}">A routine</button><button type="button" role="radio" data-k="single" aria-checked="${mode === 'single'}">One exercise</button></div>`}
        <label class="field">For<select name="problem">${list.filter((p) => p.status !== 'archived' || p.id === pid).map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}<option value="none" ${pid === 'none' ? 'selected' : ''}>General (not one problem)</option></select></label>
        <div id="routine" class="stack"></div>
        <div class="card stack" id="single">
          <label class="field">Exercise<input name="name" list="names" placeholder="e.g. Band external rotation, walk, aerobics" value="${esc(x.items ? '' : x.name || '')}"><datalist id="names">${names.map((k) => `<option value="${esc(k)}">`).join('')}</datalist></label>
          <div class="four">
            <label class="field">Sets<input name="sets" type="number" inputmode="numeric" min="0" value="${esc(x.sets ?? '')}"></label>
            <label class="field">Reps<input name="reps" type="number" inputmode="numeric" min="0" value="${esc(x.reps ?? '')}"></label>
            <label class="field">Kg<input name="weight" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(x.weight ?? '')}"></label>
            <label class="field">Min<input name="minutes" type="number" inputmode="decimal" min="0" value="${esc(x.items ? '' : x.minutes ?? '')}"></label>
          </div>
          <label class="field">Distance km <span class="hint">optional</span><input name="km" type="number" inputmode="decimal" min="0" step="0.1" value="${esc(x.km ?? '')}"></label>
        </div>
        <div class="card stack" id="when"></div>
        <div class="card stack" id="pain"></div>
        <div class="card stack">
          <label class="field">How did it feel, during and after? <span class="hint">optional</span><textarea name="body" rows="3" placeholder="e.g. Easier than last week, sore 2 hours later">${esc(existing?.body || '')}</textarea></label>
          <div id="dict"></div>
        </div>
        <p class="err" role="alert"></p>
      </form>`,
    foot: `<div class="sticky-cta"><button class="btn primary big" id="save" form="f">${icon('check')} ${editing ? 'Save changes' : 'Save exercise'}</button></div>`,
  });
  const f = $('#f');
  const back = encodeURIComponent(location.hash.replace(/^#/, ''));
  const paintRoutine = () => {
    const host = $('#routine');
    if (!rts.length && !x.items) {
      host.innerHTML = `<div class="card stack rt-intro"><h3>${icon('dumbbell')} Make your first routine</h3><p class="muted">A routine is a named set you do often, like a <b>stretching routine</b> (behind the back, up the wall…) or just <b>Biokinetics exercises</b>. Build it once, then log it in one tap.</p><a class="btn primary big" href="#/routine/new?back=${back}">${icon('plus')} New routine</a></div>`;
      return;
    }
    const cur = rts.find((r) => r.id === rid);
    // A routine entry being edited keeps its own items (the routine may have changed since).
    const items = x.items && x.routine_id === rid ? x.items : (cur?.items || []).map((i) => ({ name: i.name, detail: i.detail || '', done: true }));
    host.innerHTML = `<div class="card stack">
      <div class="lbl">Which routine?</div>
      <div class="rt-pick" role="radiogroup">${rts.map((r) => `<button type="button" role="radio" class="rt-opt" data-id="${r.id}" aria-checked="${r.id === rid}"><b>${esc(r.name)}</b><small>${r.items.length ? n(r.items.length, 'exercise') : 'No list, just the name'}</small></button>`).join('')}${x.items && !cur ? `<button type="button" role="radio" class="rt-opt" aria-checked="true"><b>${esc(x.name)}</b><small>as logged</small></button>` : ''}</div>
      <div class="rt-links"><a href="#/routine/new?back=${back}">${icon('plus')} New routine</a>${cur ? `<a href="#/routine/${cur.id}?back=${back}">${icon('edit')} Edit “${esc(cur.name)}”</a>` : ''}</div>
    </div>
    ${rid || x.items ? `<div class="card stack">
      ${items.length ? `<div class="lbl">What did you do? <span class="hint">untick anything you skipped</span></div>
      <ul class="rt-check">${items.map((i, k) => `<li><label class="check"><input type="checkbox" data-k="${k}" ${i.done !== false ? 'checked' : ''}><span>${esc(i.name)}${i.detail ? `<small>${esc(i.detail)}</small>` : ''}</span></label></li>`).join('')}</ul>` : `<p class="muted">“${esc(cur?.name || x.name)}” has no list of exercises; it is logged by its name. You can add exercises to it any time.</p>`}
      <label class="field">Minutes in total <span class="hint">optional</span><input name="rmin" type="number" inputmode="decimal" min="0" value="${esc(x.items ? x.minutes ?? '' : '')}"></label>
    </div>` : ''}`;
    host._items = items;
    $$('.rt-opt[data-id]', host).forEach((b) => { b.onclick = () => { rid = b.dataset.id; paintRoutine(); }; });
  };
  const paintMode = () => {
    $('#routine').hidden = mode !== 'routine'; $('#single').hidden = mode !== 'single';
    f.name.required = mode === 'single';
    if (mode === 'routine') paintRoutine();
  };
  $$('#mode button').forEach((b) => { b.onclick = () => { mode = b.dataset.k; $$('#mode button').forEach((y) => y.setAttribute('aria-checked', String(y === b))); paintMode(); }; });
  paintMode();
  const when = whenPicker($('#when'), existing);
  const pain = painPicker($('#pain'), existing?.pain ?? null, 'Pain during or after');
  stopDictation.push(dictation($('#dict'), f.body));
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const w = when();
    let exercise;
    if (mode === 'routine') {
      const cur = rts.find((r) => r.id === rid);
      if (!cur && !x.items) { $('.err').textContent = rts.length ? 'Choose a routine.' : 'Make a routine first, or log one exercise.'; return; }
      const items = ($('#routine')._items || []).map((i, k) => ({ name: i.name, detail: i.detail || '', done: !!f.querySelector(`.rt-check input[data-k="${k}"]`)?.checked }));
      exercise = { name: cur?.name || x.name, routine_id: cur?.id || x.routine_id || null, items, minutes: num(f.rmin?.value) };
    } else exercise = { name: f.name.value.trim(), sets: num(f.sets.value), reps: num(f.reps.value), weight: num(f.weight.value), minutes: num(f.minutes.value), km: num(f.km.value) };
    const row = { problem_id: f.problem.value === 'none' ? null : f.problem.value, kind: 'exercise', exercise, body: f.body.value.trim(), pain: pain(), at: w.at, time_known: w.time_known, activity: 'Exercise', activities: ['Exercise'] };
    const btn = $('#save'); busy(btn, true);
    try { if (editing) await entries.update(editing, row); else await entries.create(row); toast(mode === 'routine' ? 'Routine logged' : 'Exercise saved'); go(`#/p/${row.problem_id || 'none'}?t=exercise`); } catch (err) { busy(btn, false); $('.err').textContent = errMsg(err); }
  };
}

/* ---------- build or edit a routine ---------- */
async function renderRoutine(id) {
  const ps = params(); const back = ps.get('back') ? `#${ps.get('back')}` : '#/exercise';
  const [list, r] = await Promise.all([problems.list().catch(() => []), id ? routines.get(id) : null]);
  let items = (r?.items || []).map((i) => ({ name: i.name, detail: i.detail || '' }));
  const pid = r ? r.problem_id || 'none' : (list.find((p) => p.status === 'active')?.id || 'none');
  shell({
    back, tab: 'home',
    body: `<h1 class="h1">${r ? 'Edit routine' : 'New routine'}</h1>
      <p class="muted">Give it a name you will recognise. Add the exercises or stretches in it, or leave the list empty and just log it by name.</p>
      <form id="f" class="stack">
        <div class="card stack">
          <label class="field">Name<input name="name" required maxlength="120" list="rnames" placeholder="e.g. Stretching routine, Jannie exercises" value="${esc(r?.name || '')}"><datalist id="rnames">${ROUTINE_NAMES.map((k) => `<option value="${esc(k)}">`).join('')}</datalist></label>
          <label class="field">For<select name="problem">${list.filter((p) => p.status !== 'archived' || p.id === pid).map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}<option value="none" ${pid === 'none' ? 'selected' : ''}>General (not one problem)</option></select></label>
        </div>
        <div class="card stack">
          <div class="lbl">Exercises in this routine <span class="hint">optional</span></div>
          <ol class="rt-edit" id="items"></ol>
          <button type="button" class="btn" id="additem">${icon('plus')} Add an exercise</button>
        </div>
        <label class="field">Notes <span class="hint">optional, e.g. who gave it to you</span><textarea name="note" rows="2" maxlength="2000">${esc(r?.note || '')}</textarea></label>
        <p class="err" role="alert"></p>
        ${r ? `<button type="button" class="btn danger wide" id="arch">${icon('trash')} Remove this routine</button><p class="small muted center">Removing it keeps every time you logged it.</p>` : ''}
      </form>`,
    foot: `<div class="sticky-cta"><button class="btn primary big" id="save" form="f">${icon('check')} Save routine</button></div>`,
  });
  const f = $('#f');
  const read = () => { items = $$('#items li').map((li) => ({ name: li.querySelector('[data-f=name]').value, detail: li.querySelector('[data-f=detail]').value })); };
  const paint = (focusLast = false) => {
    $('#items').innerHTML = items.map((i, k) => `<li><div class="rt-row"><input data-f="name" aria-label="Exercise ${k + 1}" placeholder="e.g. Hand behind the back" value="${esc(i.name)}" maxlength="120"><input data-f="detail" aria-label="Sets, reps or time for exercise ${k + 1}" placeholder="3 × 10, 30 s hold…" value="${esc(i.detail)}" maxlength="80"></div>
      <div class="rt-tools"><button type="button" class="icon-btn" data-up="${k}" aria-label="Move up" ${k ? '' : 'disabled'}>${icon('back')}</button><button type="button" class="icon-btn" data-rm="${k}" aria-label="Remove">${icon('trash')}</button></div></li>`).join('');
    $$('#items [data-rm]').forEach((b) => { b.onclick = () => { read(); items.splice(+b.dataset.rm, 1); paint(); }; });
    $$('#items [data-up]').forEach((b) => { b.onclick = () => { read(); const k = +b.dataset.up; [items[k - 1], items[k]] = [items[k], items[k - 1]]; paint(); }; });
    if (focusLast) $$('#items [data-f=name]').pop()?.focus();
  };
  $('#additem').onclick = () => { read(); items.push({ name: '', detail: '' }); paint(true); };
  paint();
  $('#arch')?.addEventListener('click', async () => { if (!confirm('Remove this routine? Times you logged it stay in your journal.')) return; await routines.archive(r.id).catch((e) => toast(errMsg(e))); toast('Routine removed'); go(back); });
  f.onsubmit = async (ev) => {
    ev.preventDefault(); read();
    const row = { name: f.name.value.trim(), problem_id: f.problem.value === 'none' ? null : f.problem.value, items: items.map((i) => ({ name: i.name.trim(), detail: i.detail.trim() })).filter((i) => i.name), note: f.note.value.trim() };
    const btn = $('#save'); busy(btn, true);
    try {
      const saved = r ? await routines.update(r.id, row) : await routines.create(row);
      toast('Routine saved');
      const base = back.replace(/([?&])r=[^&]*(&|$)/, '$1').replace(/[?&]$/, '');
      go(base.includes('/exercise') ? `${base}${base.includes('?') ? '&' : '?'}r=${saved.id}` : base);
    } catch (err) { busy(btn, false); $('.err').textContent = errMsg(err); }
  };
}

/* ---------- timeline across everything ---------- */
async function renderTimeline() {
  shell({ tab: 'timeline', body: '<h1 class="h1">Timeline</h1><div id="pf"></div><div id="tl"><p class="empty">Loading…</p></div>' });
  const [list, all] = await Promise.all([problems.list(), entries.list({ limit: 2000 })]);
  const names = Object.fromEntries(list.map((p) => [p.id, p.title]));
  $('#pf').innerHTML = `<select aria-label="Problem" class="wide-select"><option value="">All problems</option>${list.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}<option value="none">General</option></select>`;
  const paint = (pid) => timeline($('#tl'), pid ? all.filter((e) => (pid === 'none' ? !e.problem_id : e.problem_id === pid)) : all, { problemName: (e) => names[e.problem_id] || 'General' });
  $('#pf select').onchange = (e) => paint(e.target.value);
  paint('');
}

/* ---------- doctor summary ---------- */
/* ---------- reports (v2): daily, weekly, monthly, yearly; one report, two versions ---------- */
const RTYPES = [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']];
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
let reportCss = false;
function ensureReportCss() {
  if (reportCss) return; reportCss = true;
  const st = document.createElement('style'); st.textContent = REPORT_CSS; document.head.append(st);
}
async function renderReports() {
  const ps = params();
  const pid = ps.get('p') || '';
  const [list, past, all] = await Promise.all([problems.list().catch(() => []), reports.list(null).catch(() => []), entries.list({ limit: 5000 }).catch(() => [])]);
  const chosen = pid || list.find((p) => p.status === 'active')?.id || '';
  const tz = localTz();
  const today = zoned(Date.now(), tz).key;
  const firstYear = all.length ? +zoned(all[all.length - 1].at, tz).key.slice(0, 4) : +today.slice(0, 4);
  let type = RTYPES.some(([k]) => k === ps.get('type')) ? ps.get('type') : 'week';
  let anchor = today;
  shell({
    tab: 'reports',
    body: `<h1 class="h1">Reports</h1>
      <p class="muted">One report with two versions: <b>for your doctor</b> and <b>for you</b>. Charts and numbers come straight from your entries; Claude writes the explanations. You check it before it is final.</p>
      <form id="f" class="stack">
        <div class="card stack">
          <label class="field">About<select name="problem">${list.map((p) => `<option value="${p.id}" ${p.id === chosen ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}<option value="" ${!chosen ? 'selected' : ''}>All problems</option></select></label>
          <div class="field">Report<div class="seg" role="radiogroup" id="rtype">${RTYPES.map(([k, l]) => `<button type="button" role="radio" data-k="${k}" aria-checked="${k === type}">${l}</button>`).join('')}</div></div>
          <div id="anchor"></div>
          <div class="period-box" id="pbox" aria-live="polite"></div>
          <label class="field">Anything it should look at? <span class="hint">optional</span><input name="reason" maxlength="300" placeholder="e.g. Is driving making it worse?"></label>
        </div>
        <div class="card consent">
          <label class="check"><input type="checkbox" name="consent" required> <span>Send the entries for this period to <b>Claude, Anthropic’s AI</b>, to write the explanations. Dr Pocket’s server does not keep a copy; the report is saved in your account.</span></label>
        </div>
        <p class="err" role="alert"></p>
        <button class="btn primary big">${icon('sparkle')} Create report</button>
      </form>
      ${past.length ? `<div class="sec-h"><h2>Earlier reports</h2></div><ul class="cards">${past.map((r) => `<li><a class="card prob" href="#/r/${r.id}"><div class="prob-h"><div><span class="eyebrow">${r.kind === 'feedback' ? 'Feedback (old style)' : /· (Daily|Weekly|Monthly|Yearly) ·/.test(r.range_label) ? 'Report' : 'Doctor summary (old style)'}</span><b>${esc(r.range_label)}</b><span class="muted small">Created ${esc(fmtDate(r.created_at))}</span></div>${icon('chevron')}</div>${r.headline ? `<span class="small">${esc(r.headline)}</span>` : ''}</a></li>`).join('')}</ul>` : ''}`,
  });
  const f = $('#f');
  const paintAnchor = () => {
    const host = $('#anchor');
    if (type === 'day') host.innerHTML = `<label class="field">Day<input type="date" class="dt" name="a" max="${today}" value="${anchor}"></label>`;
    else if (type === 'week') host.innerHTML = `<label class="field">Week ending on<input type="date" class="dt" name="a" max="${today}" value="${anchor}"></label>`;
    else if (type === 'month') host.innerHTML = `<label class="field">Month<input type="month" class="dt" name="a" max="${today.slice(0, 7)}" value="${anchor.slice(0, 7)}"></label>`;
    else { const ys = []; for (let y = +today.slice(0, 4); y >= Math.min(firstYear, +today.slice(0, 4)); y--) ys.push(y); host.innerHTML = `<label class="field">Year<select name="a">${ys.map((y) => `<option ${String(y) === anchor.slice(0, 4) ? 'selected' : ''}>${y}</option>`).join('')}</select></label>`; }
    host.querySelector('[name=a]').onchange = (ev) => {
      const v = ev.target.value; if (!v) return;
      anchor = type === 'month' ? `${v}-${v === today.slice(0, 7) ? today.slice(8) : '01'}` : type === 'year' ? (v === today.slice(0, 4) ? today : `${v}-12-31`) : v;
      if (type === 'month' && v !== today.slice(0, 7)) anchor = `${v}-01`;
      paintBox();
    };
  };
  const paintBox = () => {
    const per = periodFor(type, anchor);
    const scope = f.problem.value;
    const src = all.filter((e) => !scope || e.problem_id === scope || e.kind === 'day');
    const m = buildModel({ source: src, problems: list, problemId: scope || null, period: per, tz, now: Date.now() });
    $('#pbox').innerHTML = `<b>${esc(m.label)}</b><span>${per.type === 'day' ? esc(dayWd(per.start)) : `${esc(dayWd(per.start))} ${per.start.slice(0, 4)} – ${esc(dayWd(per.end))} ${per.end.slice(0, 4)}`}</span><span class="${m.stats.entries ? '' : 'warn'}">${esc(coverageLine(m))}${m.stats.readings ? ` · ${n(m.stats.readings, 'pain reading')}` : ''}</span>`;
    f.querySelector('.primary').disabled = !m.stats.entries;
  };
  $$('#rtype button').forEach((b) => { b.onclick = () => { type = b.dataset.k; $$('#rtype button').forEach((x) => x.setAttribute('aria-checked', String(x === b))); if (type === 'month' || type === 'year') anchor = today; paintAnchor(); paintBox(); }; });
  f.problem.onchange = paintBox;
  paintAnchor(); paintBox();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = f.querySelector('.primary'); busy(btn, true, 'Writing your report… (up to a minute or two)'); $('.err').textContent = '';
    try {
      const out = await reports.draw({ type, anchor, problem: f.problem.value || null, reason: f.reason.value.trim(), consent: true });
      go(`#/r/${out.id}`);
    } catch (err) { busy(btn, false); $('.err').textContent = errMsg(err); }
  };
}

function statementsOf(nv, aud) {
  const out = []; const x = nv?.[aud] || {};
  const add = (field, label) => (x[field] || []).forEach((it, i) => out.push({ sid: `${aud}.${field}.${i}`, label: `${label}: ${it.activity ? `${it.activity}: ` : ''}${it.text}` }));
  add('summary', 'Summary'); add('attention', 'Mention promptly'); add('harder_with', AUD_LABELS[aud][0]); add('easier_after', AUD_LABELS[aud][1]);
  add('sequences', 'What happened'); add('function_effects', 'Effect'); add('treatments', 'Treatment'); add('changes', 'Change');
  return out;
}
const AUD_LABELS = { doctor: ['Discomfort reported with', 'Relief reported after'], me: ['Harder with', 'Easier after'] };
const clip = (s, k = 70) => (s.length > k ? `${s.slice(0, k - 1).trim()}…` : s);
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function renderReport2(r) {
  ensureReportCss();
  const id = r.id; let c = r.content;
  const aud = params().get('a') === 'me' ? 'me' : 'doctor';
  const model = () => buildModel({ source: c.source, problems: c.problems, problemId: c.problem_id, period: periodFor(c.period.type, c.period.end), tz: c.tz, now: c.generated_at, earlier: c.earlier, corrections: c.review?.corrections || [] });
  const m = model();
  const rv = { status: 'draft', additions: [], corrections: [], ...(c.review || {}) };
  const pending = rv.corrections.filter((x) => x.status === 'pending');
  const confirmed = rv.status === 'confirmed';
  const canShareFiles = (() => { try { return !!navigator.canShare?.({ files: [new File([''], 'a.pdf', { type: 'application/pdf' })] }); } catch { return false; } })();
  shell({
    back: '#/reports', tab: 'reports',
    body: `
      <div class="rv-top">
        <div class="seg" role="tablist" aria-label="Version">${[['doctor', 'For my doctor'], ['me', 'For me']].map(([k, l]) => `<a role="tab" href="#/r/${id}${k === 'me' ? '?a=me' : ''}" aria-selected="${k === aud}">${l}</a>`).join('')}</div>
        <span class="rv-badge ${confirmed ? 'ok' : 'draft'}">${confirmed ? `${icon('check')} Reviewed` : 'Draft'}</span>
      </div>
      ${confirmed ? '' : `<button type="button" class="rv-jump" id="jump"><span>${pending.length ? 'A correction is waiting for you to confirm.' : 'Read it through, then tell us if it is accurate.'}</span><b>Review ↓</b></button>`}
      <div id="doc">${reportHTML(m, c.narrative, { audience: aud, review: rv, generatedAt: c.generated_at })}</div>
      <section class="card review no-print" id="review">
        ${pending.length ? `<h3>${n(pending.length, 'correction')} waiting</h3>
          <p>Confirm to update the summaries, graphs and statistics with your correction. Your original entries stay as they are, and the correction is listed in the report.</p>
          <p class="small muted">This sends the entries and your correction to Claude again to rewrite the explanations.</p>
          <div class="row-btns"><button class="btn primary big" id="apply">${icon('check')} Confirm and update report</button><button class="btn big" id="discard">Discard</button></div>`
        : `<h3>${confirmed ? `Reviewed by you on ${esc(fmtDate(rv.confirmed_at))}` : 'Does this report accurately reflect your experience? Is there anything you’d like your doctor to know?'}</h3>
          ${confirmed ? '<p class="muted small">You can still add or correct something; the report then goes back to draft until you confirm it again. Reviewed means you checked it, not that a clinician verified it.</p>' : ''}
          <div class="row-btns">${confirmed ? '' : `<button class="btn primary big" id="finish">${icon('check')} Looks accurate — finish</button>`}<button class="btn big" id="addfix">${icon('edit')} Add or correct something</button></div>`}
        <form id="fix" class="stack" hidden>
          <div class="seg" role="radiogroup" id="fixkind"><button type="button" role="radio" data-k="add" aria-checked="true">Add context</button><button type="button" role="radio" data-k="fix" aria-checked="false">Correct something</button></div>
          <div id="fixwhat" class="stack" hidden>
            <label class="field">What is wrong?<select name="target"><option value="">Choose…</option>
              <optgroup label="A journal entry">${m.rows.map((row) => `<option value="entry:${row.ref}">${esc(`${row.ref} · ${dayShort(row.key)}${row.timed ? ` ${row.time}` : ''} · ${clip(row.e.body || activityPhrase(row.e) || 'entry', 48)}`)}</option>`).join('')}</optgroup>
              <optgroup label="A statement in this report">${statementsOf(c.narrative, aud).map((s) => `<option value="statement:${s.sid}">${esc(clip(s.label, 80))}</option>`).join('')}</optgroup>
            </select></label>
            <label class="field" id="painfix" hidden>Pain score for this entry<select name="pain"><option value="keep">Keep as recorded</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => `<option value="${v}">${v}/10</option>`).join('')}<option value="none">No score (remove it)</option></select></label>
          </div>
          <label class="field">What would you like to add or correct?<textarea name="text" rows="4" required placeholder="In your own words"></textarea></label>
          <div id="fixdict"></div>
          <p class="err" role="alert"></p>
          <div class="row-btns"><button class="btn primary big" id="fixsave">${icon('check')} Add to report</button><button type="button" class="btn big" id="fixcancel">Cancel</button></div>
        </form>
      </section>
      <div class="row-btns no-print">
        <button class="btn primary big" id="dl" ${confirmed ? '' : 'disabled'}>${icon('download')} Download PDF</button>
        ${canShareFiles ? `<button class="btn big" id="share" ${confirmed ? '' : 'disabled'}>${icon('share')} Share</button>` : ''}
      </div>
      ${confirmed ? '' : '<p class="small muted center no-print">Finish your review to download or share this report.</p>'}
      <button class="btn danger wide no-print" id="del">${icon('trash')} Delete this report</button>`,
  });
  $('#jump')?.addEventListener('click', () => $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  const save = async (review) => { c = { ...c, review }; await reports.saveContent(id, c); };
  // Tapping a source link (E3) or a day on the month chart scrolls to the entries in the table.
  const flash = (row) => { if (!row) return; row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1600); };
  $('#doc').addEventListener('click', (ev) => {
    const a = ev.target.closest('a.ref'); if (a) { ev.preventDefault(); flash($(`#src-${a.dataset.ref}`)); return; }
    const d = ev.target.closest('[data-day]'); if (d && d.tagName !== 'TR') { flash($(`.rd-table tr[data-day="${d.dataset.day}"]`)); return; }
    const mo = ev.target.closest('rect[data-month]'); if (mo) { const det = $(`.rd-months details[data-month="${mo.dataset.month}"]`); if (det) { det.open = true; det.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
  });
  $('#finish')?.addEventListener('click', async (ev) => { busy(ev.currentTarget, true, 'Saving…'); await save({ ...rv, status: 'confirmed', confirmed_at: new Date().toISOString() }).catch((e) => toast(errMsg(e))); toast('Report finished'); route(); });
  $('#discard')?.addEventListener('click', async () => { await save({ ...rv, corrections: rv.corrections.filter((x) => x.status !== 'pending') }); route(); });
  $('#apply')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget; busy(btn, true, 'Updating your report… (up to a minute or two)');
    try { await reports.draw({ action: 'regenerate', id, consent: true }); toast('Report updated'); route(); } catch (err) { busy(btn, false); toast(errMsg(err)); }
  });
  const fix = $('#fix'); let fkind = 'add';
  $('#addfix')?.addEventListener('click', () => { fix.hidden = false; $('#addfix').hidden = true; fix.text.focus(); });
  $('#fixcancel').onclick = () => { fix.hidden = true; if ($('#addfix')) $('#addfix').hidden = false; };
  $$('#fixkind button').forEach((b) => { b.onclick = () => { fkind = b.dataset.k; $$('#fixkind button').forEach((x) => x.setAttribute('aria-checked', String(x === b))); $('#fixwhat').hidden = fkind !== 'fix'; $('#fixsave').lastChild.textContent = fkind === 'fix' ? ' Save correction' : ' Add to report'; }; });
  fix.target.onchange = () => { $('#painfix').hidden = !fix.target.value.startsWith('entry:'); };
  stopDictation.push(dictation($('#fixdict'), fix.text));
  fix.onsubmit = async (ev) => {
    ev.preventDefault();
    const text = fix.text.value.trim(); if (!text) return;
    const now = new Date().toISOString(); const uid = Math.random().toString(36).slice(2, 10);
    let review;
    if (fkind === 'add') review = { ...rv, status: 'draft', confirmed_at: null, additions: [...rv.additions, { id: uid, at: now, text }] };
    else {
      const [t, key] = fix.target.value.split(':');
      if (!t) { $('#fix .err').textContent = 'Choose what the correction is about.'; return; }
      const target = t === 'entry'
        ? (() => { const row = m.byRef[key]; return { type: 'entry', ref: key, id: row.id, original: row.painOriginal, label: `${key}, ${dayShort(row.key)}${row.timed ? ` ${row.time}` : ''}: “${clip(row.e.body || activityPhrase(row.e) || 'entry', 60)}”` }; })()
        : { type: 'statement', sid: key, label: `“${clip(statementsOf(c.narrative, aud).find((s) => s.sid === key)?.label || key, 120)}”` };
      const corr = { id: uid, at: now, target, text, status: 'pending' };
      if (t === 'entry' && fix.pain.value !== 'keep') corr.pain = fix.pain.value === 'none' ? null : Number(fix.pain.value);
      review = { ...rv, status: 'draft', confirmed_at: null, corrections: [...rv.corrections, corr] };
    }
    const btn = $('#fixsave'); busy(btn, true, 'Saving…');
    try { await save(review); toast(fkind === 'add' ? 'Added to the report' : 'Correction saved'); route(); } catch (err) { busy(btn, false); $('#fix .err').textContent = errMsg(err); }
  };
  const getPdf = async (btn) => {
    busy(btn, true, 'Making the PDF…');
    try { const blob = await reports.pdf(id, aud); return new File([blob], `Dr-Pocket-${m.period.type}-report-${m.period.start}${aud === 'me' ? '-for-me' : '-for-doctor'}.pdf`, { type: 'application/pdf' }); }
    finally { busy(btn, false); }
  };
  $('#dl').onclick = async (ev) => {
    try {
      const file = await getPdf(ev.currentTarget);
      if (isIOS() && canShareFiles) { await navigator.share({ files: [file], title: 'Dr Pocket report' }).catch(() => {}); return; }
      const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) { toast(errMsg(err)); }
  };
  $('#share')?.addEventListener('click', async (ev) => { try { const file = await getPdf(ev.currentTarget); await navigator.share({ files: [file], title: 'Dr Pocket report' }).catch(() => {}); } catch (err) { toast(errMsg(err)); } });
  $('#del').onclick = async () => { if (!confirm('Delete this report? Your entries stay.')) return; await reports.remove(id).catch(() => {}); go('#/reports'); };
}

function weeklyChart(series) {
  if (!series || series.length < 2) return '';
  const W = 340; const H = 130; const L = 24; const B = 22; const T = 10;
  const t0 = +D(series[0].d); const t1 = +D(series[series.length - 1].d);
  const x = (d) => L + ((+D(d) - t0) / Math.max(1, t1 - t0)) * (W - L - 10);
  const y = (v) => T + (1 - v / 10) * (H - T - B);
  return `<figure class="card chart"><div class="card-h"><h3>Recorded pain <span class="muted">(weekly average)</span></h3></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly average of recorded pain scores">
      <g class="grid">${[0, 5, 10].map((v) => `<line x1="${L}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`).join('')}</g>
      <path class="line" d="${series.map((s, i) => `${i ? 'L' : 'M'}${x(s.d).toFixed(1)},${y(s.avg).toFixed(1)}`).join(' ')}"/>
      ${series.map((s) => `<circle class="dot ${painLevel(s.avg)}" cx="${x(s.d).toFixed(1)}" cy="${y(s.avg).toFixed(1)}" r="4"><title>Week of ${fmtDate(s.d)}: ${s.avg} (${s.n} scores)</title></circle>`).join('')}
      <g class="ticks"><text x="${L}" y="${H - 5}">${fmtDate(series[0].d)}</text><text x="${W - 10}" y="${H - 5}" text-anchor="end">${fmtDate(series[series.length - 1].d)}</text></g>
    </svg></figure>`;
}

async function renderReport(id) {
  let r;
  try { r = await reports.get(id); } catch { return go('#/reports'); }
  if (r.content?.v === 2) return renderReport2(r);
  if (r.kind === 'feedback') return renderFeedback(r);
  const c = r.content || {}; const s = c.stats || {};
  const refs = c.refs || {};
  const src = (ids) => (ids || []).filter((k) => refs[k]).map((k) => `<a class="src" href="#/e/${refs[k].id}">${esc(refs[k].date)}</a>`).join('');
  const items = (title, arr, cls = '') => (arr?.length ? `<section class="card rsec ${cls}"><div class="card-h"><h3>${esc(title)}</h3></div><ul class="plain">${arr.map((it) => `<li>${esc(it.text)} ${src(it.refs)}</li>`).join('')}</ul></section>` : '');
  const plainText = () => [
    'Dr Pocket · Doctor summary', r.range_label,
    `Reporting period: ${r.range_from ? fmtDate(r.range_from) : 'the beginning'} to ${fmtDate(r.range_to)}. Created ${fmtDate(r.created_at)}.`, '',
    c.reason_for_visit ? `Reason for visit: ${c.reason_for_visit}` : '', c.overview || '', '',
    ...[['Mention soon', c.urgent], ['Symptom chronology', c.chronology], ['Changes over the period', c.changes], ['Functional limitations', c.limitations], ['Activities and exercise', c.activities], ['Triggers and relief', c.triggers_relief]]
      .flatMap(([t, a]) => (a?.length ? [t, ...a.map((it) => `- ${it.date ? `${it.date}: ` : ''}${it.text}`), ''] : [])),
    ...(c.questions?.length ? ['Questions to discuss', ...c.questions.map((q) => `- ${q}`), ''] : []),
    'Patient-reported information, summarised by Claude (Anthropic) from the patient’s own journal. Not a diagnosis.',
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  shell({
    back: '#/reports', tab: 'reports',
    body: `
      <div class="print-only">${lockup(28)}</div>
      <p class="eyebrow">Doctor summary</p>
      <h1 class="h1">${esc(r.range_label)}</h1>
      <p class="muted small">Reporting period: ${esc(r.range_from ? fmtDate(r.range_from) : 'the beginning')} to ${esc(fmtDate(r.range_to))} · Created ${esc(fmtDate(r.created_at))}, ${esc(fmtTime(r.created_at))}</p>
      <div class="notice">${icon('info')} Patient-reported information, summarised from the journal. Not a diagnosis.</div>
      ${items('Mention soon', c.urgent, 'alert')}
      ${c.reason_for_visit ? `<section class="card rsec"><div class="card-h"><h3>Reason for visit</h3></div><p>${esc(c.reason_for_visit)}</p></section>` : ''}
      ${c.overview ? `<section class="card rsec"><div class="card-h"><h3>Overview</h3></div><p class="pre">${esc(c.overview)}</p></section>` : ''}
      <div class="stats">
        <div class="stat"><span><small>Entries</small><b>${s.entries ?? '—'}</b></span></div>
        <div class="stat"><span><small>Pain scores</small><b>${s.pain_n ?? 0}</b></span></div>
        <div class="stat"><span><small>Recorded pain</small><b>${s.pain_n ? `${s.pain_min}–${s.pain_max}` : '—'}</b>${s.pain_n ? '/10' : ''}</span></div>
      </div>
      ${weeklyChart(s.pain_weekly)}
      ${c.chronology?.length ? `<section class="card rsec"><div class="card-h"><h3>Symptom chronology</h3></div><ol class="chrono">${c.chronology.map((it) => `<li><span class="chrono-d">${esc(it.date)}</span><span>${esc(it.text)} ${src(it.refs)}</span></li>`).join('')}</ol></section>` : ''}
      ${items('Changes over the period', c.changes)}
      ${items('Functional limitations', c.limitations)}
      ${items('Activities and exercise', c.activities)}
      ${items('Triggers and relief', c.triggers_relief)}
      ${c.questions?.length ? `<section class="card rsec"><div class="card-h"><h3>Questions to discuss</h3></div><ul class="plain">${c.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></section>` : ''}
      ${c.gaps?.length ? `<section class="card rsec"><div class="card-h"><h3>Not recorded</h3></div><ul class="plain muted">${c.gaps.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></section>` : ''}
      <p class="small muted">Written by Claude, Anthropic’s AI, from the patient’s own entries. Dates link to those entries. It can contain mistakes.</p>
      <div class="row-btns no-print">
        <button class="btn primary big" id="pdf">${icon('download')} Export PDF</button>
        <button class="btn big" id="copy">${icon('copy')} Copy</button>
        ${navigator.share ? `<button class="btn big" id="share">${icon('share')} Share</button>` : ''}
      </div>
      <button class="btn danger wide no-print" id="del">${icon('trash')} Delete this summary</button>`,
  });
  $('#pdf').onclick = () => window.print();
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(plainText()); toast('Copied'); } catch { toast('Could not copy'); } };
  $('#share')?.addEventListener('click', () => navigator.share({ title: 'Doctor summary', text: plainText() }).catch(() => {}));
  $('#del').onclick = async () => { if (!confirm('Delete this summary? Your entries stay.')) return; await reports.remove(id).catch(() => {}); go('#/reports'); };
}

// Feedback for the person: friendly, with suggestions. Same rules as the doctor summary: only what was
// recorded, every point linked to its entries, guesses labelled as guesses, no diagnosis.
function renderFeedback(r) {
  const c = r.content || {}; const s = c.stats || {}; const refs = c.refs || {};
  const src = (ids) => (ids || []).filter((k) => refs[k]).map((k) => `<a class="src" href="#/e/${refs[k].id}">${esc(refs[k].date)}</a>`).join('');
  const items = (title, arr, cls = '', ic = '') => (arr?.length ? `<section class="card rsec ${cls}"><div class="card-h"><h3>${ic ? icon(ic) : ''}${esc(title)}</h3></div><ul class="plain">${arr.map((it) => `<li>${esc(it.text)} ${src(it.refs)}</li>`).join('')}</ul></section>` : '');
  const plainText = () => ['Dr Pocket · Feedback', r.range_label, c.headline || '', c.overview || '',
    ...[['Going well', c.going_well], ['Harder', c.harder], ['Patterns', c.patterns]].flatMap(([t, a]) => (a?.length ? [t, ...a.map((it) => `- ${it.text}`)] : [])),
    ...(c.suggestions?.length ? ['Ideas to try', ...c.suggestions.map((it) => `- ${it.text}${it.why ? ` (${it.why})` : ''}`)] : []),
    ...(c.to_track?.length ? ['Worth tracking', ...c.to_track.map((q) => `- ${q}`)] : []),
    ...(c.ask_clinician?.length ? ['Ask your doctor or physio', ...c.ask_clinician.map((q) => `- ${q}`)] : []),
    'Written by Claude (Anthropic) from your own entries. Not medical advice.'].filter(Boolean).join('\n');
  shell({
    back: '#/reports', tab: 'reports',
    body: `
      <div class="print-only">${lockup(28)}</div>
      <p class="eyebrow">Feedback for you</p>
      <h1 class="h1">${esc(c.headline || r.range_label)}</h1>
      <p class="muted small">${esc(r.range_label)} · ${esc(r.range_from ? fmtDate(r.range_from) : 'the beginning')} to ${esc(fmtDate(r.range_to))} · Created ${esc(fmtDate(r.created_at))}</p>
      ${items('Mention to your doctor soon', c.urgent, 'alert', 'info')}
      ${c.overview ? `<section class="card rsec"><div class="card-h"><h3>${icon('sparkle')} How it went</h3></div><p class="pre">${esc(c.overview)}</p></section>` : ''}
      <div class="stats">
        <div class="stat"><span><small>Entries</small><b>${s.entries ?? '—'}</b></span></div>
        <div class="stat"><span><small>Check-ins</small><b>${s.checkins ?? 0}</b></span></div>
        <div class="stat"><span><small>Recorded pain</small><b>${s.pain_n ? `${s.pain_min}–${s.pain_max}` : '—'}</b>${s.pain_n ? '/10' : ''}</span></div>
      </div>
      ${weeklyChart(s.pain_weekly)}
      ${items('Going well', c.going_well, 'good')}
      ${items('Harder', c.harder, 'bad')}
      ${items('Patterns in what you recorded', c.patterns)}
      ${c.suggestions?.length ? `<section class="card rsec"><div class="card-h"><h3>Ideas to try</h3></div><ul class="plain">${c.suggestions.map((it) => `<li><b>${esc(it.text)}</b>${it.why ? `<br><span class="small muted">${esc(it.why)}</span>` : ''} ${src(it.refs)}</li>`).join('')}</ul></section>` : ''}
      ${c.to_track?.length ? `<section class="card rsec"><div class="card-h"><h3>Worth tracking</h3></div><ul class="plain">${c.to_track.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></section>` : ''}
      ${c.ask_clinician?.length ? `<section class="card rsec"><div class="card-h"><h3>Ask your doctor or physio</h3></div><ul class="plain">${c.ask_clinician.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></section>` : ''}
      ${c.gaps?.length ? `<section class="card rsec"><div class="card-h"><h3>Not recorded</h3></div><ul class="plain muted">${c.gaps.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></section>` : ''}
      <p class="small muted">Written by Claude, Anthropic’s AI, from your own entries. Dates link to them. Ideas are general, not medical advice; check with your doctor or physio before changing treatment.</p>
      <a class="btn big wide no-print" href="#/reports?kind=clinician${r.problem_id ? `&p=${r.problem_id}` : ''}">${icon('report')} Make a summary for my doctor</a>
      <div class="row-btns no-print">
        <button class="btn big" id="copy">${icon('copy')} Copy</button>
        <button class="btn big" id="pdf">${icon('download')} PDF</button>
      </div>
      <button class="btn danger wide no-print" id="del">${icon('trash')} Delete this feedback</button>`,
  });
  $('#pdf').onclick = () => window.print();
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(plainText()); toast('Copied'); } catch { toast('Could not copy'); } };
  $('#del').onclick = async () => { if (!confirm('Delete this feedback? Your entries stay.')) return; await reports.remove(r.id).catch(() => {}); go('#/reports'); };
}

/* ---------- evening reminder (web push) ---------- */
const b64ToBytes = (b) => { const s = atob((b + '='.repeat((4 - (b.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (ch) => ch.charCodeAt(0)); };
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function pushState() {
  if (!pushSupported()) return 'unsupported';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'on' : (Notification.permission === 'denied' ? 'blocked' : 'off');
}
async function pushOn() {
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked. Allow them for Dr Pocket in your phone’s Settings, then try again.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Johannesburg' }, { onConflict: 'endpoint' });
  if (error) { await sub.unsubscribe(); throw error; }
}
async function pushOff() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
}

/* ---------- settings ---------- */
function renderSettings() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const cur = currentMode();
  shell({
    back: '#/',
    body: `<h1 class="h1">Settings</h1>
      <section class="card stack"><div class="card-h"><h3>Appearance</h3></div>
        <div class="modes" role="radiogroup" aria-label="Appearance">${MODES.map((m) => `<button type="button" role="radio" class="mode" data-m="${m.id}" aria-checked="${m.id === cur}">${icon(m.icon)}<span><b>${m.name}${m.id === 'light' ? ' <span class="hint">default</span>' : ''}</b><small>${m.line}</small></span><i class="radio"></i></button>`).join('')}</div>
      </section>
      <section class="card stack"><div class="card-h"><h3>Evening reminder</h3><span class="hint">21:00</span></div>
        <p class="small">Every evening at 21:00, a notification with a quick summary of your day that opens your end-of-day check-in. It only counts what you recorded; nothing goes to an AI service.</p>
        <p class="small muted" id="push-note"></p>
        <button class="btn" id="push" hidden></button></section>
      <section class="card stack"><div class="card-h"><h3>Account</h3></div>
        <p class="small acct">${icon('user')} ${esc(session.user.email)}</p>
        <div class="row-btns"><a class="btn" href="#/password">Change password</a><button class="btn" id="out">Sign out</button></div></section>
      ${standalone ? '' : `<section class="card stack"><div class="card-h"><h3>Put Dr Pocket on your phone</h3></div>
        <p class="small">${ios ? 'In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.' : 'In Chrome, tap <b>⋮</b>, then <b>Install app</b> or <b>Add to Home screen</b>.'} It opens full screen with its own icon.</p>
        <p class="small muted">Added it before with the old icon? Remove it from the home screen and add it again to get the new one.</p></section>`}
      <section class="card stack"><div class="card-h"><h3>Tools</h3></div>
        <div class="tools"><a class="tool" href="/">${icon('body')}<span>3D body</span></a><a class="tool" href="/#report">${icon('scan')}<span>Explain a scan report</span></a><a class="tool" href="/shoulder/">${icon('pulse')}<span>Shoulder walkthrough</span></a></div></section>
      <section class="card stack"><div class="card-h"><h3>Privacy</h3></div>
        <p class="small">Your journal is stored in your Dr Pocket account and only you can see it. Insights are worked out on your device. Your entries are sent to an AI service only when you create a doctor summary and tick the box that agrees to it.</p>
        <button class="btn danger" id="del">Delete my account and everything in it</button></section>`,
  });
  const paintPush = async () => {
    const st = await pushState().catch(() => 'unsupported');
    const btn = $('#push'); const note = $('#push-note'); if (!btn) return;
    btn.hidden = st === 'unsupported';
    btn.textContent = st === 'on' ? 'Turn off the reminder' : 'Turn on the reminder';
    btn.className = st === 'on' ? 'btn' : 'btn primary';
    note.textContent = st === 'on' ? 'On for this device.' : st === 'blocked' ? 'Notifications are blocked for Dr Pocket. Allow them in your phone’s Settings, then come back.'
      : st === 'unsupported' ? (ios && !standalone ? 'On iPhone, add Dr Pocket to your Home Screen first (Share → Add to Home Screen), then open it from there and turn this on.' : 'This browser cannot show notifications.') : '';
    btn.onclick = async () => {
      busy(btn, true, st === 'on' ? 'Turning off…' : 'Turning on…');
      try { if (st === 'on') { await pushOff(); toast('Reminder off'); } else { await pushOn(); toast('Reminder on: 21:00 every evening'); } } catch (e) { toast(errMsg(e)); }
      busy(btn, false); paintPush();
    };
  };
  paintPush();
  $$('.mode').forEach((b) => { b.onclick = () => { applyMode(b.dataset.m); $$('.mode').forEach((x) => x.setAttribute('aria-checked', String(x === b))); }; });
  $('#out').onclick = async () => { await auth.signOut(); go('#/login'); };
  $('#del').onclick = async () => {
    if (prompt('This deletes your account and every problem, entry, file and summary. Type DELETE to confirm.') !== 'DELETE') return;
    try { await auth.deleteAccount(session.user.id); toast('Account deleted'); go('#/login'); } catch (e) { toast(errMsg(e)); }
  };
}

/* ---------- routing ---------- */
async function route() {
  const [path] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  if (!session) return parts[0] === 'signup' ? renderLogin('up') : renderLogin('in');
  try {
    switch (parts[0]) {
      case 'problems': return await renderProblems();
      case 'problem': return await renderProblemForm(parts[1] === 'new' ? null : parts[1]);
      case 'p': return await renderProblem(parts[1]);
      case 'e': return await renderEntry(parts[1]);
      case 'add': return await renderAdd();
      case 'exercise': return await renderExercise();
      case 'routine': return await renderRoutine(parts[1] === 'new' ? null : parts[1]);
      case 'timeline': return await renderTimeline();
      case 'reports': case 'report': return await renderReports();
      case 'r': return await renderReport(parts[1]);
      case 'settings': case 'account': case 'look': return renderSettings();
      case 'password': return renderPassword();
      case 'checkin': return await renderCheckin();
      default: return await renderHome();
    }
  } catch (e) {
    app.querySelector('.page')?.insertAdjacentHTML('afterbegin', `<p class="err">${esc(errMsg(e))}</p>`);
  }
}

applyMode(currentMode());
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
sb.auth.onAuthStateChange((event, s) => {
  const was = !!session;
  session = s;
  if (event === 'PASSWORD_RECOVERY') return go('#/password');
  if (was !== !!s && event !== 'INITIAL_SESSION') route();
});
auth.session().then((s) => { session = s; addEventListener('hashchange', route); route(); });
