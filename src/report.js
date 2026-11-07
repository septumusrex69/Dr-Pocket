// "Explain my scan report": sends the report to /api/explain, shows the plain-language answer,
// and lights up each finding on the 3D body.

const $ = (id) => document.getElementById(id);
const MAX_PDF_BYTES = 2_500_000;
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
let file = null; // { data, media_type, name }

/* Shrink photos so they upload quickly and stay under the size limit. */
async function readImage(f) {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('unreadable'));
      i.src = url;
    });
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL('image/jpeg', 0.85).split(',')[1], media_type: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
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

/* Part ids for a finding: each named structure, on the report's side. */
function idsFor(f) {
  const ids = [];
  (f.structures || []).forEach((name) => {
    const v = vocab?.[name];
    if (!v) return;
    if (v.any.length) ids.push(...v.any);
    if (f.side === 'left' || f.side === 'both' || (f.side === 'none' && !v.any.length)) ids.push(...v.left);
    if (f.side === 'right' || f.side === 'both' || (f.side === 'none' && !v.any.length)) ids.push(...v.right);
  });
  return [...new Set(ids)];
}

export function initReport(body) {
  fetch('/models/vocab.json').then((r) => r.json()).then((v) => { vocab = v; }).catch(() => {});

  $('rep-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    showError('');
    file = null;
    $('rep-file-name').textContent = '';
    if (!f) return;
    try {
      if (f.type === 'application/pdf') {
        if (f.size > MAX_PDF_BYTES) { showError('That PDF is too big. Upload a photo of the report page instead.'); return; }
        file = await readPdf(f);
      } else {
        file = await readImage(f);
      }
      $('rep-file-name').textContent = f.name;
    } catch {
      showError('That file could not be opened. Try a JPG or PNG photo, or paste the text.');
    }
  });

  $('rep-go').addEventListener('click', async () => {
    const text = $('rep-text').value.trim();
    showError('');
    if (!text && !file) { showError('Paste your report or upload a photo or PDF of it first.'); return; }
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
        body: JSON.stringify({ text, file: file && { data: file.data, media_type: file.media_type } }),
      });
      const data = await res.json().catch(() => ({ error: 'Something went wrong. Please try again.' }));
      if (!res.ok || data.error) { showError(data.error || 'Something went wrong. Please try again.'); return; }
      if (!data.is_report) { showError('That does not look like a scan report. Paste the written report from your radiologist.'); return; }
      render(data, body);
    } catch {
      showError('Could not reach Dr Pocket. Check your connection and try again.');
    } finally {
      go.disabled = false;
      busy.remove();
    }
  });
}

function render(d, body) {
  const out = $('rep-out');
  const findings = d.findings || [];
  const walk = WALK[d.walkthrough];
  out.innerHTML = `
    ${d.exam ? `<p class="rep-exam">${esc(d.exam)}</p>` : ''}
    ${d.urgent ? '<p class="rep-urgent">Your report flags something that needs attention soon. Please contact your doctor.</p>' : ''}
    <p class="rep-sum">${esc(d.summary)}</p>
    ${findings.length ? `<p class="rep-h">What the report found</p>
    <p class="note">Tap a finding to see it on the body.</p>
    <ul class="rep-findings">${findings.map((f, i) => `
      <li><button class="finding" data-i="${i}" aria-pressed="false">
        <b>${esc(f.title)}<em class="tag ${esc(f.kind)}">${LABEL[f.kind] || ''}</em></b>
        <span>${esc(f.plain)}</span>
        ${idsFor(f).length ? (f.approximate ? '<small>The exact part is too small for the 3D model, so the area around it is shown.</small>' : '') : '<small>Not shown on the model.</small>'}
      </button></li>`).join('')}</ul>` : ''}
    ${(d.glossary || []).length ? `<p class="rep-h">Words in your report</p>
    <dl class="rep-gloss">${d.glossary.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.meaning)}</dd>`).join('')}</dl>` : ''}
    ${(d.questions || []).length ? `<p class="rep-h">Questions to ask your doctor</p>
    <ol class="rep-q">${d.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>` : ''}
    <div class="rep-actions">
      ${walk ? `<a class="btn primary" href="/shoulder/?case=${walk[0]}">${esc(walk[1])}</a>` : ''}
      <button class="btn" id="rep-again">Explain another report</button>
    </div>
    <p class="note privacy">This is an explanation of your report written by AI, not a diagnosis. It can make mistakes. Your doctor knows your full situation, so check anything important with them.</p>`;
  out.hidden = false;
  $('rep-form').hidden = true;

  const buttons = [...out.querySelectorAll('.finding')];
  buttons.forEach((b) => b.addEventListener('click', () => {
    const f = findings[Number(b.dataset.i)];
    const ids = idsFor(f);
    buttons.forEach((x) => x.setAttribute('aria-pressed', x === b));
    if (ids.length) body.showParts(ids, f.title, f.approximate ? 'Area around it' : 'From your report');
    else if (d.region) body.goRegion(d.region);
  }));
  $('rep-again').addEventListener('click', () => {
    out.hidden = true;
    out.innerHTML = '';
    $('rep-form').hidden = false;
    $('rep-text').value = '';
    $('rep-file-name').textContent = '';
    file = null;
    body.clear();
  });

  // Start on the scanned region, and show the first finding that has parts.
  if (d.region) body.goRegion(d.region);
  const first = buttons.find((b) => idsFor(findings[Number(b.dataset.i)]).length);
  if (first) setTimeout(() => first.click(), 400);
  out.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
