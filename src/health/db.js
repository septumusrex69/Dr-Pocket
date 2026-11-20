// Everything the health journal reads and writes, through Supabase. Row level security makes
// sure each person only ever sees their own rows and files.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, BUCKET } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'drpocket.auth' },
  // No automatic retries: without signal they kept each screen waiting about 7 seconds before showing the
  // copy on the phone. A request on a weak signal gives up after 15 s.
  db: { retry: false, timeout: 15000 },
});

const must = ({ data, error }) => { if (error) throw error; return data; };

/* ---------- offline: changes made without signal wait on the phone, then upload ---------- */
// Notes, pain scores, exercise, routines logged and check-ins saved offline go into an outbox in
// IndexedDB (files too, as blobs). Each new entry gets its id on the phone, so uploading it twice can't
// make a duplicate. sync() sends the outbox in order as soon as there is signal.
export const isNetErr = (e) => (typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|load failed|networkerror|network request failed|fetch failed|timed? ?out/i.test(String(e?.message || e || ''));
const idb = (() => {
  let p;
  const open = () => (p ||= new Promise((res, rej) => {
    const r = indexedDB.open('drpocket', 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('outbox')) r.result.createObjectStore('outbox', { keyPath: 'key', autoIncrement: true });
      if (!r.result.objectStoreNames.contains('snap')) r.result.createObjectStore('snap', { keyPath: 'k' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn, store = 'outbox') => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(store, mode); const req = fn(t.objectStore(store)); t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error); }); };
  return {
    all: () => tx('readonly', (st) => st.getAll()), add: (v) => tx('readwrite', (st) => st.add(v)), put: (v) => tx('readwrite', (st) => st.put(v)), del: (k) => tx('readwrite', (st) => st.delete(k)),
    snapGet: (k) => tx('readonly', (st) => st.get(k), 'snap'), snapPut: (k, v) => tx('readwrite', (st) => st.put({ k, v, at: Date.now() }), 'snap'),
  };
})();
const listeners = new Set();
const notify = async () => { const n = await outbox.count().catch(() => 0); listeners.forEach((fn) => fn(n)); };
export const outbox = {
  all: () => idb.all().catch(() => []),
  async count() { return (await outbox.all()).length; },
  onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  pendingEntries: async () => (await outbox.all()).filter((x) => x.op === 'create').map((x) => ({ ...x.row, created_at: x.queued_at, files: [], pending: true })),
  async findCreate(id) { return (await outbox.all()).find((x) => x.op === 'create' && x.id === id); },
};
// While there is signal, keep a full copy of the journal on the phone for the next time there is none.
export async function warmOffline() {
  if (navigator.onLine === false) return;
  await Promise.allSettled([entries.list({ limit: 3000 }), problems.list(), routines.list()]);
}
let syncing = null;
export function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    let done = 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    const items = (await outbox.all()).sort((a, b) => a.key - b.key);
    if (!items.length) return 0;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return 0;
    for (const x of items) {
      try {
        if (x.op === 'create') {
          must(await sb.from('entries').upsert(x.row, { onConflict: 'id', ignoreDuplicates: true }));
          for (const f of x.files || []) await files.upload({ uid: session.user.id, problemId: x.row.problem_id, entryId: x.id, file: new File([f.blob], f.name, { type: f.type }), at: x.row.at, direct: true });
        } else if (x.op === 'update') must(await sb.from('entries').update(x.row).eq('id', x.id));
        else if (x.op === 'remove') must(await sb.from('entries').delete().eq('id', x.id));
        await idb.del(x.key); done += 1;
      } catch (err) {
        if (isNetErr(err)) break; // still no signal: try again later
        console.warn('sync: could not upload one change', err?.message); // keep it, try again later
        break;
      }
    }
    await notify();
    return done;
  })().finally(() => { syncing = null; });
  return syncing;
}

