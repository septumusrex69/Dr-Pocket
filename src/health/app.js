// My health: a private journal of medical problems. Each problem gets dated notes (typed or
// dictated), X-rays, scans and photos, and exercise logs; a progress report reads it all back
// over a chosen period and points out what is improving, what is getting worse and why it might be.
import './health.css';
import { sb, auth, problems, entries, files, reports } from './db.js';
import { dictation } from './dictate.js';
import { SKINS, currentSkin, applySkin } from './themes.js';

const app = document.getElementById('app');
let session = null;
let stopDictation = [];

/* ---------- small helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = app) => root.querySelector(sel);
const $$ = (sel, root = app) => [...root.querySelectorAll(sel)];
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

const AREAS = ['Head', 'Face / jaw', 'Eyes', 'Ears / nose / throat', 'Neck', 'Shoulder', 'Upper arm', 'Elbow', 'Forearm', 'Wrist / hand', 'Chest', 'Heart', 'Lungs / breathing', 'Upper back', 'Lower back', 'Abdomen / stomach', 'Pelvis / groin', 'Hip', 'Thigh', 'Knee', 'Lower leg / calf', 'Ankle / foot', 'Skin', 'Mental health / sleep', 'Whole body', 'Other'];
const SIDES = { none: '', left: 'Left', right: 'Right', both: 'Both sides' };
const STATUS = { active: 'Active', improving: 'Improving', resolved: 'Resolved' };
const OVERALL = { improving: 'Improving', stable: 'Stable', worsening: 'Getting worse', mixed: 'Mixed', too_little_data: 'Too little to tell' };

const fmtDate = (d) => new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
const fmtWhen = (d) => `${fmtDate(d)}, ${fmtTime(d)}`;
function dayLabel(d) {
  const x = new Date(d); const t = new Date();
  const k = (v) => `${v.getFullYear()}-${v.getMonth()}-${v.getDate()}`;
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (k(x) === k(t)) return 'Today';
  if (k(x) === k(y)) return 'Yesterday';
  return x.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
// <input type="datetime-local"> wants local time without a zone.
const localInput = (d = new Date()) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const where = (p) => [SIDES[p.side], p.area].filter(Boolean).join(' ');

function busy(btn, on, text) {
  if (!btn) return;
  if (on) { btn.dataset.t = btn.textContent; btn.textContent = text || 'Saving…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.t || btn.textContent; btn.disabled = false; }
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}
const errMsg = (e) => {
  const m = e?.message || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No connection. Check your signal and try again.';
  return m;
};

const ICON = {
  home: '<path d="M12 3 2 11h3v9h6v-6h2v6h6v-9h3z"/>',
  add: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>',
  run: '<path d="M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 13v-2a5.1 5.1 0 0 1-4.4-2.5l-1-1.6a2.1 2.1 0 0 0-2.6-.8L6 8.3V13h2V9.6z"/>',
  report: '<path d="M4 20h16v2H4zM6 10h3v8H6zm5-6h3v14h-3zm5 9h3v5h-3z"/>',
  me: '<path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5Z"/>',
};
const svgIcon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

function shell({ title, back = null, actions = '', body, tab = null }) {
  stopDictation.forEach((s) => s.stop()); stopDictation = [];
  const tabs = [['home', '#/', 'Home'], ['add', '#/add', 'Note'], ['run', '#/exercise', 'Exercise'], ['report', '#/report', 'Report'], ['me', '#/account', 'Me']];
  app.innerHTML = `
    <header class="bar">
      ${back ? `<a class="back" href="${back}" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z"/></svg></a>` : '<span class="logo" aria-hidden="true"></span>'}
      <h1>${esc(title)}</h1>
      <div class="bar-a">${actions}</div>
    </header>
    <main class="page">${body}</main>
    ${session ? `<nav class="tabs" aria-label="Main">${tabs.map(([k, href, label]) => `<a href="${href}" class="${k === 'add' ? 'tab-add' : ''}" ${tab === k ? 'aria-current="page"' : ''}>${svgIcon(k)}<span>${label}</span></a>`).join('')}</nav>` : ''}`;
  document.body.classList.toggle('has-tabs', !!session);
  window.scrollTo(0, 0);
}

function painPicker(host, value = null, label = 'Pain (0 = none, 10 = worst)') {
  host.innerHTML = `<div class="lbl">${esc(label)} <span class="muted small">optional</span></div>
    <div class="pain" role="group" aria-label="${esc(label)}">${Array.from({ length: 11 }, (_, i) => `<button type="button" data-v="${i}" aria-pressed="${value === i}" style="--p:${i}">${i}</button>`).join('')}</div>`;
  let v = value;
  host.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      const n = Number(b.dataset.v);
      v = v === n ? null : n;
      host.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.v) === v)));
    };
  });
  return () => v;
}

function filePicker(host) {
  host.innerHTML = `
    <div class="files-row">
      <label class="btn small"><input type="file" accept="image/*" capture="environment" hidden> Take a photo</label>
      <label class="btn small"><input type="file" accept="image/*,application/pdf" multiple hidden> Add X-ray, scan or file</label>
    </div>
    <ul class="picked"></ul>`;
  const picked = [];
  const list = host.querySelector('.picked');
  const paint = () => {
    list.innerHTML = picked.map((f, i) => `<li><span>${esc(f.name)}</span><button type="button" class="link" data-i="${i}" aria-label="Remove ${esc(f.name)}">Remove</button></li>`).join('');
    list.querySelectorAll('button').forEach((b) => { b.onclick = () => { picked.splice(Number(b.dataset.i), 1); paint(); }; });
  };
  host.querySelectorAll('input[type=file]').forEach((inp) => {
    inp.onchange = () => {
      for (const f of inp.files) {
        if (f.size > 25e6) { toast(`${f.name} is over 25 MB.`); continue; }
        picked.push(f);
      }
      inp.value = '';
      paint();
    };
  });
  return () => picked.slice();
}

function whenPicker(host) {
  host.innerHTML = `<div class="when"><span class="muted small">Date and time: <b class="when-now">now (set when you save)</b></span>
    <button type="button" class="link small">Change</button><input type="datetime-local" hidden></div>`;
  const inp = host.querySelector('input');
  host.querySelector('button').onclick = (e) => {
    inp.hidden = false; inp.value = localInput(); e.target.hidden = true;
    host.querySelector('.when-now').textContent = 'as set here:';
  };
  const get = () => (inp.hidden || !inp.value ? new Date().toISOString() : new Date(inp.value).toISOString());
  get.custom = () => !inp.hidden && !!inp.value;
  return get;
}

/* ---------- sign in ---------- */
function renderLogin(mode = 'in') {
  shell({
    title: 'Dr Pocket',
    body: `
    <section class="card login">
      <h2>${mode === 'up' ? 'Create your account' : 'Sign in to My health'}</h2>
      <p class="muted">Keep notes, X-rays and exercise for each health problem, on your phone and computer, and draw a progress report whenever you need one.</p>
      <form id="f" class="stack">
        <label>Email<input type="email" name="email" autocomplete="email" required></label>
        <label>Password<input type="password" name="password" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}" minlength="8" ${mode === 'up' ? 'required' : ''}></label>
        <p class="err" id="err" role="alert"></p>
        <p class="ok" id="ok" role="status"></p>
        <button class="btn primary" type="submit">${mode === 'up' ? 'Create account' : 'Sign in'}</button>
        ${mode === 'in' ? `<button class="btn" type="button" id="link">Email me a sign-in link</button>
        <button class="link" type="button" id="reset">Forgot password?</button>` : ''}
      </form>
      <p class="muted small center">${mode === 'up' ? 'Already have an account? <a href="#/login">Sign in</a>' : 'New here? <a href="#/signup">Create an account</a>'}</p>
    </section>
    <p class="muted small center">Your records are private to your account. This is a journal, not medical advice.</p>
    <p class="center"><a href="/">Open the 3D body</a></p>`,
  });
  const f = $('#f');
  const err = $('#err'); const ok = $('#ok');
  const say = (e, o = '') => { err.textContent = e || ''; ok.textContent = o; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const email = f.email.value.trim(); const password = f.password.value;
    if (mode === 'in' && !password) return say('Enter your password, or tap "Email me a sign-in link".');
    const btn = f.querySelector('[type=submit]');
    busy(btn, true, mode === 'up' ? 'Creating…' : 'Signing in…');
    const { data, error } = mode === 'up' ? await auth.signUp(email, password) : await auth.signIn(email, password);
    busy(btn, false);
    if (error) return say(/invalid login/i.test(error.message) ? 'That email and password do not match.' : /not confirmed/i.test(error.message) ? 'Confirm your email first: open the link we sent you.' : errMsg(error));
    if (mode === 'up' && !data.session) return say('', `Almost there: we sent a confirmation link to ${email}. Open it, then sign in here.`);
  };
  $('#link')?.addEventListener('click', async () => {
    const email = f.email.value.trim();
    if (!email) return say('Enter your email first.');
    const { error } = await auth.link(email);
    if (error && !/signups? not allowed/i.test(error.message)) return say(errMsg(error));
    say('', `A sign-in link is on its way to ${email}. Open it on this device. (In the installed phone app, the password is quicker: links open in the browser.)`);
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
  shell({
    title: 'New password', back: '#/',
    body: `<section class="card"><form id="f" class="stack">
      <label>New password<input type="password" name="p" minlength="8" autocomplete="new-password" required></label>
      <p class="err" id="err" role="alert"></p>
      <button class="btn primary">Save password</button></form></section>`,
  });
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await auth.setPassword(e.target.p.value);
    if (error) { $('#err').textContent = error.message; return; }
    toast('Password saved');
    go('#/');
  };
}

/* ---------- home: my problems ---------- */
async function renderHome() {
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  shell({
    title: 'My health', tab: 'home',
    body: `
      <section class="hero">
        <div class="hero-date">${esc(new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
        <div class="hero-hi">${hello}</div>
        <div class="hero-today" id="today">&nbsp;</div>
      </section>
      <div class="quick tiles">
        <a class="tile t1" href="#/add">${svgIcon('add')}<b>Add a note</b><span>Type or dictate</span></a>
        <a class="tile t2" href="#/exercise">${svgIcon('run')}<b>Log exercise</b><span>Sets, reps, minutes</span></a>
      </div>
      <div class="row sec-row"><h2 class="sec">Problems</h2><a class="link small" href="#/problem/new">+ New problem</a></div>
      <ul class="plist" id="list"><li class="muted">Loading…</li></ul>
      <a class="card general" href="#/p/none"><b>General notes and exercise</b><span class="muted small">Things not tied to one problem</span></a>
      <a class="btn wide" href="#/report">${svgIcon('report')} Draw a progress report</a>
      <p class="center small"><a href="/">Open the 3D body</a></p>`,
  });
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [list, today] = await Promise.all([problems.list(), entries.list({ from: start.toISOString(), limit: 200 })]);
    const t = $('#today');
    if (t) {
      const ex = today.filter((e) => e.kind === 'exercise').length;
      const pains = today.filter((e) => e.pain != null);
      t.textContent = today.length
        ? `Today: ${plural(today.length - ex, 'note')} · ${plural(ex, 'exercise')}${pains.length ? ` · pain ${pains[0].pain}/10` : ''}`
        : 'Nothing logged yet today.';
    }
    const ul = $('#list');
    if (!ul) return;
    if (!list.length) {
      ul.innerHTML = `<li class="empty card"><b>Start with your first problem</b><span class="muted">For example "Left shoulder pain" or "Lower back after the fall". Then add notes, X-rays and exercise to it as things happen.</span><a class="btn primary" href="#/problem/new">+ New problem</a></li>`;
      return;
    }
    const order = { active: 0, improving: 1, resolved: 2 };
    list.sort((a, b) => order[a.status] - order[b.status] || new Date(b.updated_at) - new Date(a.updated_at));
    ul.innerHTML = list.map((p) => `
      <li><a class="card prob ${p.status}" href="#/p/${p.id}">
        <div class="row"><b>${esc(p.title)}</b><span class="chip ${p.status}">${STATUS[p.status]}</span></div>
        <span class="muted small">${esc(where(p))} · ${p.count} ${p.count === 1 ? 'entry' : 'entries'} · updated ${esc(dayLabel(p.updated_at).toLowerCase())}</span>
      </a></li>`).join('');
  } catch (e) {
    $('#list').innerHTML = `<li class="err">${esc(errMsg(e))}</li>`;
  }
}

