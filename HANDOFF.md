# Dr Pocket: handoff

Where the project stands, how it fits together, and what comes next. README.md covers running the
3D app and rebuilding the models; this file adds the rest. Current as of 17 Nov 2026.

## At a glance

- **Live:** https://dr-pocket-two.vercel.app
  - `/health/` is **My health**, the personal health journal (the main product now; installable on the phone).
  - `/` is the 3D body and scan-report explainer; `/shoulder/` is the shoulder walkthrough.
- **Repo:** `septumusrex69/Dr-Pocket`. Every push to `main` deploys automatically. Work happens on branch
  `claude/exciting-shannon-bia9g9` and is fast-forwarded into `main` when the user says "push to main".
- **Hosting:** Vercel, team "Team Raptor", project `dr-pocket`
  (team `team_NqhNnG5PYU2gClsXdgoQMbOE`, project `prj_o7cwssWLQt53fCWMZcvzEJ8cFOTw`).
- **Database:** Supabase project "Dr Pocket" (`lpdvppqtpatbzvrrgdnr`, eu-west-3, org Team Raptor, Pro plan).
- **Vercel environment variables (all sensitive):** `ANTHROPIC_API_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`.
  The same `CRON_SECRET` is stored in the database table `private.app_secrets` (name `cron`).
- **Last change:** `57adc71` "App icon: silver with faint flowing lines and the glossy cross". Deployed.
- **The user's account:** one user so far (the owner). One problem, "Right Sholder" (the typo is the user's own title).

## Open items

1. **Supabase dashboard (no tool for it here):**
   - Authentication → URL Configuration: Site URL `https://dr-pocket-two.vercel.app/health/`; Redirect URLs
     `https://dr-pocket-two.vercel.app/**` and `https://*-team-raptor.vercel.app/**`. Until then, confirmation,
     sign-in-link and password-reset emails point at localhost.
   - Authentication → SMTP: Resend (`smtp.resend.com`, port 465, user `resend`, a Resend API key), sender
     `drpocket@bredellferreira.co.za` (chosen 16 Nov). The built-in mailer sends only a few emails an hour.
2. **Test account to delete:** `qa-preview@drpocket.invalid` (holds a copy of the user's entries plus sample
   pain scores, used for screenshots). Deleting it via SQL asks the user for approval; it has not been approved yet.
3. **Evening reminder not yet switched on by the user:** `push_subscriptions` was empty on 17 Nov. The user has
   step-by-step instructions (open from the Home Screen icon → Settings → Evening reminder → Allow). The first real
   send (cron + web push to an iPhone) has not happened yet; if it fails, check the Vercel function logs for
   `api/evening`.
4. **Not checked on a real iPhone yet:** pinch-to-zoom on the pain chart, and the full-width fix (pages used to be
   shrunk by Safari; see Gotchas).
5. **Older plan points not built:** optional auto-delete of data (never / 6 months / 1 year).

## My health (`/health/`)

The user asked (16 Nov) for: log in, create problems tied to a body area, document everything about each one (dated
notes, X-rays and files, dictation like Raptor/Remus), log exercise, use it on the phone like Remus, and draw a
report over a chosen period that Claude analyses. Then: an end-of-day check-in with a 21:00 reminder, and two
kinds of report (for themselves, and for a clinician).

### Design source of truth

The user's **"Dr Pocket Complete Brand + App Guide"** (16 Nov 2026, 13 pages). Key rules:
- Four-part folded cross (turquoise top, teal left, navy bottom, red right) with transparent seams; wordmark in
  Montserrat italic; palette #0B2342 navy / #006F7F petrol teal / #00C7D9 turquoise / #EF2B3F red / #E6F8F8 mint /
  #F6FAFB off-white; red only for critical emphasis; **no tagline** ("Healthcare in Your Pocket" is not approved).
- Appearance: Light (default) / Dark / High contrast / System; same layout in all.
- Trust: never invent times or pain scores (missing is unknown, never zero); charts show recorded data only;
  summaries cite dated entries; patient-reported language; no diagnosis; AI only after explicit consent.