/* ---------- account ---------- */
export const auth = {
  async session() {
    const { data, error } = await sb.auth.getSession().catch((e) => ({ data: {}, error: e }));
    if (data?.session) return data.session;
    // No signal and the sign-in needs refreshing: keep using the account saved on this phone.
    try {
      const saved = JSON.parse(localStorage.getItem('drpocket.auth') || 'null');
      if (saved?.user && (navigator.onLine === false || isNetErr(error))) return { ...saved, offline: true };
    } catch { /* nothing saved */ }
    return null;
  },
  onChange: (fn) => sb.auth.onAuthStateChange((_e, s) => fn(s)),
  signIn: (email, password) => sb.auth.signInWithPassword({ email, password }),
  signUp: (email, password) => sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/health/` } }),
  link: (email) => sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/health/` } }),
  reset: (email) => sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/health/#/password` }),
  setPassword: (password) => sb.auth.updateUser({ password }),
  signOut: () => sb.auth.signOut(),
  async deleteAccount(uid) {
    // Files first: storage cannot be emptied from the database side.
    const paths = must(await sb.from('files').select('path')).map((f) => f.path);
    for (let i = 0; i < paths.length; i += 100) await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    // Anything left over (files are kept in uid/<problem>/), one folder at a time.
    const { data: folders } = await sb.storage.from(BUCKET).list(uid, { limit: 1000 });
    for (const f of folders || []) {
      const { data: left } = await sb.storage.from(BUCKET).list(`${uid}/${f.name}`, { limit: 1000 });
      if (left?.length) await sb.storage.from(BUCKET).remove(left.map((o) => `${uid}/${f.name}/${o.name}`));
    }
    must(await sb.rpc('delete_my_account'));
    await sb.auth.signOut();
  },
};

/* ---------- problems ---------- */
export const problems = {
  async list() {
    let rows;
    try { rows = must(await sb.from('problems').select('*, entries(count)').order('updated_at', { ascending: false })); idb.snapPut('problems', rows).catch(() => {}); } catch (err) {
      if (!isNetErr(err)) throw err;
      rows = (await idb.snapGet('problems').catch(() => null))?.v; if (!rows) throw err;
    }
    return rows.map((p) => ({ ...p, count: p.entries?.[0]?.count ?? 0 }));
  },
  async get(id) {
    try { return must(await sb.from('problems').select('*').eq('id', id).single()); } catch (err) {
      if (!isNetErr(err)) throw err;
      const p = ((await idb.snapGet('problems').catch(() => null))?.v || []).find((x) => x.id === id); if (!p) throw err; return p;
    }
  },
  create: async (p) => must(await sb.from('problems').insert(p).select().single()),
  update: async (id, p) => must(await sb.from('problems').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id).select().single()),
  async remove(id) {
    const paths = must(await sb.from('files').select('path').eq('problem_id', id)).map((f) => f.path);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    must(await sb.from('problems').delete().eq('id', id));
  },
};

