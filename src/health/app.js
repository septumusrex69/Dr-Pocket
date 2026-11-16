// Dr Pocket: a personal health record and symptom journal (the brand + app guide of 16 Nov 2026).
// Problems hold dated entries: the person's own words (typed or dictated), an optional pain score,
// symptom tags, activity, triggers, relief and impact, plus exercise logs and files. Insights are
// worked out on the device from what was recorded; the doctor summary is written by Claude only when
// the person asks for it and agrees to send the entries.
import './health.css';
import { sb, auth, problems, entries, files, reports } from './db.js';
import { dictation } from './dictate.js';
import { icon, mark, lockup } from './icons.js';
import { MODES, currentMode, applyMode } from './appearance.js';

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
const ACTIVITIES = ['Sitting', 'Walking', 'Driving', 'Working', 'Exercise', 'Lifting', 'Sleeping', 'Resting'];

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
      <a class="top-c" href="#/" aria-label="Dr Pocket home">${lockup(24)}</a>
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
function titleOf(e) {
  if (e.kind === 'exercise') return e.exercise?.name || 'Exercise';
  const t = (e.body || '').trim();
  if (!t) return e.pain != null ? 'Pain score' : (e.files?.length ? 'File added' : 'Note');
  const first = t.split(/(?<=[.!?])\s|\n/)[0];
  return first.length > 64 ? `${first.slice(0, 62).trim()}…` : first;
}
function summaryOf(e) {
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
  if (e.kind === 'exercise') tags.push(`${icon('dumbbell')}Exercise`);
  else if (e.activity) tags.push(`${icon('walk')}${esc(e.activity)}`);
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
    if (text) shown = shown.filter((e) => `${e.body} ${e.exercise?.name || ''} ${(e.symptoms || []).join(' ')} ${e.activity} ${e.triggers} ${e.relief} ${e.impact}`.toLowerCase().includes(text));
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

// Pain over the last N days: recorded scores only, on a fixed 0–10 axis. Days without a score stay empty.
function painChart(list, days = 14) {
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const start = new Date(end); start.setDate(end.getDate() - days + 1); start.setHours(0, 0, 0, 0);
  const pts = list.filter((e) => e.pain != null && D(e.at) >= start && D(e.at) <= end).map((e) => ({ t: +D(e.at), v: e.pain, e })).sort((a, b) => a.t - b.t);
  const W = 340; const H = 150; const L = 24; const R = 10; const T = 12; const B = 24;
  const x = (t) => L + ((t - start) / (end - start)) * (W - L - R);
  const y = (v) => T + (1 - v / 10) * (H - T - B);
  const grid = [0, 2, 4, 6, 8, 10].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`).join('');
  const ticks = [];
  for (let i = 0; i < days; i += Math.ceil(days / 7)) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    ticks.push(`<text x="${x(+d + 43200000)}" y="${H - 6}" text-anchor="middle">${d.getDate()} ${d.toLocaleDateString('en-ZA', { month: 'short' })}</text>`);
  }
  const last = pts[pts.length - 1];
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const label = pts.length ? `${n(pts.length, 'pain score')} in the last ${days} days, from ${Math.min(...pts.map((p) => p.v))} to ${Math.max(...pts.map((p) => p.v))} out of 10. Latest ${last.v}.` : `No pain scores recorded in the last ${days} days.`;
  return `<figure class="card chart">
    <div class="card-h"><h3>Pain trend <span class="muted">(last ${days} days)</span></h3>${last ? `<span class="pain-chip ${painLevel(last.v)}">${last.v}/10</span>` : ''}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      <g class="grid">${grid}</g><g class="ticks">${ticks.join('')}</g>
      ${pts.length > 1 ? `<path class="line" d="${path}"/>` : ''}
      ${pts.map((p) => `<circle class="dot ${painLevel(p.v)}" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4"><title>${esc(fmtWhen(p.e))}: ${p.v}/10</title></circle>`).join('')}
    </svg>
    <figcaption class="small muted">${esc(label)}${pts.length ? '' : ' Add a pain score when you write a note to see a trend here.'}</figcaption>
  </figure>`;
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
        <a class="qa" href="#/exercise">${icon('dumbbell')}<span><b>Log exercise</b><small>Sets, reps, minutes</small></span></a>
      </div>
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
      ${painChart(list, 14)}
      <div class="sec-h"><h2>Timeline</h2></div>
      <div id="tl"></div>`;
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
  const acts = {}; list.forEach((e) => { const a = e.activity || (e.kind === 'exercise' ? 'Exercise' : ''); if (a) (acts[a] ||= []).push(e); });
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
        <div class="card stack" id="act"></div>
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
  const act = chipsPicker($('#act'), { options: ACTIVITIES, selected: editing?.activity ? [editing.activity] : [], multi: false, label: 'What were you doing?' });
  const picked = editing ? () => [] : filePicker($('#files'));
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const text = f.body.value.trim(); const pv = pain(); const fl = picked();
    const row = { body: text, pain: pv, symptoms: sym(), activity: act()[0] || '', triggers: f.triggers.value.trim(), relief: f.relief.value.trim(), impact: f.impact.value.trim() };
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
              symptoms: [...new Set([...(last.symptoms || []), ...row.symptoms])], activity: row.activity || last.activity,
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
      ${e.kind === 'exercise' ? `<section class="card"><div class="card-h"><h3>Exercise</h3></div><p>${esc([e.exercise?.name, summaryOf({ ...e, body: '' })].filter(Boolean).join(': '))}</p></section>` : ''}
      ${(e.symptoms?.length || (e.activity && e.kind !== 'exercise') || e.triggers || e.relief || e.impact) ? `<dl class="card details">
        ${field('Symptoms', (e.symptoms || []).join(', '))}${e.kind !== 'exercise' ? field('Doing', e.activity) : ''}${field('Trigger', e.triggers)}${field('What helped', e.relief)}${field('Impact', e.impact)}</dl>` : ''}
      ${(e.files || []).length ? `<div class="media">${e.files.map((f) => `<a class="media-item" href="${esc(urls[f.path] || '#')}" target="_blank" rel="noopener">${/^image\//.test(f.mime) && urls[f.path] ? `<img src="${esc(urls[f.path])}" alt="${esc(f.name)}">` : `<span class="media-file">${icon('file')}<small>${esc(f.name)}</small></span>`}</a>`).join('')}</div>` : ''}
      <p class="small muted">Written down ${esc(fmtDate(e.created_at))}, ${esc(fmtTime(e.created_at))}${e.edits?.length ? ` · edited ${n(e.edits.length, 'time')}` : ''}</p>
      ${e.edits?.length ? `<details class="card more"><summary>Earlier versions</summary><ol class="plain">${e.edits.slice().reverse().map((v) => `<li><span class="small muted">${esc(fmtDate(v.saved_at))}, ${esc(fmtTime(v.saved_at))}</span><p class="pre">${esc(v.body || '(no text)')}${v.pain != null ? ` · pain ${v.pain}/10` : ''}</p></li>`).join('')}</ol></details>` : ''}
      <div class="row-btns">
        <a class="btn big" href="${e.kind === 'exercise' ? `#/exercise?e=${e.id}` : `#/add?e=${e.id}`}">${icon('edit')} Edit</a>
        <button class="btn big danger" id="del">${icon('trash')} Delete</button>
      </div>`,
  });
  $('#del').onclick = async () => {
    if (!confirm('Delete this entry and its files?')) return;
    try { await entries.remove(e.id); toast('Deleted'); go(`#/p/${e.problem_id || 'none'}`); } catch (err) { toast(errMsg(err)); }
  };
}

/* ---------- log exercise ---------- */
async function renderExercise() {
  const ps = params(); const editing = ps.get('e');
  const [list, names, existing] = await Promise.all([problems.list().catch(() => []), entries.exerciseNames().catch(() => []), editing ? entries.get(editing) : null]);
  const x = existing?.exercise || {};
  const pid = existing ? (existing.problem_id || 'none') : (ps.get('p') || list.find((p) => p.status === 'active')?.id || 'none');
  shell({
    back: existing ? `#/e/${existing.id}` : (ps.get('p') ? `#/p/${pid}?t=exercise` : '#/'), tab: 'home',
    body: `<h1 class="h1">${editing ? 'Edit exercise' : 'Log exercise'}</h1>
      <form id="f" class="stack">
        <label class="field">For<select name="problem">${list.filter((p) => p.status !== 'archived' || p.id === pid).map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}<option value="none" ${pid === 'none' ? 'selected' : ''}>General (not one problem)</option></select></label>
        <div class="card stack">
          <label class="field">Exercise<input name="name" list="names" required placeholder="e.g. Band external rotation, walk, aerobics" value="${esc(x.name || '')}"><datalist id="names">${names.map((k) => `<option value="${esc(k)}">`).join('')}</datalist></label>
          <div class="four">
            <label class="field">Sets<input name="sets" type="number" inputmode="numeric" min="0" value="${esc(x.sets ?? '')}"></label>
            <label class="field">Reps<input name="reps" type="number" inputmode="numeric" min="0" value="${esc(x.reps ?? '')}"></label>
            <label class="field">Kg<input name="weight" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(x.weight ?? '')}"></label>
            <label class="field">Min<input name="minutes" type="number" inputmode="decimal" min="0" value="${esc(x.minutes ?? '')}"></label>
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
  const when = whenPicker($('#when'), existing);
  const pain = painPicker($('#pain'), existing?.pain ?? null, 'Pain during or after');
  stopDictation.push(dictation($('#dict'), f.body));
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const num = (v) => (v === '' ? null : Number(v));
    const w = when();
    const row = { problem_id: f.problem.value === 'none' ? null : f.problem.value, kind: 'exercise', exercise: { name: f.name.value.trim(), sets: num(f.sets.value), reps: num(f.reps.value), weight: num(f.weight.value), minutes: num(f.minutes.value), km: num(f.km.value) }, body: f.body.value.trim(), pain: pain(), at: w.at, time_known: w.time_known, activity: 'Exercise' };
    const btn = $('#save'); busy(btn, true);
    try { if (editing) await entries.update(editing, row); else await entries.create(row); toast('Exercise saved'); go(`#/p/${row.problem_id || 'none'}?t=exercise`); } catch (err) { busy(btn, false); $('.err').textContent = errMsg(err); }
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
const RANGES = [['14d', 'Last 14 days', 14], ['1m', 'Last month', 30], ['3m', 'Last 3 months', 91], ['6m', 'Last 6 months', 182], ['all', 'Everything', 0], ['custom', 'Choose dates', -1]];

async function renderReports() {
  const pid = params().get('p') || '';
  const [list, past] = await Promise.all([problems.list().catch(() => []), reports.list(null).catch(() => [])]);
  const chosen = pid || list.find((p) => p.status === 'active')?.id || '';
  shell({
    tab: 'reports',
    body: `<h1 class="h1">Doctor summary</h1>
      <p class="muted">A short, dated summary of what you recorded, for your next appointment. Every point links back to the entries it came from.</p>
      <form id="f" class="stack">
        <div class="card stack">
          <label class="field">About<select name="problem">${list.map((p) => `<option value="${p.id}" ${p.id === chosen ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}<option value="" ${!chosen ? 'selected' : ''}>All problems</option></select></label>
          <div class="lbl">Reporting period</div>
          <div class="chips" id="ranges">${RANGES.map(([k, l], i) => `<button type="button" class="chip-btn" data-k="${k}" aria-pressed="${i === 1}">${l}</button>`).join('')}</div>
          <div class="two" id="custom" hidden><label class="field">From<input type="date" name="from"></label><label class="field">To<input type="date" name="to"></label></div>
          <label class="field">Reason for this visit <span class="hint">optional</span><input name="reason" maxlength="300" placeholder="e.g. 6-week check after surgery"></label>
          <label class="check"><input type="checkbox" name="withFiles"> Include photos, X-rays and scans (slower)</label>
        </div>
        <div class="card consent">
          <label class="check"><input type="checkbox" name="consent" required> <span>Send the entries for this period to <b>Claude, Anthropic’s AI</b>, to write the summary. Dr Pocket’s server does not keep a copy; the summary is saved in your account.</span></label>
        </div>
        <p class="err" role="alert"></p>
        <button class="btn primary big">${icon('sparkle')} Create doctor summary</button>
      </form>
      ${past.length ? `<div class="sec-h"><h2>Earlier summaries</h2></div><ul class="cards">${past.map((r) => `<li><a class="card prob" href="#/r/${r.id}"><div class="prob-h"><div><b>${esc(r.range_label)}</b><span class="muted small">Created ${esc(fmtDate(r.created_at))}</span></div>${icon('chevron')}</div>${r.headline ? `<span class="small">${esc(r.headline)}</span>` : ''}</a></li>`).join('')}</ul>` : ''}`,
  });
  const f = $('#f'); let k = '1m';
  $$('#ranges button').forEach((b) => { b.onclick = () => { k = b.dataset.k; $$('#ranges button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#custom').hidden = k !== 'custom'; }; });
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const r = RANGES.find((x) => x[0] === k);
    let from = null; let to = new Date(); let label = r[1];
    if (r[2] > 0) { from = new Date(); from.setDate(from.getDate() - r[2]); }
    if (k === 'custom') {
      if (!f.from.value) { $('.err').textContent = 'Choose a start date.'; return; }
      from = new Date(`${f.from.value}T00:00`); to = f.to.value ? new Date(`${f.to.value}T23:59:59`) : new Date();
      label = `${fmtDate(from)} – ${fmtDate(to)}`;
    }
    const scope = f.problem.value;
    const name = scope ? list.find((p) => p.id === scope)?.title : 'All problems';
    const btn = f.querySelector('.primary'); busy(btn, true, 'Writing your summary… (up to a minute or two)'); $('.err').textContent = '';
    try {
      const out = await reports.draw({ problem: scope || null, from: from?.toISOString() || null, to: to.toISOString(), label: `${name} · ${label}`, reason: f.reason.value.trim(), withFiles: f.withFiles.checked, consent: true });
      go(`#/r/${out.id}`);
    } catch (err) { busy(btn, false); $('.err').textContent = errMsg(err); }
  };
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
      case 'timeline': return await renderTimeline();
      case 'reports': case 'report': return await renderReports();
      case 'r': return await renderReport(parts[1]);
      case 'settings': case 'account': case 'look': return renderSettings();
      case 'password': return renderPassword();
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
