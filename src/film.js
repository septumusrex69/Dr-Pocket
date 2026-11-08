// The narrated walkthrough of a report: an intro, one scene per finding, and a closing scene.
// Each finding scene flies the camera to the spot, colours the part by the kind of change,
// pins a pulsing marker where it is, and reads the explanation aloud with subtitles.
// The voice is the one built into the phone or browser (free, works offline).

const $ = (id) => document.getElementById(id);

export const VISUAL_COLOR = {
  tear: '#E53935', partial_tear: '#F4511E', swelling: '#FFB300', fluid: '#29B6F6', wear: '#FB8C00',
  bone_change: '#AB47BC', narrowing: '#EC407A', bulge: '#FF7043', growth: '#8E24AA', normal: '#43A047', other: '#26A69A',
};

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
  voiceOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 9v6h4l5 5V4L8 9z"/></svg>',
  voiceOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

/* ---------- voice ---------- */
const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
let voice = null;
function pickVoice() {
  if (!canSpeak) return null;
  const all = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  if (!all.length) return null;
  const good = /(natural|neural|premium|enhanced|siri|google uk english female|google us english|samantha|daniel|karen|moira|serena|libby|sonia|ava|zoe|aria|jenny)/i;
  const score = (v) => (good.test(v.name) ? 4 : 0) + (/en-(ZA|GB|AU|IE)/i.test(v.lang) ? 2 : /en-US/i.test(v.lang) ? 1 : 0) + (v.localService ? 0 : 1);
  return all.sort((a, b) => score(b) - score(a))[0];
}
if (canSpeak) {
  voice = pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', () => { voice = pickVoice(); });
}

const sentencesOf = (text) => (String(text || '').match(/[^.!?]+[.!?]*/g) || []).map((x) => x.trim()).filter(Boolean);
function subtitle(s) {
  const el = $('film-text');
  el.textContent = s || '';
  el.hidden = !s;
}

