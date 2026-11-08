// "Explain my scan report": sends the report to /api/explain, shows the plain-language answer,
// and lights up each finding on the 3D body.

import { createFilm, VISUAL_COLOR } from './film.js';
import { archive, initArchive, showPages } from './archive.js';
let arc = null;

const $ = (id) => document.getElementById(id);
let film = null;
const MAX_PDF_BYTES = 2_500_000;
const MAX_PAGES = 8;
const MAX_TOTAL = 3_900_000; // base64 characters, under the server's 4.5 MB request limit
const LABEL = { normal: 'Normal', minor: 'Minor', notable: 'Worth noting', important: 'Important' };
const WALK = {
  'shoulder-healthy': ['healthy', 'How a healthy shoulder works'],
  'shoulder-bankart': ['bankart', 'Labrum tear (Bankart) walkthrough'],
  'shoulder-slap': ['slap', 'SLAP tear walkthrough'],
  'shoulder-cuff': ['cuff', 'Rotator cuff tear walkthrough'],
  'shoulder-oa': ['oa', 'Shoulder cartilage wear walkthrough'],
  'shoulder-tight': ['tight', 'Over-tight repair walkthrough'],
};

let vocab = null;
let pages = []; // [{ data, media_type, name, thumb }] - photos and PDFs of one report, in order

/* Open a photo, turned the right way up (phone photos store their rotation separately). */
async function decode(f) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(f);
  try {
    return await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('unreadable'));
      i.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
/* Shrink a photo so several pages upload quickly and stay under the size limit,
   while keeping small print readable. */
async function readImage(f) {
  const img = await decode(f);
  const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
  if (!w || !h) throw new Error('unreadable');
  const encode = (maxSide, q, gray) => {
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const g = c.getContext('2d', { willReadFrequently: gray });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    if (gray) {
      // black and white with a little extra contrast: print reads more clearly and the file is smaller
      const px = g.getImageData(0, 0, c.width, c.height);
      const d = px.data;
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = Math.max(0, Math.min(255, (y - 128) * 1.18 + 136));
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      g.putImageData(px, 0, 0);
    }
    return c.toDataURL('image/jpeg', q).split(',')[1];
  };
  let data = encode(2400, 0.85, true);
  if (data.length > 1_300_000) data = encode(2000, 0.8, true);
  if (data.length > 1_300_000) data = encode(1600, 0.75, true);
  const thumb = `data:image/jpeg;base64,${encode(160, 0.6, false)}`;
  img.close?.();
  return { data, media_type: 'image/jpeg', thumb };
}
function readPdf(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ data: String(r.result).split(',')[1], media_type: 'application/pdf' });
    r.onerror = () => reject(new Error('unreadable'));
    r.readAsDataURL(f);
  });
}

