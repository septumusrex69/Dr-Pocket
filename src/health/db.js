// Everything the health journal reads and writes, through Supabase. Row level security makes
// sure each person only ever sees their own rows and files.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, BUCKET } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'drpocket.auth' },
});

const must = ({ data, error }) => { if (error) throw error; return data; };

/* ---------- account ---------- */
export const auth = {
  session: async () => (await sb.auth.getSession()).data.session,
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
    const rows = must(await sb.from('problems').select('*, entries(count)').order('updated_at', { ascending: false }));
    return rows.map((p) => ({ ...p, count: p.entries?.[0]?.count ?? 0 }));
  },
  get: async (id) => must(await sb.from('problems').select('*').eq('id', id).single()),
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
    let q = sb.from('entries').select('*, files(*)').order('at', { ascending: false }).limit(limit);
    if (problemId === 'none') q = q.is('problem_id', null);
    else if (problemId) q = q.eq('problem_id', problemId);
    if (kind) q = q.eq('kind', kind);
    if (from) q = q.gte('at', from);
    if (to) q = q.lte('at', to);
    return must(await q);
  },
  get: async (id) => must(await sb.from('entries').select('*, files(*)').eq('id', id).single()),
  create: async (e) => must(await sb.from('entries').insert(e).select().single()),
  update: async (id, e) => must(await sb.from('entries').update(e).eq('id', id).select().single()),
  async remove(id) {
    const paths = must(await sb.from('files').select('path').eq('entry_id', id)).map((f) => f.path);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    must(await sb.from('entries').delete().eq('id', id));
  },
  async exerciseNames() {
    const rows = must(await sb.from('entries').select('exercise').eq('kind', 'exercise').order('at', { ascending: false }).limit(300));
    return [...new Set(rows.map((r) => r.exercise?.name).filter(Boolean))];
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
  async upload({ uid, problemId, entryId, file, at }) {
    const f = await shrink(file);
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