/* ---------- entries (notes and exercise) ---------- */
export const entries = {
  /** problemId: a problem's id, 'none' for general (not linked), or null for everything. */
  async list({ problemId = null, kind = null, from = null, to = null, limit = 500 } = {}) {
    let rows = [];
    try {
      let q = sb.from('entries').select('*, files(*)').order('at', { ascending: false }).limit(limit);
      if (problemId === 'none') q = q.is('problem_id', null);
      else if (problemId) q = q.eq('problem_id', problemId);
      if (kind) q = q.eq('kind', kind);
      if (from) q = q.gte('at', from);
      if (to) q = q.lte('at', to);
      rows = must(await q);
      if (!problemId && !kind && !from && !to && limit >= 1000) idb.snapPut('entries', rows).catch(() => {});
    } catch (err) {
      if (!isNetErr(err)) throw err;
      // No signal and this exact list was never loaded: use the copy of the whole journal kept on the phone.
      const snap = (await idb.snapGet('entries').catch(() => null))?.v || [];
      const ok = (e) => (problemId === 'none' ? !e.problem_id : !problemId || e.problem_id === problemId) && (!kind || e.kind === kind) && (!from || e.at >= from) && (!to || e.at <= to);
      rows = snap.filter(ok);
    }
    // Add what is still waiting on this phone, and apply its unsent edits.
    const box = await outbox.all();
    const fits = (e) => (problemId === 'none' ? !e.problem_id : !problemId || e.problem_id === problemId) && (!kind || e.kind === kind) && (!from || e.at >= from) && (!to || e.at <= to);
    const pend = box.filter((x) => x.op === 'create' && fits(x.row)).map((x) => ({ ...x.row, created_at: x.queued_at, files: [], pending: true }));
    const gone = new Set(box.filter((x) => x.op === 'remove').map((x) => x.id));
    const ids = new Set(pend.map((e) => e.id));
    let all = [...pend, ...rows.filter((r) => !ids.has(r.id) && !gone.has(r.id))];
    for (const u of box.filter((x) => x.op === 'update')) all = all.map((e) => (e.id === u.id ? { ...e, ...u.row, pending: true } : e));
    return all.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
  },
  async get(id) {
    const p = await outbox.findCreate(id);
    if (p) return { ...p.row, created_at: p.queued_at, files: [], pending: true };
    let e;
    try { e = must(await sb.from('entries').select('*, files(*)').eq('id', id).single()); } catch (err) {
      if (!isNetErr(err)) throw err;
      e = ((await idb.snapGet('entries').catch(() => null))?.v || []).find((x) => x.id === id);
      if (!e) throw err;
    }
    const u = (await outbox.all()).filter((x) => x.op === 'update' && x.id === id).reduce((acc, x) => ({ ...acc, ...x.row, pending: true }), e);
    return u;
  },
  async create(e) {
    const row = { id: e.id || crypto.randomUUID(), ...e };
    if (navigator.onLine !== false) {
      try { const out = must(await sb.from('entries').insert(row).select().single()); sync(); return out; } catch (err) { if (!isNetErr(err)) throw err; }
    }
    await idb.add({ op: 'create', id: row.id, row, files: [], queued_at: new Date().toISOString() });
    notify();
    return { ...row, created_at: new Date().toISOString(), files: [], pending: true };
  },
  async update(id, e) {
    const p = await outbox.findCreate(id);
    if (p) { p.row = { ...p.row, ...e }; await idb.put(p); notify(); return { ...p.row, pending: true }; }
    if (navigator.onLine !== false) {
      try { return must(await sb.from('entries').update(e).eq('id', id).select().single()); } catch (err) { if (!isNetErr(err)) throw err; }
    }
    await idb.add({ op: 'update', id, row: e, queued_at: new Date().toISOString() });
    notify();
    return { id, ...e, pending: true };
  },
  async remove(id) {
    const p = await outbox.findCreate(id);
    if (p) { for (const x of (await outbox.all()).filter((y) => y.id === id)) await idb.del(x.key); notify(); return; }
    try {
      const paths = must(await sb.from('files').select('path').eq('entry_id', id)).map((f) => f.path);
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
      must(await sb.from('entries').delete().eq('id', id));
    } catch (err) {
      if (!isNetErr(err)) throw err;
      await idb.add({ op: 'remove', id, queued_at: new Date().toISOString() }); notify();
    }
  },
  async exerciseNames() {
    let rows = [];
    try { rows = must(await sb.from('entries').select('exercise').eq('kind', 'exercise').order('at', { ascending: false }).limit(300)); } catch (err) { if (!isNetErr(err)) throw err; }
    return [...new Set(rows.map((r) => r.exercise?.name).filter(Boolean))];
  },
};

/* ---------- exercise routines (a named list of exercises or stretches, logged in one go) ---------- */
export const routines = {
  async list() {
    try { const rows = must(await sb.from('routines').select('*').eq('archived', false).order('name')); idb.snapPut('routines', rows).catch(() => {}); return rows; } catch (err) {
      if (!isNetErr(err)) throw err;
      const rows = (await idb.snapGet('routines').catch(() => null))?.v; if (!rows) throw err; return rows;
    }
  },
  get: async (id) => must(await sb.from('routines').select('*').eq('id', id).single()),
  create: async (r) => must(await sb.from('routines').insert(r).select().single()),
  update: async (id, r) => must(await sb.from('routines').update({ ...r, updated_at: new Date().toISOString() }).eq('id', id).select().single()),
  archive: async (id) => must(await sb.from('routines').update({ archived: true, updated_at: new Date().toISOString() }).eq('id', id)),
};

