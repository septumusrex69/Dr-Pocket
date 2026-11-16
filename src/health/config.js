// The Dr Pocket Supabase project. Both values are public by design (the key is the publishable
// one); what protects the data is row level security, so every row is readable only by its owner.
// The server functions in api/ import these too.
export const SUPABASE_URL = 'https://lpdvppqtpatbzvrrgdnr.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_G9mi2Cnb3pdH4yQ0uENWSQ_vuHmT1E3';
export const BUCKET = 'health';
// Web push (the 21:00 reminder). The public half of the VAPID key pair; the private half is the
// VAPID_PRIVATE_KEY environment variable on Vercel, used only by api/evening.js.
export const VAPID_PUBLIC_KEY = 'BM57e_gvJAYPa-ue-m-cY4Hrhjv4JdePo3kW8VveizzWBU7bS3RHnBQzrTnvtzabq--Z4bt8dbctjWEayGGtRVc';