- The guide also says "no Supabase/login without approval". That line came from the old handoff; the user had
  already asked for phone login, so it was kept (and the user was told).

The user is particular about look and feel and rejected several rounds (six "skins", then many icon options).
Show screenshots of visual changes before going live, and keep explanations plain.

### Screens and features

- **Navigation:** Home | Problems | Add Note (centre) | Timeline | Reports. The gear (top right) is Settings:
  Appearance, Evening reminder, account, install help, Tools (3D body, scan explanation, shoulder walkthrough),
  privacy, delete account.
- **Home:** greeting and today's line, Add note / Log exercise, end-of-day check-in card, active problems with stats,
  recent entries, doctor summary link, tools.
- **Problem:** header (title, clinician diagnosis or area, status), tabs:
  - **Timeline:** stats (tracking days, entries, average pain), the **pain chart**, then the timeline.
  - **Insights:** descriptive counts only, worked out on the device (symptom frequency, pain distribution with
    "not recorded", activities recorded together, triggers/relief written down). Export PDF.
  - **Exercise**, **Media** (files grid, upload), **Details** (edit, archive, delete).
- **Pain chart** (17 Nov, like a stock chart): drag to move through time, pinch or scroll to zoom, double-tap a day
  to see just that day by the hour, tap a dot for its entry. Buttons Day / Week / Month / 3 months / All, ‹ › arrows,
  Today, Pick a day, − / +. Can move back at least 30 days; "All" starts at the first score. Day names and midnight
  lines when a few days are visible. Up to ~10 days joins every score; longer joins the daily average. Scores with
  no recorded time are hollow dots. The overview strip that was under it was removed at the user's request.
- **Timeline:** one heading per day ("Today", "Yesterday", "Saturday, 14 November"); that day's entries are rows in
  one card showing only the time ("No time" if only the date is known). Today open, earlier days folded. Search,
  filter (notes / exercise / with pain), day picker.
- **Add note:** own words first, with dictation. When: Just now / Date and time / Date only (`time_known=false`).
  Optional pain 0–10, symptom chips, **activities (several at once)** from a list (Computer work, Sitting,
  Standing, Walking, Driving, Phone use, Housework, Lifting / carrying, Exercise, Sport, Gardening, Sleeping,
  Lying down, Resting, + Other) with a free-text **"How long, how far?"**, then triggers / relief / impact, files.
  A note saved "just now" within 15 minutes of the last note on the same problem is merged into it (asked for after
  a note and its pain score became two entries).
- **Entry page:** original words, all fields, written-down time, edit history ("earlier versions").
- **Log exercise:** name (remembers previous names), sets, reps, kg, minutes, km, when, pain during/after, notes.
- **End-of-day check-in** (`#/checkin`): "your day so far" summary (on the device), day rating 1–5, overall pain,
  sleep hours and quality, energy, mood, a line of words. Saved as a `kind='day'` entry (General, no problem).
- **Evening reminder:** 21:00 South African time. Vercel cron `0 19 * * *` → `api/evening.js` calls the database
  function `evening_digest(secret)` (per device: today's counts only, never words; skips people who already did
  the check-in) and sends web push (`web-push`, VAPID). The notification opens the check-in. Devices subscribe in
  Settings (rows in `push_subscriptions`). iPhone: only from the Home Screen app, iOS 16.4+.
- **Reports tab, two kinds** (Claude runs only after the consent tick; both cite entries E1…, include check-ins,
  link every point to its entry, Copy / PDF):
  - **Feedback for me** (`reports.kind='feedback'`): headline, how it went, going well, harder, patterns recorded
    together, ideas to try (each with why), what to track, questions for the clinician, urgent, not recorded.
  - **Summary for my doctor** (`clinician`): reason for visit, overview, chronology, changes, limitations,
    activities and exercise, triggers and relief, questions, urgent, not recorded; weekly pain chart; Share.
- **Dictation** (`src/health/dictate.js`): the browser's own speech recognition (free; en-ZA, af-ZA, en-GB), keeps
  listening through pauses. Fixed 17 Nov: on iPhone Safari words are rarely marked "final" until the session ends,
  and Stop used to keep only the final words (2–3 words). Now the text on screen is what is kept, pauses carry on,
  and repeated phrases are de-duplicated. Remus has the older version of this code and likely the same bug.