/* ---------- Claude usage and credit ---------- */
export const usage = {
  mine: async (fromIso) => must(await sb.from('ai_usage').select('id, action, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, detail, created_at').gte('created_at', fromIso).order('created_at', { ascending: false }).limit(1000)),
  async isOwner() { const { data } = await sb.rpc('is_owner'); return data === true; },
  setBaseline: async (amount, asOf) => must(await sb.rpc('set_credit_baseline', { p_amount: amount, p_as_of: asOf })),
  async credits() {
    const s = await auth.session();
    const res = await fetch('/api/credits', { headers: { Authorization: `Bearer ${s?.access_token || ''}` } });
    const out = await res.json().catch(() => ({ error: 'Something went wrong.' }));
    if (!res.ok) throw new Error(out.error || 'Something went wrong.');
    return out;
  },
};

/* ---------- files (X-rays, scans, photos, letters) ---------- */

// Phone photos are 4–12 MB; 2000 px JPEG keeps an X-ray readable at a fraction of the size.
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5e6) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

export const files = {
  async upload({ uid, problemId, entryId, file, at, direct = false }) {
    const f = await shrink(file);
    if (!direct) {
      const p = await outbox.findCreate(entryId);
      if (p || navigator.onLine === false) {
        const item = p || { op: 'create-file', id: entryId };
        if (p) { p.files = [...(p.files || []), { name: file.name, type: f.type, blob: f }]; await idb.put(p); notify(); return { pending: true }; }
        throw new Error('No signal: files can be added to a note saved offline, or once you are back online.');
      }
    }
    const safe = f.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
    const path = `${uid}/${problemId || 'general'}/${crypto.randomUUID()}-${safe}`;
    must(await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false }));
    return must(await sb.from('files').insert({
      problem_id: problemId || null, entry_id: entryId, path, name: file.name, mime: f.type, size: f.size, at,
    }).select().single());
  },
  list: async (problemId) => must(await sb.from('files').select('*').eq('problem_id', problemId).order('at', { ascending: false })),
  async remove(f) { await sb.storage.from(BUCKET).remove([f.path]); must(await sb.from('files').delete().eq('id', f.id)); },
  async urls(paths) {
    if (!paths.length) return {};
    const rows = must(await sb.storage.from(BUCKET).createSignedUrls(paths, 3600));
    return Object.fromEntries(rows.filter((r) => r.signedUrl).map((r) => [r.path, r.signedUrl]));
  },
};

/* ---------- progress reports ---------- */
export const reports = {
  async list(problemId) {
    let q = sb.from('reports').select('id, kind, problem_id, range_label, range_from, range_to, created_at, content->headline').order('created_at', { ascending: false }).limit(50);
    if (problemId) q = q.eq('problem_id', problemId);
    return must(await q);
  },
  get: async (id) => must(await sb.from('reports').select('*').eq('id', id).single()),
  remove: async (id) => must(await sb.from('reports').delete().eq('id', id)),
  async saveContent(id, content) { must(await sb.from('reports').update({ content }).eq('id', id)); },
  async pdf(id, audience) {
    const s = await auth.session();
    const res = await fetch('/api/report-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token || ''}` }, body: JSON.stringify({ id, audience }) });
    if (!res.ok) { const out = await res.json().catch(() => ({})); throw new Error(out.error || 'The PDF could not be made.'); }
    return res.blob();
  },
  async draw(body) {
    const s = await auth.session();
    const res = await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token || ''}` },
      body: JSON.stringify({ ...body, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    const out = await res.json().catch(() => ({ error: 'Something went wrong. Please try again.' }));
    if (!res.ok) throw new Error(out.error || 'Something went wrong.');
    return out;
  },
};