/* ---------- "Note" tab: pick where the note goes ---------- */
async function renderAdd() {
  shell({ title: 'Add a note', tab: 'add', body: '<p class="muted">Which problem is this about?</p><ul class="plist" id="list"><li class="muted">Loading…</li></ul>' });
  const list = (await problems.list()).filter((p) => p.status !== 'resolved');
  if (list.length === 1) return go(`#/p/${list[0].id}?add=1`);
  $('#list').innerHTML = list.map((p) => `<li><a class="card prob" href="#/p/${p.id}?add=1"><b>${esc(p.title)}</b><span class="muted small">${esc(where(p))}</span></a></li>`).join('')
    + '<li><a class="card prob" href="#/p/none?add=1"><b>General</b><span class="muted small">Not about one problem</span></a></li>'
    + '<li><a class="btn wide" href="#/problem/new">+ Something new</a></li>';
}

/* ---------- new / edit a problem ---------- */
async function renderProblemForm(id) {
  const p = id ? await problems.get(id) : { title: '', area: 'Other', side: 'none', detail: '', started_on: '', status: 'active' };
  shell({
    title: id ? 'Edit problem' : 'New problem', back: id ? `#/p/${id}` : '#/',
    body: `<section class="card"><form id="f" class="stack">
      <label>What is it?<input name="title" maxlength="200" required placeholder="e.g. Left shoulder pain" value="${esc(p.title)}"></label>
      <div class="two">
        <label>Area of the body<select name="area">${AREAS.map((a) => `<option ${a === p.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
        <label>Side<select name="side">${Object.entries({ none: 'Not applicable', left: 'Left', right: 'Right', both: 'Both' }).map(([k, v]) => `<option value="${k}" ${k === p.side ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <label>When did it start? <span class="muted small">optional</span><input type="date" name="started_on" value="${esc(p.started_on || '')}"></label>
      <label>Background <span class="muted small">optional: how it started, diagnosis, doctor, medication</span><textarea name="detail" rows="5">${esc(p.detail)}</textarea></label>
      <div id="dict"></div>
      ${id ? `<label>Status<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
      <p class="err" id="err" role="alert"></p>
      <button class="btn primary">${id ? 'Save' : 'Create problem'}</button>
      ${id ? '<button type="button" class="btn danger" id="del">Delete this problem and everything in it</button>' : ''}
    </form></section>`,
  });
  const f = $('#f');
  stopDictation.push(dictation($('#dict'), f.detail));
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('.primary');
    busy(btn, true);
    const row = { title: f.title.value.trim(), area: f.area.value, side: f.side.value, started_on: f.started_on.value || null, detail: f.detail.value.trim() };
    if (id) row.status = f.status.value;
    try {
      const saved = id ? await problems.update(id, row) : await problems.create(row);
      go(`#/p/${saved.id}`);
    } catch (err) { busy(btn, false); $('#err').textContent = errMsg(err); }
  };
  $('#del')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${p.title}" with all its notes, files, exercise and reports? This cannot be undone.`)) return;
    try { await problems.remove(id); toast('Deleted'); go('#/'); } catch (err) { $('#err').textContent = errMsg(err); }
  });
}

/* ---------- one problem: add a note, see the timeline ---------- */
function sparkline(list) {
  const pts = list.filter((e) => e.pain != null).map((e) => ({ t: +new Date(e.at), v: e.pain })).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return '';
  const t0 = pts[0].t; const t1 = pts[pts.length - 1].t || t0 + 1;
  const W = 300; const H = 70;
  const x = (t) => 6 + ((t - t0) / Math.max(1, t1 - t0)) * (W - 12);
  const y = (v) => 6 + (1 - v / 10) * (H - 12);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `<figure class="spark"><figcaption class="small muted">Pain over time · latest ${last.v}/10 · ${pts.length} readings</figcaption>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Pain from ${pts[0].v} to ${last.v} out of 10">
      <line x1="0" x2="${W}" y1="${y(5)}" y2="${y(5)}" class="mid"/><path d="${d}"/>
      ${pts.map((p) => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.6"/>`).join('')}
    </svg><div class="spark-ax small muted"><span>${fmtDate(pts[0].t)}</span><span>${fmtDate(last.t)}</span></div></figure>`;
}

function exerciseLine(x) {
  if (!x) return '';
  const bits = [];
  if (x.sets) bits.push(`${x.sets} × ${x.reps || '?'} reps`);
  else if (x.reps) bits.push(`${x.reps} reps`);
  if (x.weight) bits.push(`${x.weight} kg`);
  if (x.minutes) bits.push(`${x.minutes} min`);
  if (x.km) bits.push(`${x.km} km`);
  return `<div class="ex"><b>${esc(x.name || 'Exercise')}</b>${bits.length ? ` <span>${esc(bits.join(' · '))}</span>` : ''}</div>`;
}

async function renderProblem(id) {
  const general = id === 'none';
  let p;
  try {
    p = general ? { title: 'General notes and exercise', area: '', side: 'none', detail: '', status: 'active' } : await problems.get(id);
  } catch { return go('#/'); }
  shell({
    title: p.title, back: '#/',
    actions: general ? '' : `<a class="icon-btn" href="#/problem/${id}/edit" aria-label="Edit problem"><svg viewBox="0 0 24 24"><path d="M3 17.2V21h3.8L17.8 9.9l-3.7-3.7zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7z"/></svg></a>`,
    body: `
      ${general ? '' : `<div class="meta"><span class="chip ${p.status}">${STATUS[p.status]}</span><span class="muted small">${esc(where(p))}${p.started_on ? ` · since ${fmtDate(p.started_on)}` : ''}</span></div>
      ${p.detail ? `<details class="card bg"><summary>Background</summary><p class="pre">${esc(p.detail)}</p></details>` : ''}`}
      <div id="spark"></div>
      <section class="card compose">
        <h2>Add a note</h2>
        <textarea id="body" rows="4" placeholder="How is it today? What changed, what helped, what made it worse…"></textarea>
        <div id="dict"></div>
        <div id="pain"></div>
        <div id="files"></div>
        <div id="when"></div>
        <p class="err" id="err" role="alert"></p>
        <button class="btn primary" id="save">Save note</button>
      </section>
      <div class="quick">
        <a class="btn" href="#/exercise?p=${id}">Log exercise</a>
        <a class="btn" href="#/report?p=${id}">Progress report</a>
      </div>
      <h2 class="sec">Timeline</h2>
      <div id="tl"><p class="muted">Loading…</p></div>`,
  });
  const body = $('#body');
  stopDictation.push(dictation($('#dict'), body));
  const pain = painPicker($('#pain'));
  const picked = filePicker($('#files'));
  const when = whenPicker($('#when'));

  $('#save').onclick = async () => {
    const text = body.value.trim(); const fl = picked(); const pv = pain();
    if (!text && !fl.length && pv == null) { $('#err').textContent = 'Write or dictate a note, set the pain, or add a file first.'; return; }
    const btn = $('#save');
    busy(btn, true, fl.length ? 'Uploading…' : 'Saving…');
    try {
      const at = when();
      // Saved within 15 minutes of your last note here? Then it belongs to that note: one entry, not two.
      let e = null;
      if (!when.custom()) {
        const [last] = await entries.list({ problemId: id, kind: 'note', limit: 1 });
        if (last && Date.now() - new Date(last.at) < 15 * 60e3) {
          e = await entries.update(last.id, { body: [last.body, text].filter(Boolean).join('\n'), pain: pv ?? last.pain });
          toast(`Added to your ${fmtTime(last.at)} note`);
        }
      }
      if (!e) { e = await entries.create({ problem_id: general ? null : id, kind: 'note', body: text, pain: pv, at }); toast('Saved'); }
      for (const f of fl) await files.upload({ uid: session.user.id, problemId: general ? null : id, entryId: e.id, file: f, at });
      renderProblem(id);
    } catch (err) { busy(btn, false); $('#err').textContent = errMsg(err); }
  };
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('add')) body.focus();
  await paintTimeline(id);
}

const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

function entryHtml(e, urls) {
  return `<li class="ent ${e.kind}" data-id="${e.id}">
    <div class="ent-h"><span class="time">${fmtTime(e.at)}</span>
      ${e.kind === 'exercise' ? '<span class="chip ex">Exercise</span>' : ''}
      ${e.pain != null ? `<span class="chip pain-c" style="--p:${e.pain}">Pain ${e.pain}/10</span>` : ''}
      <span class="ent-a"><button class="link small" data-act="edit">Edit</button><button class="link small" data-act="del">Delete</button></span></div>
    ${exerciseLine(e.exercise)}
    ${e.body ? `<p class="pre">${esc(e.body)}</p>` : ''}
    ${(e.files || []).length ? `<div class="thumbs">${e.files.map((f) => {
      const u = urls[f.path];
      return /^image\//.test(f.mime) && u
        ? `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${esc(f.name)}" loading="lazy"></a>`
        : `<a class="filechip" href="${esc(u || '#')}" target="_blank" rel="noopener">${esc(f.name || 'File')}</a>`;
    }).join('')}</div>` : ''}
  </li>`;
}

