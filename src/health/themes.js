// The looks you can choose for My health on the phone. Each has its own colours, type, layout
// details (see health.css, [data-skin=...]) and its own home-screen icon. The choice is kept on
// this device (so it paints before anything loads, see health/index.html) and in your account,
// so another device picks it up after you sign in.
// Keep the ids in step with the list in health/index.html.
export const SKINS = [
  { id: 'clinic', name: 'Clinic', line: 'Clean teal cards. Follows your phone’s light or dark mode.', color: '#0A7A66', font: 'IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600' },
  { id: 'midnight', name: 'Midnight', line: 'Deep black with a glowing mint accent. Easy on the eyes at night.', color: '#05080A', font: 'Space+Grotesk:wght@400;500;600;700' },
  { id: 'paper', name: 'Paper', line: 'A warm diary: cream pages, ink, ruled lines.', color: '#F4EDE0', font: 'Fraunces:opsz,wght@9..144,400;9..144,600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600' },
  { id: 'sport', name: 'Sport', line: 'Bold orange on black, big tiles. Built for logging training.', color: '#111111', font: 'Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600' },
  { id: 'calm', name: 'Calm', line: 'Soft lavender to peach, frosted cards, round and gentle.', color: '#C9B8F0', font: 'Nunito:wght@400;600;700;800' },
  { id: 'mono', name: 'Mono', line: 'Black and white, thin lines, nothing extra. Fits the most on screen.', color: '#FFFFFF', font: 'Inter:wght@400;500;600;700' },
];
const KEY = 'drpocket.skin';

export function currentSkin() {
  try { const v = localStorage.getItem(KEY); if (SKINS.some((s) => s.id === v)) return v; } catch { /* private mode */ }
  return 'clinic';
}

function setLink(rel, href) {
  let l = document.querySelector(`link[rel="${rel}"]`);
  if (!l) { l = document.createElement('link'); l.rel = rel; document.head.append(l); }
  l.href = href;
}

export function applySkin(id) {
  const s = SKINS.find((x) => x.id === id) || SKINS[0];
  try { localStorage.setItem(KEY, s.id); } catch { /* fine */ }
  document.documentElement.dataset.skin = s.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.color);
  // iPhone reads this icon when you tap "Add to Home Screen"; Android reads the manifest's.
  setLink('apple-touch-icon', `/icons/${s.id}-180.png`);
  setLink('manifest', `/manifest-${s.id}.webmanifest`);
  let f = document.getElementById('skin-font');
  if (!f) { f = document.createElement('link'); f.id = 'skin-font'; f.rel = 'stylesheet'; document.head.append(f); }
  f.href = `https://fonts.googleapis.com/css2?family=${s.font}&display=swap`;
  return s;
}
