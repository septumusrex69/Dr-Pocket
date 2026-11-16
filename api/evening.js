// GET /api/evening - the 21:00 reminder (Vercel cron, 19:00 UTC = 21:00 in South Africa).
// For every subscribed device it gets that person's counts for today (never their words) from the
// database function evening_digest, and sends a short notification that opens the end-of-day check-in.
// Needs CRON_SECRET (also stored in the database's private.app_secrets) and VAPID_PRIVATE_KEY on Vercel.
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY } from '../src/health/config.js';

const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;

export function message(row) {
  if (row.checked_in) return null; // already did today's check-in
  const bits = [];
  if (row.entries) bits.push(n(row.entries, 'entry').replace('entrys', 'entries'));
  if (row.exercise) bits.push(n(row.exercise, 'exercise session'));
  if (row.pain_min != null) bits.push(`pain ${row.pain_min}${row.pain_max !== row.pain_min ? `–${row.pain_max}` : ''}/10`);
  return {
    title: 'How was your day?',
    body: bits.length ? `Today: ${bits.join(' · ')}. Take a minute for your end-of-day check-in.` : 'Nothing recorded today. Take a minute for your end-of-day check-in.',
    url: '/health/#/checkin',
  };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Not allowed.' });
  if (!process.env.VAPID_PRIVATE_KEY) return res.status(503).json({ error: 'Push is not set up (VAPID_PRIVATE_KEY).' });
  webpush.setVapidDetails('https://dr-pocket-two.vercel.app', VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc('evening_digest', { p_secret: secret });
  if (error) { console.log(`evening: digest failed ${error.code || ''}`); return res.status(500).json({ error: 'Could not read subscriptions.' }); }
  let sent = 0; let skipped = 0; let gone = 0;
  for (const row of data || []) {
    const msg = message(row);
    if (!msg) { skipped += 1; continue; }
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(msg), { TTL: 6 * 3600, urgency: 'normal' });
      sent += 1;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { gone += 1; await sb.rpc('drop_push_subscription', { p_secret: secret, p_endpoint: row.endpoint }); }
      else console.log(`evening: send failed ${e.statusCode || e.name}`);
    }
  }
  console.log(`evening: sent ${sent}, already checked in ${skipped}, removed ${gone}`);
  return res.status(200).json({ sent, skipped, gone });
}