// One fold per day: today open, earlier days closed with a one-line summary you can tap open.
function daySummary(items) {
  const ex = items.filter((e) => e.kind === 'exercise');
  const pains = items.filter((e) => e.pain != null).map((e) => e.pain);
  const bits = [plural(items.length, 'entry').replace('entrys', 'entries')];
  if (pains.length) bits.push(`pain ${Math.min(...pains)}${Math.max(...pains) !== Math.min(...pains) ? `–${Math.max(...pains)}` : ''}`);
  if (ex.length) bits.push(ex.map((e) => e.exercise?.name || 'exercise').slice(0, 2).join(', '));
  return bits.join(' · ');
}

async function paintTimeline(id) {
  const tl = $('#tl');
  let list;
  try { list = await entries.list({ problemId: id }); } catch (e) { tl.innerHTML = `<p class="err">${esc(errMsg(e))}</p>`; return; }
  if (!$('#tl')) return;
  $('#spark').innerHTML = sparkline(list);
  if (!list.length) { tl.innerHTML = '<p class="muted">Nothing yet. Your first note will appear here with its date and time.</p>'; return; }
  const urls = await files.urls(list.flatMap((e) => e.files || []).map((f) => f.path)).catch(() => ({}));
  const today = dayKey(new Date());

  tl.innerHTML = `
    <div class="tl-tools">
      <input type="search" id="tl-q" placeholder="Search your notes" aria-label="Search your notes">
      <label class="btn small datebtn">${'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v2h6V2h2v2h3v18H4V4h3zm11 8H6v10h12z"/></svg>'}<span>Day</span><input type="date" id="tl-d" aria-label="Go to a day"></label>
    </div>
    <p class="muted small" id="tl-note" hidden></p>
    <div id="tl-days"></div>`;
  const q = $('#tl-q'); const dpick = $('#tl-d'); const note = $('#tl-note');

  const paint = () => {
    const text = q.value.trim().toLowerCase();
    const day = dpick.value;
    let shown = list;
    if (text) shown = shown.filter((e) => `${e.body} ${e.exercise?.name || ''}`.toLowerCase().includes(text));
    if (day) shown = shown.filter((e) => dayKey(e.at) === day);
    const groups = [];
    for (const e of shown) {
      const k = dayKey(e.at);
      if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, items: [] });
      groups[groups.length - 1].items.push(e);
    }
    note.hidden = !(text || day);
    note.innerHTML = text || day ? `${plural(shown.length, 'match').replace('matchs', 'matches')}${day ? ` on ${esc(fmtDate(`${day}T12:00`))}` : ''} · <button class="link small" id="tl-clear">Show everything</button>` : '';
    $('#tl-clear')?.addEventListener('click', () => { q.value = ''; dpick.value = ''; paint(); });
    $('#tl-days').innerHTML = groups.length ? groups.map((g) => `
      <details class="day-fold" ${g.k === today || text || day ? 'open' : ''}>
        <summary><span class="day-l">${esc(dayLabel(g.items[0].at))}</span><span class="day-s">${esc(daySummary(g.items))}</span></summary>
        <ol class="tl">${g.items.map((e) => entryHtml(e, urls)).join('')}</ol>
      </details>`).join('') : '<p class="muted">Nothing matches.</p>';
  };
  q.oninput = paint;
  dpick.onchange = paint;
  paint();

  $('#tl-days').onclick = async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const li = b.closest('.ent'); const e = list.find((x) => x.id === li.dataset.id);
    if (b.dataset.act === 'del') {
      if (!confirm('Delete this entry and its files?')) return;
      try { await entries.remove(e.id); list.splice(list.indexOf(e), 1); paint(); toast('Deleted'); } catch (err) { toast(errMsg(err)); }
      return;
    }
    if (e.kind === 'exercise') return go(`#/exercise?e=${e.id}`);
    editInline(li, e, id);
  };
}

