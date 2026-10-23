// The game around the grass: grass points and levels, badges, your own stats
// (kept in this browser), and a few counts shared by everyone who visits.

// Shared counts live in Abacus, a free public counter service. Anyone can bump a
// counter, so these are for fun, not for accounting.
const COUNTER_API = 'https://abacus.jasoncameron.dev';
const NAMESPACE = 'clifcode-eth';
export const SHARED = { visitors: 'grass-visitors', minutes: 'grass-minutes', clovers: 'grass-clovers' };

async function counter(action, key) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${COUNTER_API}/${action}/${NAMESPACE}/${key}`, { signal: controller.signal });
    if (response.status === 404) return 0; // nobody has done this yet
    if (!response.ok) return null;
    return (await response.json()).value ?? null;
  } catch {
    return null; // offline or the service is down; the page carries on without it
  } finally {
    clearTimeout(timeout);
  }
}
export const bumpShared = (key) => counter('hit', key);
export const readShared = (key) => counter('get', key);

export const POINTS = { second: 1, flower: 5, butterfly: 10, clover: 50, shake: 2 };

export const LEVELS = [
  [0, 'Indoor kid'], [30, 'Window gazer'], [100, 'Lawn visitor'], [250, 'Park regular'],
  [500, 'Meadow wanderer'], [1000, 'Certified grass toucher'], [2500, 'Grass whisperer'], [5000, 'One with the field']
];

export function levelFor(points) {
  let i = 0;
  while (i + 1 < LEVELS.length && points >= LEVELS[i + 1][0]) i++;
  const [floor, title] = LEVELS[i];
  const next = LEVELS[i + 1]?.[0] ?? null;
  return { number: i + 1, title, floor, next, progress: next ? (points - floor) / (next - floor) : 1 };
}

export const BADGES = [
  { id: 'first', icon: '🌱', name: 'First touch', hint: 'Touch the grass', test: (s) => s.touchedMs > 0 },
  { id: 'minute', icon: '⏱️', name: 'One whole minute', hint: 'Touch grass for a minute', test: (s) => s.touchedMs >= 60e3 },
  { id: 'five', icon: '🧘', name: 'Five quiet minutes', hint: 'Touch grass for five minutes', test: (s) => s.touchedMs >= 300e3 },
  { id: 'clover', icon: '🍀', name: 'Lucky', hint: 'Find a four-leaf clover', test: (s) => s.clovers >= 1 },
  { id: 'clovers', icon: '🌈', name: 'Making your own luck', hint: 'Find five four-leaf clovers', test: (s) => s.clovers >= 5 },
  { id: 'bouquet', icon: '💐', name: 'Bouquet', hint: 'Pick ten flowers', test: (s) => s.flowers >= 10 },
  { id: 'butterfly', icon: '🦋', name: 'Butterfly whisperer', hint: 'Say hello to five butterflies', test: (s) => s.butterflies >= 5 },
  { id: 'shaker', icon: '🌳', name: 'Tree shaker', hint: 'Shake the tree five times', test: (s) => s.shakes >= 5 },
  { id: 'night', icon: '🌙', name: 'Night owl', hint: 'Touch grass at night', test: (s) => s.modes.night },
  { id: 'golden', icon: '🌅', name: 'Golden hour', hint: 'Touch grass at golden hour', test: (s) => s.modes.golden },
  { id: 'allday', icon: '☀️', name: 'All day long', hint: 'Touch grass morning, golden hour and night', test: (s) => s.modes.morning && s.modes.golden && s.modes.night },
  { id: 'streak3', icon: '🔥', name: 'Three days running', hint: 'Come back three days in a row', test: (s) => s.bestStreak >= 3 },
  { id: 'streak7', icon: '🏆', name: 'A week outside', hint: 'Come back seven days in a row', test: (s) => s.bestStreak >= 7 }
];

const STORE_KEY = 'clifcode-grass';
const fresh = () => ({
  points: 0, touchedMs: 0, flowers: 0, butterflies: 0, clovers: 0, shakes: 0,
  visits: 0, streak: 0, bestStreak: 0, lastDay: '', counted: false,
  modes: { morning: false, golden: false, night: false }, badges: {}
});

export function loadStats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) return { ...fresh(), ...saved, modes: { ...fresh().modes, ...saved.modes }, badges: { ...saved.badges } };
  } catch {}
  return fresh();
}
export function saveStats(stats) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(stats)); } catch {}
}

// Count today's visit and keep the run of consecutive days.
export function recordVisit(stats, now = new Date()) {
  const day = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const today = day(now);
  if (stats.lastDay === today) return;
  const yesterday = day(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  stats.streak = stats.lastDay === yesterday ? stats.streak + 1 : 1;
  stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  stats.lastDay = today;
  stats.visits += 1;
}

// Badges newly earned since the last check.
export function newBadges(stats) {
  const earned = [];
  for (const badge of BADGES) {
    if (!stats.badges[badge.id] && badge.test(stats)) {
      stats.badges[badge.id] = Date.now();
      earned.push(badge);
    }
  }
  return earned;
}

export const formatTime = (ms) => {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, '0')}`;
};
export const formatCount = (n) => (n == null ? '—' : n.toLocaleString('en-GB'));