function showError(msg) {
  const e = $('rep-err');
  e.textContent = msg;
  e.hidden = !msg;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Part ids for structure names, on the report's side. */
function idsForNames(names, side) {
  const ids = [];
  (names || []).forEach((name) => {
    const v = vocab?.[name];
    if (!v) return;
    if (v.any.length) ids.push(...v.any);
    if (side === 'left' || side === 'both' || (side === 'none' && !v.any.length)) ids.push(...v.left);
    if (side === 'right' || side === 'both' || (side === 'none' && !v.any.length)) ids.push(...v.right);
  });
  return [...new Set(ids)];
}
const idsFor = (f) => idsForNames([...(f.structures || []), f.focus].filter(Boolean), f.side);

/* What the model can show for a finding. */
function modelNote(f) {
  const drawn = (f.draw && f.draw.shape !== 'none') || (f.focus && idsForNames([f.focus], f.side).some((id) => id.startsWith('DP')));
  if (drawn) return '<small>Drawn by Dr Pocket to show where it is. The shape is approximate.</small>';
  if (!idsFor(f).length) return '<small>Not shown on the model.</small>';
  return f.approximate ? '<small>The exact part is too small for the 3D model, so the area around it is shown.</small>' : '';
}

/* The walkthrough: intro, one scene per finding, closing scene with the questions. */
function buildScenes(d) {
  const scenes = [{ kind: 'intro', title: d.exam || 'Your report', text: d.intro_narration || d.summary, region: d.region }];
  (d.findings || []).forEach((f) => {
    scenes.push({
      kind: 'finding', title: f.title, text: f.narration || f.plain, visual: f.visual || f.kind === 'normal' && 'normal' || 'other',
      label: f.marker_label || '', sub: f.approximate ? 'Area around it' : 'From your report',
      ids: idsFor(f), focusIds: f.focus ? idsForNames([f.focus], f.side) : [], nearIds: f.near ? idsForNames([f.near], f.side) : [],
      draw: f.draw && f.draw.shape !== 'none' ? {
        shape: f.draw.shape, name: f.draw.name || f.title, color: '#1FA88A',
        fromIds: idsForNames([f.draw.from], f.side), toIds: f.draw.to ? idsForNames([f.draw.to], f.side) : [],
      } : null,
      region: d.region,
    });
  });
  scenes.push({
    kind: 'outro', title: 'Questions for your doctor',
    text: d.outro_narration || 'That is everything in your report. Take these questions with you to your doctor.',
    list: d.questions || [], region: d.region,
  });
  return scenes;
}

/* Thumbnails of the pages added so far, each with a remove button. */
function renderPages() {
  const ul = $('rep-pages');
  ul.innerHTML = '';
  pages.forEach((p, k) => {
    const li = document.createElement('li');
    li.innerHTML = `${p.thumb ? `<img src="${p.thumb}" alt="">` : '<span class="pdf">PDF</span>'}<em>Page ${k + 1}</em><button aria-label="Remove page ${k + 1}">×</button>`;
    li.querySelector('button').onclick = () => { pages.splice(k, 1); renderPages(); };
    ul.appendChild(li);
  });
  ul.hidden = !pages.length;
  $('rep-pages-note').hidden = !pages.length || pages.length >= MAX_PAGES;
}

export function initReport(body) {
  // while the walkthrough plays, the finding being shown is highlighted in the side panel
  film = createFilm(body, {
    onScene: (i, sc) => {
      document.querySelectorAll('.finding').forEach((b) => {
        const on = sc.kind === 'finding' && Number(b.dataset.i) === i - 1;
        b.setAttribute('aria-pressed', on);
        if (on) b.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },
  });
  // My reports: open a saved one without calling the server again, or explain it again
  arc = initArchive({
    open: (r) => {
      $('report').scrollIntoView({ block: 'start', behavior: 'smooth' });
      render(r.data, body, { id: r.id, history: r.qa || [], pages: r.pages || [], saved: r.created });
    },
    reexplain: (r) => {
      if (film.isOpen) film.close();
      $('rep-out').hidden = true;
      $('rep-form').hidden = false;
      $('rep-text').value = r.text || '';
      pages = (r.pages || []).map((p) => ({ ...p }));
      renderPages();
      $('report').scrollIntoView({ block: 'start', behavior: 'smooth' });
      $('rep-go').click();
    },
  });
  fetch('/models/vocab.json').then((r) => r.json()).then((v) => { vocab = v; }).catch(() => {});

  async function addFiles(list) {
    showError('');
    const files = [...list];
    for (const f of files) {
      if (pages.length >= MAX_PAGES) { showError(`You can add up to ${MAX_PAGES} pages.`); break; }
      try {
        const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
        if (isPdf && f.size > MAX_PDF_BYTES) { showError(`${f.name} is too big. Take photos of its pages instead.`); continue; }
        const page = isPdf ? await readPdf(f) : await readImage(f);
        page.name = f.name || 'Photo';
        if (pages.reduce((n, p) => n + p.data.length, 0) + page.data.length > MAX_TOTAL) {
          showError('That is too much to send at once. Remove a page or use fewer photos.');
          break;
        }
        pages.push(page);
      } catch {
        showError(/heic|heif/i.test(f.type + f.name)
          ? 'That photo is in a format this browser cannot open (HEIC). On iPhone, go to Settings, Camera, Formats and choose Most Compatible, or take the photo with the Take a photo button.'
          : `${f.name || 'That photo'} could not be opened. Try another photo, or paste the text.`);
      }
    }
    renderPages();
  }
  ['rep-file', 'rep-cam'].forEach((id) => $(id).addEventListener('change', (e) => {
    const list = e.target.files;
    addFiles(list).finally(() => { e.target.value = ''; });
  }));

  $('rep-go').addEventListener('click', async () => {
    const text = $('rep-text').value.trim();
    showError('');
    if (!text && !pages.length) { showError('Paste your report, or take or upload a photo of it first.'); return; }
    const go = $('rep-go');
    go.disabled = true;
    const busy = document.createElement('div');
    busy.className = 'rep-busy';
    busy.innerHTML = '<i></i><span>Reading your report… this can take up to a minute.</span>';
    go.after(busy);
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, files: pages.map((p) => ({ data: p.data, media_type: p.media_type })) }),
      });
      const data = await res.json().catch(() => ({
        error: res.status === 413 ? 'Those photos are too big to send together. Remove a page and try again.' : 'Something went wrong. Please try again.',
      }));
      if (!res.ok || data.error) { showError(data.error || 'Something went wrong. Please try again.'); return; }
      if (!data.is_report) { showError('That does not look like a scan report. Paste the written report from your radiologist.'); return; }
      let id = null;
      const sent = pages.map((p) => ({ ...p }));
      if (archive.enabled) {
        try { id = await archive.save({ data, pages: sent, text }); arc.refresh(); } catch { /* storage not available */ }
      }
      render(data, body, { id, history: [], pages: sent, saved: id ? Date.now() : null });
    } catch {
      showError('Could not reach Dr Pocket. Check your connection and try again.');
    } finally {
      go.disabled = false;
      busy.remove();
    }
  });
}