function editInline(li, e, id) {
  li.innerHTML = `<div class="stack">
    <textarea rows="4">${esc(e.body)}</textarea><div class="d"></div><div class="pp"></div>
    <label class="small">Date and time<input type="datetime-local" value="${localInput(e.at)}"></label>
    <div class="row"><button class="btn primary small" data-s>Save</button><button class="btn small" data-c>Cancel</button></div></div>`;
  const ta = li.querySelector('textarea');
  stopDictation.push(dictation(li.querySelector('.d'), ta));
  const pv = painPicker(li.querySelector('.pp'), e.pain);
  li.querySelector('[data-c]').onclick = () => paintTimeline(id);
  li.querySelector('[data-s]').onclick = async (ev) => {
    busy(ev.target, true);
    try {
      await entries.update(e.id, { body: ta.value.trim(), pain: pv(), at: new Date(li.querySelector('input').value).toISOString() });
      paintTimeline(id);
    } catch (err) { busy(ev.target, false); toast(errMsg(err)); }
  };
}

/* ---------- log exercise ---------- */
async function renderExercise(params) {
  const editing = params.get('e');
  const [list, names, existing] = await Promise.all([
    problems.list().catch(() => []),
    entries.exerciseNames().catch(() => []),
    editing ? sb.from('entries').select('*').eq('id', editing).single().then((r) => r.data) : null,
  ]);
  const x = existing?.exercise || {};
  const pid = existing ? (existing.problem_id || 'none') : (params.get('p') || 'none');
  const back = pid !== 'none' || existing ? `#/p/${pid}` : '#/';
  shell({
    title: editing ? 'Edit exercise' : 'Log exercise', back, tab: editing ? null : 'run',
    body: `<section class="card"><form id="f" class="stack">
      <label>For which problem?<select name="problem"><option value="none">General (not one problem)</option>
        ${list.filter((p) => p.status !== 'resolved' || p.id === pid).map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
      <label>Exercise<input name="name" list="names" required placeholder="e.g. Band external rotation, walk, swim" value="${esc(x.name || '')}">
        <datalist id="names">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></label>
      <div class="four">
        <label>Sets<input name="sets" type="number" inputmode="numeric" min="0" value="${esc(x.sets ?? '')}"></label>
        <label>Reps<input name="reps" type="number" inputmode="numeric" min="0" value="${esc(x.reps ?? '')}"></label>
        <label>Weight kg<input name="weight" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(x.weight ?? '')}"></label>
        <label>Minutes<input name="minutes" type="number" inputmode="decimal" min="0" value="${esc(x.minutes ?? '')}"></label>
      </div>
      <label>Distance km <span class="muted small">optional</span><input name="km" type="number" inputmode="decimal" min="0" step="0.1" value="${esc(x.km ?? '')}"></label>
      <div id="pain"></div>
      <label>How did it go? <span class="muted small">optional</span><textarea name="body" rows="3" placeholder="Easier than last week, clicked at the top, sore afterwards…">${esc(existing?.body || '')}</textarea></label>
      <div id="dict"></div>
      ${editing ? `<label>Date and time<input type="datetime-local" name="at" value="${localInput(existing.at)}"></label>` : '<div id="when"></div>'}
      <p class="err" id="err" role="alert"></p>
      <button class="btn primary">${editing ? 'Save' : 'Save exercise'}</button>
    </form></section>`,
  });
  const f = $('#f');
  const pain = painPicker($('#pain'), existing?.pain ?? null, 'Pain during or after (0–10)');
  stopDictation.push(dictation($('#dict'), f.body));
  const when = editing ? null : whenPicker($('#when'));
  f.onsubmit = async (e) => {
    e.preventDefault();
    const num = (v) => (v === '' ? null : Number(v));
    const ex = { name: f.name.value.trim(), sets: num(f.sets.value), reps: num(f.reps.value), weight: num(f.weight.value), minutes: num(f.minutes.value), km: num(f.km.value) };
    const row = { problem_id: f.problem.value === 'none' ? null : f.problem.value, kind: 'exercise', exercise: ex, body: f.body.value.trim(), pain: pain(), at: editing ? new Date(f.at.value).toISOString() : when() };
    const btn = f.querySelector('.primary');
    busy(btn, true);
    try {
      if (editing) await entries.update(editing, row); else await entries.create(row);
      toast('Exercise saved');
      go(`#/p/${row.problem_id || 'none'}`);
    } catch (err) { busy(btn, false); $('#err').textContent = errMsg(err); }
  };
}