### Database (Supabase, all migrations applied; files in `supabase/migrations/`)

- `0001_health_journal.sql`: `problems`, `entries`, `files` (private bucket `health`, path
  `uid/<problem>/<uuid>-name`), `reports`; RLS owner-only on every table; `delete_my_account()`.
- `0002_structured_entries.sql`: `problems.diagnosis` (clinician-confirmed), status `archived`; `entries.time_known`,
  `symptoms[]`, `activity`, `triggers`, `relief`, `impact`, `updated_at`, `edits` (history trigger).
- `0003_checkin_push_feedback.sql`: entry kind `day` + `checkin` jsonb; `reports.kind`; `push_subscriptions`;
  schema `private` with `app_secrets`; functions `evening_digest`, `drop_push_subscription` (secret-checked).
- `0004_activities.sql`: `entries.activities[]` and `activity_detail`; `activity` kept as the joined text so older
  code still reads it; history trigger includes them.
- The 8 entries copied from the user's phone notes (14–16 Nov) have `time_known=false` (the notes had dates only).

### Code (`health/index.html`, `src/health/`, `api/`)

| Path | What it is |
|---|---|
| `health/index.html` | Page shell, manifest and icons, Montserrat, pre-paint appearance script |
| `src/health/app.js` | All screens and routing (hash routes), the pain chart, timeline, forms, reports, settings, push sign-up |
| `src/health/db.js` | Every Supabase read and write; `reports.draw` calls `/api/progress` |
| `src/health/config.js` | Supabase URL and publishable key, storage bucket, VAPID public key (all public by design) |
| `src/health/dictate.js` | Dictation |
| `src/health/icons.js` | Line icons; `mark()` and `lockup()` use the logo files in `public/brand/` |
| `src/health/appearance.js` | Light / Dark / High contrast / System |
| `src/health/health.css` | All My health styles, tokens per appearance |
| `api/progress.js` | Both report kinds (Claude Opus 5.5 via `api/_shared.js`, structured output, consent required) |
| `api/evening.js` | The 21:00 reminder sender |
| `public/manifest.webmanifest`, `public/sw.js`, `public/offline.html` | Installable app; the service worker caches no app code (as in Remus), shows an offline page, and handles push |
| `public/brand/` | Logo master files and their README |
| `public/icons/` | Phone icons `icon-180` (iPhone, square), `icon-192`, `icon-512`, `icon-maskable` |

### Logo and app icon