function render(d, body, { id = null, history = [], pages: shownPages = [], saved = null } = {}) {
  const out = $('rep-out');
  const findings = d.findings || [];
  const walk = WALK[d.walkthrough];
  const scenes = buildScenes(d);
  out.innerHTML = `
    ${d.exam ? `<p class="rep-exam">${esc(d.exam)}</p>` : ''}
    ${saved ? `<p class="rep-saved">Saved in My reports on ${new Date(saved).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.</p>` : ''}
    ${shownPages.length ? `<button class="btn" id="rep-photos">See the photos of your report (${shownPages.length})</button>` : ''}
    <button class="btn primary play-film" id="rep-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Play the walkthrough</button>
    <p class="note">A spoken tour of your report on the 3D body. Turn your sound on. You can pause or skip between parts.</p>
    ${d.urgent ? '<p class="rep-urgent">Your report flags something that needs attention soon. Please contact your doctor.</p>' : ''}
    ${(d.unclear_parts || []).length ? `<div class="rep-unclear"><b>Some of your report could not be read clearly</b><ul>${d.unclear_parts.map((u) => `<li>${esc(u)}</li>`).join('')}</ul><span>Take a sharper photo of that part, or type it in under “What we read”, then explain again.</span></div>` : ''}
    <p class="rep-sum">${esc(d.summary)}</p>
    ${findings.length ? `<p class="rep-h">What the report found</p>
    <p class="note">Tap a finding to see it on the body.</p>
    <ul class="rep-findings">${findings.map((f, i) => `
      <li class="finding-card"><button class="finding" data-i="${i}" aria-pressed="false">
        <b>${esc(f.title)}<em class="tag ${esc(f.kind)}">${LABEL[f.kind] || ''}</em></b>
        ${f.marker_label ? `<small style="color:${VISUAL_COLOR[f.visual] || 'inherit'}">● ${esc(f.marker_label)}</small>` : ''}
        <span>${esc(f.plain)}</span>
        ${modelNote(f)}
      </button>
      ${f.report_quote ? `<blockquote class="quote"><small>Your report says</small>${esc(f.report_quote)}</blockquote>` : ''}
      ${f.background ? `<details class="bg"><summary>More background</summary><p>${esc(f.background)}</p></details>` : ''}
      </li>`).join('')}</ul>` : ''}
    ${(d.glossary || []).length ? `<p class="rep-h">Words in your report</p>
    <dl class="rep-gloss">${d.glossary.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.meaning)}</dd>`).join('')}</dl>` : ''}
    ${(d.questions || []).length ? `<p class="rep-h">Questions to ask your doctor</p>
    <ol class="rep-q">${d.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>` : ''}
    <section class="ask" aria-label="Ask about your report">
      <p class="rep-h">Ask about your report</p>
      <ul class="ask-list" id="ask-list"></ul>
      <textarea id="ask-q" rows="2" placeholder="For example: what does “partial-thickness” mean?" aria-label="Your question"></textarea>
      <button class="btn primary" id="ask-go">Ask</button>
      <p class="rep-err" id="ask-err" role="alert" hidden></p>
    </section>
    ${d.transcript ? `<details class="transcript"><summary>What we read from your report</summary>
      <p class="note">Check this against your report. If something was read wrong, fix it here and explain again.</p>
      <textarea id="rep-transcript" rows="10" aria-label="Report text as read">${esc(d.transcript)}</textarea>
      <button class="btn" id="rep-reexplain">Explain again with this text</button>
    </details>` : ''}
    <div class="rep-actions">
      ${walk ? `<a class="btn primary" href="/shoulder/?case=${walk[0]}">${esc(walk[1])}</a>` : ''}
      <button class="btn" id="rep-again">Explain another report</button>
    </div>
    <p class="note privacy">This is an explanation of your report written by AI, not a diagnosis. It can make mistakes. Your doctor knows your full situation, so check anything important with them.</p>`;
  out.hidden = false;
  $('rep-form').hidden = true;

  const buttons = [...out.querySelectorAll('.finding')];
  // tapping a finding opens the walkthrough on that scene, paused
  buttons.forEach((b) => b.addEventListener('click', () => {
    buttons.forEach((x) => x.setAttribute('aria-pressed', x === b));
    film.open({ scenes, region: d.region }, { start: Number(b.dataset.i) + 1, play: false });
  }));
  $('rep-play').addEventListener('click', () => film.open({ scenes, region: d.region }, { start: 0, play: true }));
  // follow-up questions, answered from the report text
  // earlier questions (from My reports) are shown again; new ones are added to the saved report
  const showQA = (q, ans, ids, fromReport) => {
    const li = document.createElement('li');
    li.innerHTML = '<p class="q"></p><p class="a"></p>';
    li.querySelector('.q').textContent = q;
    li.querySelector('.a').textContent = ans;
    if (fromReport === false) li.insertAdjacentHTML('beforeend', '<small class="gen">General information, not from your report.</small>');
    if (ids?.length) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = 'Show on the body';
      b.onclick = () => { if (film.isOpen) film.close(); body.showParts(ids, q.length > 60 ? `${q.slice(0, 57)}…` : q, 'From your question'); };
      li.appendChild(b);
    }
    $('ask-list').appendChild(li);
  };
  history.forEach((h) => showQA(h.q, h.a, idsForNames(h.structures, h.side), h.from_report));
  $('rep-photos')?.addEventListener('click', () => showPages(shownPages, d.exam));
  $('ask-go').addEventListener('click', async () => {
    const q = $('ask-q').value.trim();
    const err = $('ask-err');
    err.hidden = true;
    if (!q) return;
    const go = $('ask-go');
    go.disabled = true;
    const li = document.createElement('li');
    li.innerHTML = `<p class="q"></p><p class="a busy"><i></i>Thinking…</p>`;
    li.querySelector('.q').textContent = q;
    $('ask-list').appendChild(li);
    $('ask-q').value = '';
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: $('rep-transcript')?.value || d.transcript || d.summary, question: q, history }),
      });
      const a = await res.json().catch(() => ({ error: 'Something went wrong. Please try again.' }));
      if (!res.ok || a.error) throw new Error(a.error || 'Something went wrong. Please try again.');
      history.push({ q, a: a.answer, structures: a.structures, side: a.side, from_report: a.from_report });
      if (id) archive.update(id, { qa: history }).then(() => arc.refresh()).catch(() => {});
      const ap = li.querySelector('.a');
      ap.className = 'a';
      ap.textContent = a.answer;
      const ids = idsForNames(a.structures, a.side);
      if (!a.from_report) li.insertAdjacentHTML('beforeend', '<small class="gen">General information, not from your report.</small>');
      if (ids.length) {
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = 'Show on the body';
        b.onclick = () => { if (film.isOpen) film.close(); body.showParts(ids, q.length > 60 ? `${q.slice(0, 57)}…` : q, 'From your question'); };
        li.appendChild(b);
      }
    } catch (e) {
      li.remove();
      $('ask-q').value = q;
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      go.disabled = false;
    }
  });
  $('ask-q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('ask-go').click(); } });

  // fix what was read and explain again
  $('rep-reexplain')?.addEventListener('click', () => {
    const fixed = $('rep-transcript').value.trim();
    $('rep-again').click();
    $('rep-text').value = fixed;
    $('rep-go').click();
  });

  $('rep-again').addEventListener('click', () => {
    if (film.isOpen) film.close();
    out.hidden = true;
    out.innerHTML = '';
    $('rep-form').hidden = false;
    $('rep-text').value = '';
    pages = [];
    renderPages();
    body.clear();
  });

  // Open the walkthrough on its first scene, ready to play.
  film.open({ scenes, region: d.region }, { start: 0, play: false });
  out.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