/* ---------- progress report ---------- */
const RANGES = [
  { k: '7d', label: 'Last 7 days', days: 7 },
  { k: '1m', label: 'Last month', months: 1 },
  { k: '3m', label: 'Last 3 months', months: 3 },
  { k: '6m', label: 'Last 6 months', months: 6 },
  { k: '1y', label: 'Last year', months: 12 },
  { k: 'all', label: 'Everything' },
  { k: 'custom', label: 'Choose dates' },
];

async function renderReportForm(params) {
  const pid = params.get('p') || '';
  const [list, past] = await Promise.all([problems.list().catch(() => []), reports.list(pid && pid !== 'none' ? pid : null).catch(() => [])]);
  shell({
    title: 'Progress report', back: pid ? `#/p/${pid}` : '#/', tab: 'report',
    body: `<section class="card"><form id="f" class="stack">
      <label>About<select name="problem">
        <option value="">All my problems</option>
        ${list.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}
        <option value="none" ${pid === 'none' ? 'selected' : ''}>General notes and exercise</option></select></label>
      <div class="lbl">Period</div>
      <div class="chips" id="ranges">${RANGES.map((r, i) => `<button type="button" data-k="${r.k}" aria-pressed="${i === 2}">${r.label}</button>`).join('')}</div>
      <div class="two" id="custom" hidden>
        <label>From<input type="date" name="from"></label><label>To<input type="date" name="to"></label>
      </div>
      <label class="check"><input type="checkbox" name="withFiles" checked> Let it look at the X-rays, scans and photos too (slower)</label>
      <p class="muted small">Claude, Anthropic's AI, reads your notes, pain scores, exercise and files for this period, then points out what is improving, what is getting worse and what else may be playing a part. It is not a diagnosis; take it to your doctor.</p>
      <p class="err" id="err" role="alert"></p>
      <button class="btn primary">Draw the report</button>
    </form></section>
    ${past.length ? `<h2 class="sec">Earlier reports</h2><ul class="plist">${past.map((r) => `<li><a class="card prob" href="#/r/${r.id}">
      <div class="row"><b>${esc(r.range_label)}</b>${r.overall ? `<span class="chip o-${esc(r.overall)}">${esc(OVERALL[r.overall] || '')}</span>` : ''}</div>
      <span class="small">${esc(r.headline || '')}</span><span class="muted small">Drawn ${esc(fmtWhen(r.created_at))}</span></a></li>`).join('')}</ul>` : ''}`,
  });
  const f = $('#f');
  let k = '3m';
  $$('#ranges button').forEach((b) => {
    b.onclick = () => {
      k = b.dataset.k;
      $$('#ranges button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#custom').hidden = k !== 'custom';
    };
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const r = RANGES.find((x) => x.k === k);
    let from = null; let to = new Date();
    let label = r.label;
    if (r.days) { from = new Date(); from.setDate(from.getDate() - r.days); }
    if (r.months) { from = new Date(); from.setMonth(from.getMonth() - r.months); }
    if (k === 'custom') {
      if (!f.from.value) { $('#err').textContent = 'Choose a start date.'; return; }
      from = new Date(`${f.from.value}T00:00`);
      to = f.to.value ? new Date(`${f.to.value}T23:59:59`) : new Date();
      label = `${fmtDate(from)} to ${fmtDate(to)}`;
    }
    const scope = f.problem.value;
    const scopeName = scope === '' ? 'All problems' : scope === 'none' ? 'General' : list.find((p) => p.id === scope)?.title;
    const btn = f.querySelector('.primary');
    busy(btn, true, 'Reading your notes… (up to a minute or two)');
    $('#err').textContent = '';
    try {
      const out = await reports.draw({ problem: scope || null, from: from?.toISOString() || null, to: to.toISOString(), label: `${scopeName} · ${label}`, withFiles: f.withFiles.checked });
      go(`#/r/${out.id}`);
    } catch (err) { busy(btn, false); $('#err').textContent = errMsg(err); }
  };
}

function reportChart(series) {
  if (!series || series.length < 2) return '';
  const W = 320; const H = 110;
  const t0 = +new Date(series[0].d); const t1 = +new Date(series[series.length - 1].d);
  const x = (d) => 28 + ((+new Date(d) - t0) / Math.max(1, t1 - t0)) * (W - 36);
  const y = (v) => 8 + (1 - v / 10) * (H - 28);
  const path = series.map((s, i) => `${i ? 'L' : 'M'}${x(s.d).toFixed(1)},${y(s.avg).toFixed(1)}`).join(' ');
  return `<figure class="chart"><figcaption class="small muted">Average pain per week (0–10)</figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly average pain">
      ${[0, 5, 10].map((v) => `<line x1="26" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="0" y="${y(v) + 4}">${v}</text>`).join('')}
      <path d="${path}"/>${series.map((s) => `<circle cx="${x(s.d).toFixed(1)}" cy="${y(s.avg).toFixed(1)}" r="3"><title>Week of ${fmtDate(s.d)}: ${s.avg} (${s.n} readings)</title></circle>`).join('')}
      <text x="28" y="${H - 2}">${fmtDate(series[0].d)}</text><text x="${W}" y="${H - 2}" text-anchor="end">${fmtDate(series[series.length - 1].d)}</text>
    </svg></figure>`;
}

async function renderReport(id) {
  let r;
  try { r = await reports.get(id); } catch { return go('#/report'); }
  const c = r.content || {};
  const list = (title, arr, cls = '') => (arr?.length ? `<section class="card rsec ${cls}"><h2>${esc(title)}</h2><ul>${arr.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>` : '');
  shell({
    title: 'Progress report', back: r.problem_id ? `#/report?p=${r.problem_id}` : '#/report',
    actions: '<button class="icon-btn" id="print" aria-label="Print or save as PDF"><svg viewBox="0 0 24 24"><path d="M6 2h12v5H6zM4 8h16a2 2 0 0 1 2 2v7h-4v5H6v-5H2v-7a2 2 0 0 1 2-2Zm4 9v3h8v-5H8z"/></svg></button>',
    body: `
      <section class="card report-head">
        <div class="muted small">${esc(r.range_label)} · drawn ${esc(fmtWhen(r.created_at))}</div>
        <div class="row"><h2 class="hl">${esc(c.headline || '')}</h2></div>
        ${c.overall ? `<span class="chip o-${esc(c.overall)}">${esc(OVERALL[c.overall] || c.overall)}</span>` : ''}
        ${c.stats ? `<p class="small muted">${plural(c.stats.notes, 'note')} · ${plural(c.stats.exercise, 'exercise session')} · ${plural(c.stats.files, 'file')}${c.stats.files_read ? ` (${c.stats.files_read} looked at)` : ''}${c.stats.pain_first != null ? ` · pain ${c.stats.pain_first} → ${c.stats.pain_last}` : ''}</p>` : ''}
      </section>
      ${list('See a doctor soon about', c.see_doctor_now, 'alert')}
      ${c.summary ? `<section class="card rsec"><h2>Summary</h2><p class="pre">${esc(c.summary)}</p></section>` : ''}
      ${reportChart(c.stats?.pain_weekly)}
      ${(c.problems || []).length > 1 ? `<section class="card rsec"><h2>Each problem</h2><ul>${c.problems.map((p) => `<li><b>${esc(p.title)}</b> · ${esc(OVERALL[p.overall] || p.overall)}: ${esc(p.note)}</li>`).join('')}</ul></section>` : ''}
      ${list('Getting better', c.improvements, 'good')}
      ${list('Getting worse', c.worsening, 'bad')}
      ${list('Patterns', c.patterns)}
      ${c.exercise ? `<section class="card rsec"><h2>Exercise</h2><p class="pre">${esc(c.exercise)}</p></section>` : ''}
      ${list('Other things that may play a part', c.factors)}
      ${list('Assumptions (guesses, check them)', c.assumptions, 'guess')}
      ${list('Ideas to try or track', c.suggestions)}
      ${list('Questions for your doctor', c.doctor_questions)}
      ${(c.timeline || []).length ? `<section class="card rsec"><h2>Key moments</h2><ol class="kt">${c.timeline.map((t) => `<li><span class="muted small">${esc(t.date)}</span> ${esc(t.text)}</li>`).join('')}</ol></section>` : ''}
      ${list('Files it looked at', c.files_seen)}
      ${list('Missing information', c.gaps)}
      <p class="muted small">Written by Claude, Anthropic's AI, from your own notes. It can be wrong and it is not a diagnosis.</p>
      <button class="btn danger wide" id="del">Delete this report</button>`,
  });
  $('#print').onclick = () => window.print();
  $('#del').onclick = async () => {
    if (!confirm('Delete this report? Your notes stay.')) return;
    await reports.remove(id).catch(() => {});
    go(r.problem_id ? `#/report?p=${r.problem_id}` : '#/report');
  };
}

/* ---------- account ---------- */
function renderAccount() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  shell({
    title: 'Me', tab: 'me',
    body: `
      <a class="card look-link" href="#/look"><div class="row"><b>Look and icon</b><span class="chip">${esc(SKINS.find((k) => k.id === currentSkin())?.name || '')}</span></div><span class="muted small">Six styles, each with its own home-screen icon</span></a>
      <section class="card stack"><h2>Signed in</h2><p>${esc(session.user.email)}</p>
        <a class="btn" href="#/password">Change password</a>
        <button class="btn" id="out">Sign out</button></section>
      ${standalone ? '' : `<section class="card stack"><h2>Put it on your phone</h2>
        ${ios ? '<p>In Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>. Dr Pocket opens full screen with its own icon.</p>'
        : '<p>In Chrome, tap the <b>⋮</b> menu, then <b>Install app</b> (or <b>Add to Home screen</b>). Dr Pocket opens full screen with its own icon.</p>'}
        <button class="btn" id="install" hidden>Install now</button></section>`}
      <section class="card stack"><h2>Delete my account</h2>
        <p class="muted small">Removes your account and every problem, note, file and report in it, for good.</p>
        <button class="btn danger" id="del">Delete my account</button></section>`,
  });
  $('#out').onclick = async () => { await auth.signOut(); go('#/login'); };
  if (deferredInstall) { const b = $('#install'); if (b) { b.hidden = false; b.onclick = () => deferredInstall.prompt(); } }
  $('#del').onclick = async () => {
    const typed = prompt('This deletes everything. Type DELETE to confirm.');
    if (typed !== 'DELETE') return;
    try { await auth.deleteAccount(session.user.id); toast('Account deleted'); go('#/login'); } catch (e) { toast(errMsg(e)); }
  };
}

