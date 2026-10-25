// The tagline is a piece of string. Grab its end and pull, and the letters unravel one by one,
// swing on the thread and pile up at the bottom of the screen. Leave it alone for a few seconds
// and the string reels itself back into the sentence.
//
// Each character is a point on a rope (Verlet integration with distance constraints). Letters
// still sitting in the sentence are pinned to their place and drawn by the page itself; the loose
// ones are drawn on a canvas laid over the whole window.

const GRAVITY = 2200;          // px/s²
const ITERATIONS = 14;         // constraint passes per step
const SUBSTEPS = 2;
const REWIND_AFTER_MS = 5000;  // idle time before the string reels itself back in
const REWIND_SPEED = 1100;     // px/s for the letter being reeled in

export function startTextString({ tagline, typed, text }) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const n = text.length;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:900';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  };
  resize();
  addEventListener('resize', () => { resize(); measure(); });

  // Where each character sits inside the tagline, relative to its box, measured from the page.
  let home = [], rest = [], radius = 6, font = '';
  function measure() {
    const node = typed.firstChild;
    if (!node || node.length < n) return;
    const box = tagline.getBoundingClientRect();
    const range = document.createRange();
    home = [];
    for (let i = 0; i < n; i++) {
      range.setStart(node, i); range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      home.push({ x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, w: r.width });
    }
    rest = home.map((h, i) => (i ? Math.hypot(h.x - home[i - 1].x, h.y - home[i - 1].y) : 0));
    const style = getComputedStyle(typed);
    font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    radius = parseFloat(style.fontSize) * 0.34;
  }

  const pts = Array.from({ length: n }, () => ({ x: 0, y: 0, px: 0, py: 0 }));
  let pinned = n;                 // characters 0..pinned-1 are still in the sentence
  const grabs = new Map();        // pointerId -> { i, x, y }
  let lastTouch = 0, rewinding = false, rewindAt = Infinity;
  let running = false, last = 0, box = null;

  const homeAt = (i) => ({ x: box.left + home[i].x, y: box.top + home[i].y });
  const isGrabbed = (i) => { for (const g of grabs.values()) if (g.i === i) return true; return false; };

  function showPinned() {
    typed.textContent = text.slice(0, pinned);
  }

  // Free the last letter still in the sentence, starting it exactly where it was drawn.
  function unpinOne() {
    if (pinned === 0) return false;
    pinned--;
    const h = homeAt(pinned);
    Object.assign(pts[pinned], { x: h.x, y: h.y, px: h.x, py: h.y });
    showPinned();
    if (text[pinned] !== ' ' && navigator.vibrate) navigator.vibrate(3);
    return true;
  }

  function hitLoose(x, y) {
    let best = -1, bestD = (radius * 2.2) ** 2;
    for (let i = pinned; i < n; i++) {
      const d = (pts[i].x - x) ** 2 + (pts[i].y - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  function onTagline(x, y) {
    const r = tagline.getBoundingClientRect();
    return pinned > 0 && x > r.left - 14 && x < r.right + 24 && y > r.top - 16 && y < r.bottom + 16;
  }
  const hits = (x, y) => (home.length ? hitLoose(x, y) >= 0 || onTagline(x, y) : false);

  function grab(e) {
    if (!home.length) return false;
    box = tagline.getBoundingClientRect();
    let i = hitLoose(e.clientX, e.clientY);
    if (i < 0 && onTagline(e.clientX, e.clientY)) {
      // Touching the sentence takes hold of its loose end.
      unpinOne();
      i = pinned;
    }
    if (i < 0) return false;
    grabs.set(e.pointerId, { i, x: e.clientX, y: e.clientY });
    rewinding = false; rewindAt = Infinity;
    start();
    return true;
  }

  addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    if (!grab(e)) return;
    e.preventDefault();
    document.documentElement.style.cursor = 'grabbing';
  }, { capture: true });
  // On touch screens the page would scroll instead, so hold the touch when it lands on the string.
  addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) if (hits(t.clientX, t.clientY)) { e.preventDefault(); return; }
  }, { passive: false, capture: true });
  addEventListener('touchmove', (e) => { if (grabs.size) e.preventDefault(); }, { passive: false, capture: true });

  addEventListener('pointermove', (e) => {
    const g = grabs.get(e.pointerId);
    if (g) { g.x = e.clientX; g.y = e.clientY; return; }
    if (e.pointerType === 'mouse' && !e.buttons) {
      document.documentElement.style.cursor = hits(e.clientX, e.clientY) ? 'grab' : '';
    }
  });
  const release = (e) => {
    if (!grabs.delete(e.pointerId)) return;
    lastTouch = performance.now();
    if (!grabs.size) { rewindAt = lastTouch + REWIND_AFTER_MS; document.documentElement.style.cursor = ''; }
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);

  function step(dt) {
    // move
    for (let i = pinned; i < n; i++) {
      const p = pts[i];
      if (isGrabbed(i)) continue;
      const vx = (p.x - p.px) * 0.995, vy = (p.y - p.py) * 0.995;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy + GRAVITY * dt * dt;
    }
    for (const g of grabs.values()) {
      const p = pts[g.i];
      p.px = p.x; p.py = p.y; p.x = g.x; p.y = g.y;
    }

    // Pulling the string taut draws more letters out of the sentence.
    if (grabs.size && pinned > 0) {
      for (let k = 0; k < 3 && pinned > 0; k++) {
        const anchor = homeAt(pinned - 1);
        let taut = false;
        for (const g of grabs.values()) {
          if (g.i < pinned) continue;
          let len = 0;
          for (let j = pinned; j <= g.i; j++) len += rest[j];
          if (Math.hypot(g.x - anchor.x, g.y - anchor.y) > len * 0.97) taut = true;
        }
        if (!taut || !unpinOne()) break;
      }
    }

    // Reeling in: the letter next to the sentence heads home, dragging the rest of the string.
    let reel = -1;
    if (rewinding && pinned < n) {
      reel = pinned;
      const p = pts[reel], h = homeAt(reel);
      const dx = h.x - p.x, dy = h.y - p.y, d = Math.hypot(dx, dy);
      const s = REWIND_SPEED * dt;
      p.px = p.x; p.py = p.y;
      if (d <= Math.max(s, 1.5)) {
        pinned++; showPinned();
        if (pinned === n) rewinding = false;
        reel = -1;
      } else { p.x += (dx / d) * s; p.y += (dy / d) * s; }
    }

    const fixed = (i) => i < pinned || i === reel || isGrabbed(i);
    for (let it = 0; it < ITERATIONS; it++) {
      // string
      for (let i = Math.max(1, pinned); i < n; i++) {
        const a = i - 1 < pinned ? homeAt(i - 1) : pts[i - 1], b = pts[i];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - rest[i]) / d;
        const fa = fixed(i - 1), fb = fixed(i);
        if (fa && fb) continue;
        const wa = fa ? 0 : fb ? 1 : 0.5, wb = fb ? 0 : fa ? 1 : 0.5;
        if (!fa) { a.x += dx * diff * wa; a.y += dy * diff * wa; }
        if (!fb) { b.x -= dx * diff * wb; b.y -= dy * diff * wb; }
      }
      // letters bump into each other, so they heap up instead of passing through
      if (it % 4 === 0) {
        const min = radius * 2, min2 = min * min;
        for (let i = pinned; i < n; i++) {
          if (text[i] === ' ') continue;
          for (let j = i + 2; j < n; j++) {
            if (text[j] === ' ') continue;
            const a = pts[i], b = pts[j];
            const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
            if (d2 >= min2 || d2 === 0) continue;
            const d = Math.sqrt(d2), push = (min - d) / d / 2;
            if (!fixed(i)) { a.x -= dx * push; a.y -= dy * push; }
            if (!fixed(j)) { b.x += dx * push; b.y += dy * push; }
          }
        }
      }
      // floor and walls
      for (let i = pinned; i < n; i++) {
        if (fixed(i)) continue;
        const p = pts[i];
        if (p.y > H - radius) { p.y = H - radius; p.px += (p.x - p.px) * 0.35; }
        if (p.x < radius) p.x = radius;
        if (p.x > W - radius) p.x = W - radius;
      }
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (pinned === n) return;
    ctx.font = font;
    ctx.fillStyle = getComputedStyle(typed).color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = pinned; i < n; i++) {
      if (text[i] === ' ') continue;
      const p = pts[i];
      const a = i === 0 ? p : i > pinned ? pts[i - 1] : homeAt(i - 1);
      const b = i < n - 1 ? pts[i + 1] : p;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Number.isFinite(ang) ? ang : 0);
      ctx.fillText(text[i], 0, 0);
      ctx.restore();
    }
  }

  function frame(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
    last = now;
    box = tagline.getBoundingClientRect();
    if (!grabs.size && pinned < n && !rewinding && now > rewindAt) rewinding = true;
    for (let s = 0; s < SUBSTEPS; s++) step(dt / SUBSTEPS);
    draw();
    if (pinned === n && !grabs.size) { running = false; return; }
    requestAnimationFrame(frame);
  }
  function start() {
    if (running) return;
    running = true; last = performance.now();
    requestAnimationFrame(frame);
  }

  // Once the sentence has been typed out, let the last few letters slip and swing back, so it is
  // clear the string comes loose. Only once per visit.
  function ready() {
    measure();
    let shown = false;
    try { shown = sessionStorage.getItem('clifcode-string-hint') === '1'; } catch {}
    if (shown) return;
    try { sessionStorage.setItem('clifcode-string-hint', '1'); } catch {}
    setTimeout(() => {
      if (grabs.size || pinned < n) return;
      box = tagline.getBoundingClientRect();
      for (let k = 0; k < 4; k++) unpinOne();
      for (let i = pinned; i < n; i++) { pts[i].px -= 2.2 * (i - pinned + 1); pts[i].py -= 1.5; }
      rewindAt = performance.now() + 700;
      start();
    }, 900);
  }
  if (typed.dataset.typed === 'done') ready();
  else typed.addEventListener('typed', ready, { once: true });
}
