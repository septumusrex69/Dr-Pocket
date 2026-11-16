// Settings → Appearance: Light (default), Dark, High contrast, or System (follows the phone).
// Same layout and content in every mode; only colours, type size and borders change (health.css).
// Saved on this device, and painted before load by the script in health/index.html (keep the key in step).
export const MODES = [
  { id: 'light', name: 'Light', line: 'Clean, bright and easy to read.', icon: 'sun' },
  { id: 'dark', name: 'Dark', line: 'Deep navy, easier on the eyes at night.', icon: 'moon' },
  { id: 'contrast', name: 'High contrast', line: 'Larger text, stronger borders, plainer screens.', icon: 'contrast' },
  { id: 'system', name: 'System', line: 'Follows your phone’s light or dark setting.', icon: 'device' },
];
const KEY = 'drpocket.appearance';

export function currentMode() {
  try { const v = localStorage.getItem(KEY); if (MODES.some((m) => m.id === v)) return v; } catch { /* private mode */ }
  return 'light';
}

const resolved = (id) => (id === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : id);

export function applyMode(id) {
  try { localStorage.setItem(KEY, id); } catch { /* fine */ }
  const r = resolved(id);
  document.documentElement.dataset.appearance = r;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', r === 'dark' ? '#071A2E' : '#FFFFFF');
}

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (currentMode() === 'system') applyMode('system'); });
