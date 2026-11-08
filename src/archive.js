// "My reports": an archive of explained reports, kept only on this device (IndexedDB).
// Each record holds the report pages (photos/PDFs as base64), any pasted text, the full
// explanation (which also drives the walkthrough) and the follow-up questions and answers.
// Nothing here is sent anywhere; backups are files the user downloads and restores themselves.

const $ = (id) => document.getElementById(id);
const DB = 'dr-pocket';
const STORE = 'reports';
const PREF = 'dr-pocket:save-reports';

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('no storage')); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('created', 'created');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}

export const archive = {
  get enabled() {
    try { return localStorage.getItem(PREF) !== 'off'; } catch { return true; }
  },
  set enabled(on) {
    try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* private mode */ }
  },
  async save({ data, pages, text }) {
    const rec = {
      id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      created: Date.now(),
      title: data.exam || 'Scan report',
      data,
      pages: (pages || []).map(({ data: b64, media_type: type, name, thumb }) => ({ data: b64, media_type: type, name, thumb })),
      text: text || '',
      qa: [],
    };
    await tx('readwrite', (s) => s.put(rec));
    // ask the browser to keep this storage even when space runs low
    navigator.storage?.persist?.().catch(() => {});
    return rec.id;
  },
  async update(id, changes) {
    const rec = await this.get(id);
    if (!rec) return;
    await tx('readwrite', (s) => s.put({ ...rec, ...changes }));
  },
  get(id) { return tx('readonly', (s) => s.get(id)); },
  async list() {
    const all = await tx('readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => b.created - a.created);
  },
  remove(id) { return tx('readwrite', (s) => s.delete(id)); },
  clear() { return tx('readwrite', (s) => s.clear()); },
};

/* ---------- photo viewer ---------- */
export function showPages(pages, title) {
  const m = $('pages-modal');
  $('pages-title').textContent = title || 'Your report';
  const box = $('pages-list');
  box.innerHTML = '';
  pages.forEach((p, k) => {
    const fig = document.createElement('figure');
    if (p.media_type === 'application/pdf') {
      const a = document.createElement('a');
      a.className = 'btn';
      a.textContent = `Open PDF (page ${k + 1})`;
      a.href = URL.createObjectURL(new Blob([Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0))], { type: 'application/pdf' }));
      a.target = '_blank';
      a.rel = 'noopener';
      fig.appendChild(a);
    } else {
      const img = document.createElement('img');
      img.alt = `Page ${k + 1} of your report`;
      img.src = `data:${p.media_type};base64,${p.data}`;
      fig.appendChild(img);
    }
    const cap = document.createElement('figcaption');
    cap.textContent = `Page ${k + 1}`;
    fig.appendChild(cap);
    box.appendChild(fig);
  });
  m.hidden = false;
  $('pages-close').focus();
}

/* ---------- the "My reports" list ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function initArchive({ open, reexplain }) {
  $('pages-close').onclick = () => { $('pages-modal').hidden = true; };
  $('pages-modal').addEventListener('click', (e) => { if (e.target.id === 'pages-modal') $('pages-modal').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('pages-modal').hidden = true; });

  const toggle = $('rep-save');
  toggle.checked = archive.enabled;
  toggle.onchange = () => { archive.enabled = toggle.checked; };

  $('arc-export').onclick = async () => {
    const all = await archive.list();
    if (!all.length) return;
    const blob = new Blob([JSON.stringify({ app: 'dr-pocket', version: 1, reports: all })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dr-pocket-reports-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('arc-import').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (json.app !== 'dr-pocket' || !Array.isArray(json.reports)) throw new Error('not a backup');
      for (const r of json.reports) {
        if (r && r.id && r.data) await tx('readwrite', (s) => s.put(r));
      }
      refresh();
    } catch {
      alert('That file is not a Dr Pocket backup.');
    }
  };
  $('arc-clear').onclick = async () => {
    if (!confirm('Delete every saved report on this device? This cannot be undone.')) return;
    await archive.clear();
    refresh();
  };

  async function refresh() {
    const ul = $('arc-list');
    let all = [];
    try { all = await archive.list(); } catch { ul.innerHTML = '<li class="note">Saving is not available in this browser (for example in a private window).</li>'; return; }
    $('arc-count').textContent = all.length ? `${all.length} saved` : '';
    $('arc-tools').hidden = !all.length;
    if (!all.length) { ul.innerHTML = '<li class="note">Reports you explain are saved here, on this device only.</li>'; return; }
    ul.innerHTML = '';
    all.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'arc-item';
      const thumb = r.pages?.find((p) => p.thumb)?.thumb;
      const n = (r.data.findings || []).filter((f) => f.kind !== 'normal').length;
      li.innerHTML = `
        <button class="arc-open">
          ${thumb ? `<img src="${thumb}" alt="">` : '<span class="arc-doc" aria-hidden="true">Aa</span>'}
          <span class="arc-txt"><b>${esc(r.title)}</b><small>${when(r.created)} · ${n} finding${n === 1 ? '' : 's'}${r.qa?.length ? ` · ${r.qa.length} question${r.qa.length === 1 ? '' : 's'}` : ''}</small></span>
        </button>
        <div class="arc-acts">
          ${r.pages?.length ? '<button class="btn arc-photos">Photos</button>' : ''}
          <button class="btn arc-rename">Rename</button>
          <button class="btn arc-again">Explain again</button>
          <button class="btn arc-del" aria-label="Delete ${esc(r.title)}">Delete</button>
        </div>`;
      li.querySelector('.arc-open').onclick = () => open(r);
      li.querySelector('.arc-photos')?.addEventListener('click', () => showPages(r.pages, r.title));
      li.querySelector('.arc-rename').onclick = async () => {
        const t = prompt('Name this report', r.title);
        if (t && t.trim()) { await archive.update(r.id, { title: t.trim().slice(0, 80) }); refresh(); }
      };
      li.querySelector('.arc-again').onclick = () => reexplain(r);
      li.querySelector('.arc-del').onclick = async () => {
        if (!confirm(`Delete “${r.title}” from this device?`)) return;
        await archive.remove(r.id);
        refresh();
      };
      ul.appendChild(li);
    });
  }
  refresh();
  return { refresh };
}