/* ---------- look: six styles, each with its own icon ---------- */
function renderLook() {
  const cur = currentSkin();
  shell({
    title: 'Look and icon', back: '#/account', tab: 'me',
    body: `<p class="muted small">Tap one to try it. It changes straight away, on this phone and on your other devices after you sign in.</p>
      <ul class="looks">${SKINS.map((k) => `<li><button class="look" data-id="${k.id}" aria-pressed="${k.id === cur}">
        <img src="/icons/${k.id}-180.png" alt="" width="56" height="56">
        <span class="look-t"><b>${esc(k.name)}</b><span>${esc(k.line)}</span></span>
      </button></li>`).join('')}</ul>
      <section class="card stack"><h2>Change the icon on your home screen</h2>
        <p class="small">Your phone keeps the icon it had when you added Dr Pocket. To get the new one: press and hold the Dr Pocket icon, tap <b>Remove App</b> (or <b>Delete Bookmark</b>), then open this page in Safari and tap <b>Share → Add to Home Screen</b> again. Your notes stay in your account.</p></section>`,
  });
  $$('.look').forEach((b) => {
    b.onclick = () => {
      applySkin(b.dataset.id);
      $$('.look').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      sb.auth.updateUser({ data: { skin: b.dataset.id } }).catch(() => {});
    };
  });
}

