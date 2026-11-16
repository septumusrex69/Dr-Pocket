/* Talking instead of typing: the speech recognition built into the browser, the same as Remus.
   Free, no key, no supplier, nothing sent anywhere by us. Chrome, Edge and Safari have it
   (Safari on iPhone too); Firefox does not, and the button says so instead of failing.
   The words go straight into the box as you speak, and it keeps listening through pauses
   until you tap Stop, because thinking mid-sentence is normal when describing how you feel. */

const LANGS = [
  { code: 'en-ZA', label: 'English (SA)' },
  { code: 'af-ZA', label: 'Afrikaans' },
  { code: 'en-GB', label: 'English (UK)' },
];
const LANG_KEY = 'drpocket.dictation.language';

function storedLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v && LANGS.some((l) => l.code === v)) return v;
  } catch { /* private mode */ }
  return 'en-ZA';
}

const Ctor = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;

const ENDS_SENTENCE = /[.!?]["')\]]?\s*$/;
export function appendSpeech(existing, spoken) {
  const fragment = spoken.trim().replace(/\s+/g, ' ');
  if (!fragment) return existing;
  const before = existing.replace(/\s+$/, '');
  const starts = before === '' || ENDS_SENTENCE.test(before);
  const piece = starts ? fragment.charAt(0).toUpperCase() + fragment.slice(1) : fragment;
  if (before === '') return piece;
  if (/^[,.;:!?]/.test(piece)) return before + piece;
  return `${before} ${piece}`;
}

function errorText(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The microphone is blocked. Allow it for this site in your settings, then try again.';
    case 'audio-capture': return 'No microphone was found.';
    case 'network': return 'Speech recognition needs a connection. Try again.';
    case 'no-speech': return '';
    case 'aborted': return '';
    default: return 'Dictation stopped. Try again, or type instead.';
  }
}

/** Puts a Dictate button (and its messages) into `host`, filling `textarea` as you speak. */
export function dictation(host, textarea) {
  const wrap = document.createElement('span');
  wrap.className = 'dictate';
  host.append(wrap);
  const C = Ctor();
  if (!C) {
    wrap.innerHTML = '<span class="muted small">Dictation: use the microphone key on your keyboard</span>';
    return { stop() {} };
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small mic';
  const sel = document.createElement('select');
  sel.className = 'small';
  sel.hidden = true;
  sel.setAttribute('aria-label', 'Dictation language');
  for (const l of LANGS) sel.add(new Option(l.label, l.code));
  const err = document.createElement('span');
  err.className = 'err small';
  wrap.append(btn, sel, err);

  let lang = storedLang();
  sel.value = lang;
  let rec = null;
  let wanted = false;
  let base = '';

  const paint = () => {
    btn.innerHTML = wanted
      ? '<span class="rec-dot"></span> Listening · tap to stop'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg> Dictate';
    btn.classList.toggle('on', wanted);
    sel.hidden = !wanted;
  };
  const changed = () => textarea.dispatchEvent(new Event('input', { bubbles: true }));

  function begin() {
    const r = new C();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i];
        if (res.isFinal) {
          base = appendSpeech(base, res[0].transcript);
          textarea.value = base;
        } else pending += res[0].transcript;
      }
      if (pending.trim()) textarea.value = appendSpeech(base, pending);
      changed();
    };
    r.onerror = (e) => {
      const m = errorText(e.error);
      if (m) err.textContent = m;
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) { wanted = false; paint(); }
    };
    // Browsers end a session after a short silence; restart while the button still says Listening.
    r.onend = () => {
      if (!wanted) { paint(); return; }
      setTimeout(() => { if (wanted) begin(); }, 250);
    };
    try { r.start(); rec = r; } catch { wanted = false; err.textContent = 'Dictation could not start. Try again.'; }
    paint();
  }
  function stop() {
    wanted = false;
    try { rec?.stop(); } catch { /* already stopped */ }
    rec = null;
    textarea.value = base || textarea.value;
    changed();
    paint();
  }
  btn.onclick = () => {
    if (wanted) return stop();
    err.textContent = '';
    base = textarea.value;
    wanted = true;
    begin();
  };
  sel.onchange = () => {
    lang = sel.value;
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* fine */ }
    stop();
  };
  paint();
  return { stop };
}