- `public/brand/` holds the **vector master** rebuilt on 16–17 Nov from ChatGPT's low-resolution originals: the
  outline was measured from the image and rebuilt as clean geometry (~95% overlap), with transparent gaps, brand
  colours, gradients fitted to the original's shading, and a soft shadow where the arms fold. Wordmark: Montserrat
  Bold Italic converted to outlines ("Dr" #0B2342, "Pocket" #17465E). Files: symbol (colour / white / navy),
  horizontal (navy text / white text / one-colour navy / one-colour white), stacked, app icons, PNGs, README.
- The app header uses the horizontal SVGs (white-text version in dark mode); sign-in screen and favicon use the
  symbol; the 3D body page header uses it too.
- **App icon (chosen 17 Nov):** silver background (#F7F9FA → #C9D3DA, top to bottom) with very faint navy flowing
  lines and a glossy version of the cross (sheen, edge highlight, soft shadow). iPhone version has square corners
  (iOS rounds them); Android's maskable version keeps the cross in the safe zone. The Android start-up colour is
  `#EEF2F4`. The user tried and rejected: dark navy, light-to-teal, a dozen flat variants, petrol teal with lines.
- The Python and Playwright scripts that built the logo and icons live in the session scratchpad, not the repo.

## The 3D app (`/`)

1. **3D body** from BodyParts3D, one compressed model per body system in `public/models/`: turn, zoom to the cursor,
   double-tap to zoom, tap a part to name it, search, show/hide/see-through each system, one-tap views and regions.
2. **Man / Woman** switch (the woman is the male model reshaped in code, with drawn female organs and vulva).
3. **Explain my scan report:** paste text, photos or a PDF (up to 8 pages); Claude returns findings mapped to model
   parts, plain explanations, quotes, a glossary and questions; follow-up questions.
4. **Narrated walkthrough** of the findings (camera director, pins, subtitles, browser speech).
5. **My reports:** a device-only IndexedDB archive with backup and restore (separate from the journal).
6. **Shoulder walkthrough** (`/shoulder/?case=healthy|bankart|slap|cuff|oa|tight`).

| Path | What it is |
|---|---|
| `index.html` | Main page (header now shows the logo and a My health button) |
| `src/main.js` | Viewer core, camera director, Man/Woman reshaping |
| `src/report.js`, `src/film.js`, `src/archive.js` | Scan report flow, walkthrough player, archive |
| `src/style.css` | Styles for the 3D app |
| `api/explain.js`, `api/ask.js`, `api/_shared.js` | Claude Opus 5.5 with structured output, prompt caching, per-IP rate limit, server-side fallback; logs sizes and outcomes only |
| `api/_vocab.js`, `public/models/vocab.json` | The only structure names Claude may use (`tools/build_vocab.mjs`) |
| `tools/` | Model pipeline (see README.md); `build_added.py` draws 90+ structures and the female organs |
| `shoulder/`, `public/shoulder/` | Shoulder walkthrough |
| `vite.config.js` | Three pages (`/`, `/shoulder/`, `/health/`) and `__MODELS_VERSION__` |
| `vercel.json` | Function limits (explain 300 s, ask 120 s, progress 300 s, evening 60 s), the cron, model caching, service worker headers |

## Conventions and gotchas

- **Going live:** the user says "push to main"; a fast-forward of `main` to the branch. The session's safety check
  blocks pushes to `main` unless the user's latest message clearly asks for it.
- **iPhone Safari width:** Safari shrinks the whole page if anything pokes past the screen edge. Date inputs used to
  do that (they ignore width unless `appearance:none`). `html,body` and `.page` use `overflow-x:clip` (not
  `hidden`, which would break the sticky header and scrolling).
- **Web push on iPhone** works only from the Home Screen app. Notification permission is per device.
- **Secrets:** the cron secret and VAPID private key exist only in Vercel and in `private.app_secrets`; local copies
  were deleted. To rotate: generate new values, update both places (and VAPID: the public key in `config.js`; every
  device then has to turn the reminder on again).
- **3D viewer:** Y-up metres, front is +z, the body's right side is −x; renders on demand (call the redraw helpers);
  the groin cut-out (`clipSkin`, `vShape`) must stay in step with the drawn vulva; `curve()` is Catmull-Rom; drawn
  parts use `depthWrite`; model changes mean re-running the pipeline and committing `public/models/`.
  BodyParts3D quirks: the central canal only covers the neck; `classify.py` fixes bladder/gallbladder and
  oral/temporal mix-ups.
- **Testing** (scripts are in the session scratchpad, not the repo):
  - Build with `npm run build`, serve `dist/` and run `api/progress.js` behind a local stand-in server, with a fake
    Anthropic endpoint (`ANTHROPIC_BASE_URL`) that answers in the right JSON shape.
  - Playwright at iPhone sizes against the real Supabase project, signed in as the test account.
  - The sandbox needs `lpdvppqtpatbzvrrgdnr.supabase.co` allowed (done) and `NODE_USE_ENV_PROXY=1` for Node.
  - Dictation was tested with a fake recogniser that behaves like iPhone Safari (nothing final, repeated phrases,
    a pause that restarts the session).
  - Check a deploy with the Vercel deployments list.

## Ideas not yet built

- AI help to fill in symptom/activity fields from the user's own words (the guide leaves this to a later release).
- More joint walkthroughs (knee, hip, spine); a dedicated female model.
- Committing the test scripts to the repo.

## Sample input

A sample shoulder MRI report with mixed findings, for testing **Explain my scan report**: a partial supraspinatus
tear, a SLAP tear, biceps tenosynovitis, AC arthrosis and bursitis, plus normal subscapularis, cartilage and bone.