/* ---------- routing ---------- */
async function route() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  if (!session) return parts[0] === 'signup' ? renderLogin('up') : renderLogin('in');
  try {
    switch (parts[0]) {
      case undefined: case 'login': case 'signup': return await renderHome();
      case 'problem': return await renderProblemForm(parts[1] === 'new' ? null : parts[1]);
      case 'p': return await renderProblem(parts[1]);
      case 'exercise': return await renderExercise(params);
      case 'report': return await renderReportForm(params);
      case 'r': return await renderReport(parts[1]);
      case 'account': return renderAccount();
      case 'look': return renderLook();
      case 'add': return await renderAdd();
      case 'password': return renderPassword();
      default: return await renderHome();
    }
  } catch (e) {
    app.querySelector('.page')?.insertAdjacentHTML('afterbegin', `<p class="err">${esc(errMsg(e))}</p>`);
  }
}

let deferredInstall = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

applySkin(currentSkin());
sb.auth.onAuthStateChange((event, s) => {
  const was = !!session;
  session = s;
  // A look chosen on another device follows you after you sign in.
  const synced = s?.user?.user_metadata?.skin;
  if (synced && synced !== currentSkin() && SKINS.some((k) => k.id === synced)) applySkin(synced);
  if (event === 'PASSWORD_RECOVERY') return go('#/password');
  if (was !== !!s && event !== 'INITIAL_SESSION') route();
});
auth.session().then((s) => {
  session = s;
  addEventListener('hashchange', route);
  route();
});