export function createFilm(body, { onScene } = {}) {
  const viewer = document.querySelector('.viewer');
  let scenes = [];
  let region = 'body';
  let i = 0;
  let playing = false;
  let voiceOn = canSpeak;
  let token = 0; // bumps whenever the current narration is cancelled
  let timers = [];
  let pin = null; // { point }
  let run = 0; // bumps on every play/show, so a slow scene change can't start a second voice
  let finished = false;
  let offFrame = null;

  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  function stopVoice() {
    token++;
    clearTimers();
    if (canSpeak) speechSynthesis.cancel();
  }

  /* Read the text sentence by sentence (long single utterances get cut off in some browsers),
     showing each sentence as a subtitle while it is spoken. Without a voice, the subtitles
     move on at reading pace. A watchdog moves on if a browser never reports the end of a sentence. */
  function narrate(text, done) {
    const my = ++token;
    const sentences = sentencesOf(text);
    if (!voiceOn || !canSpeak || !sentences.length) {
      let k = 0;
      const next = () => {
        if (my !== token) return;
        if (k >= sentences.length) { done(); return; }
        const s = sentences[k++];
        subtitle(s);
        later(next, Math.max(2200, s.split(/\s+/).length * 380));
      };
      next();
      return;
    }
    let k = 0;
    const step = () => {
      if (my !== token) return;
      clearTimers();
      if (k >= sentences.length) { done(); return; }
      const s = sentences[k++];
      subtitle(s);
      const u = new SpeechSynthesisUtterance(s);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || 'en-GB';
      u.rate = 0.96;
      u.onend = step;
      u.onerror = step;
      later(step, 2500 + s.split(/\s+/).length * 650);
      speechSynthesis.speak(u);
    };
    if (canSpeak) speechSynthesis.cancel();
    step();
  }

  /* ---------- the pin that follows the spot on screen ---------- */
  function placePin() {
    const el = $('pin');
    if (!pin) { el.hidden = true; return; }
    const p = body.toScreen(pin.point);
    if (!p) { el.hidden = true; return; }
    el.hidden = false;
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.classList.toggle('flip', p.x > viewer.clientWidth - 200);
  }

  /* ---------- scenes ---------- */
  async function show(k) {
    i = Math.max(0, Math.min(scenes.length - 1, k));
    const sc = scenes[i];
    renderBar();
    $('film-title').textContent = sc.title;
    subtitle(sentencesOf(sc.text)[0] || sc.text);
    onScene?.(i, sc);

    pin = null;
    placePin();
    // a structure the model lacks is drawn the first time its scene comes up
    if (sc.kind === 'finding' && sc.draw && !sc.drawnId && sc.draw.fromIds.length) {
      sc.drawnId = await body.drawStandIn(sc.draw);
      if (scenes[i] !== sc) return;
      if (sc.drawnId) { sc.ids = [sc.drawnId, ...sc.ids]; sc.focusIds = [sc.drawnId]; }
    }
    if (sc.kind === 'finding' && sc.ids.length) {
      const color = VISUAL_COLOR[sc.visual] || VISUAL_COLOR.other;
      // only the problem part stays solid; its neighbours fade like the rest (bones stay clearly
      // visible), so a ligament or cartilage inside a joint is not hidden by the bones around it
      const solid = sc.focusIds.length ? sc.focusIds : sc.ids;
      const ok = await body.focusParts(solid, sc.title, sc.sub, color, solid);
      if (!ok || scenes[i] !== sc) return;
      const m = body.markerFor(sc.focusIds.length ? sc.focusIds : sc.ids, sc.nearIds);
      if (m) {
        body.cinematic(m); // wide shot, glide in while the layers fade, then circle the spot
        pin = { point: m.point };
        const el = $('pin');
        el.style.setProperty('--pin', color);
        $('pin-label').textContent = sc.label || '';
        $('pin-label').hidden = !sc.label;
        placePin();
      }
    } else {
      body.tourRegion(sc.region || region); // slow circling shot of the region, body intact
    }
  }

  function playFrom(k) {
    stopVoice();
    const my = ++run;
    playing = true;
    finished = false;
    renderBar();
    show(k).then(() => {
      if (my !== run || !playing) return;
      narrate(scenes[i].text, () => {
        if (my !== run || !playing) return;
        if (i < scenes.length - 1) later(() => my === run && playing && playFrom(i + 1), 900);
        else { playing = false; finished = true; renderBar(); }
      });
    });
  }
  function still(k) { stopVoice(); run++; playing = false; renderBar(); show(k); }
  // a scene opened while paused still gets its guided camera move; Pause or a touch stops it

  function pause() {
    run++;
    playing = false;
    body.stopCine();
    stopVoice();
    renderBar();
  }

  function renderBar() {
    $('film-play').innerHTML = playing ? ICON.pause : ICON.play;
    $('film-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('film-voice').innerHTML = voiceOn ? ICON.voiceOn : ICON.voiceOff;
    $('film-voice').setAttribute('aria-label', voiceOn ? 'Turn voice off' : 'Turn voice on');
    $('film-voice').hidden = !canSpeak;
    $('film-prev').disabled = i === 0;
    $('film-next').disabled = i === scenes.length - 1;
    const dots = $('film-dots');
    dots.innerHTML = '';
    scenes.forEach((sc, k) => {
      const b = document.createElement('button');
      b.className = 'dot';
      b.setAttribute('aria-label', `Scene ${k + 1}: ${sc.title}`);
      b.setAttribute('aria-current', k === i ? 'step' : 'false');
      if (sc.visual) b.style.setProperty('--dot', VISUAL_COLOR[sc.visual] || VISUAL_COLOR.other);
      b.onclick = () => (playing ? playFrom(k) : still(k));
      dots.appendChild(b);
    });
    $('film-step').textContent = `${i + 1} / ${scenes.length}`;
  }

  // controls
  $('film-play').innerHTML = ICON.play;
  $('film-prev').innerHTML = ICON.prev;
  $('film-next').innerHTML = ICON.next;
  $('film-x').innerHTML = ICON.close;
  $('film-play').onclick = () => {
    if (playing) pause();
    else playFrom(finished ? 0 : i);
  };
  $('film-prev').onclick = () => (playing ? playFrom(i - 1) : still(i - 1));
  $('film-next').onclick = () => (playing ? playFrom(i + 1) : still(i + 1));
  $('film-voice').onclick = () => {
    voiceOn = !voiceOn;
    if (playing) playFrom(i); else renderBar();
  };
  $('film-x').onclick = () => close();

  function open(data, { start = 0, play = false } = {}) {
    scenes = data.scenes;
    region = data.region || 'body';
    $('film').hidden = false;
    viewer.classList.add('filming');
    document.body.classList.add('filming');
    if (!offFrame) offFrame = body.onFrame(placePin);
    finished = false;
    if (play) playFrom(start);
    else still(start);
  }

  function close() {
    pause();
    pin = null;
    placePin();
    $('film').hidden = true;
    body.stopCine();
    viewer.classList.remove('filming');
    document.body.classList.remove('filming');
    if (offFrame) { offFrame(); offFrame = null; }
    body.deselect();
  }

  return { open, close, get isOpen() { return !$('film').hidden; } };
}
