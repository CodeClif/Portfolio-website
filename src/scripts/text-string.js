// Text is a piece of string. Grab its end and pull, and the letters unravel one by one, swing on
// the thread and pile up at the bottom of the screen. Pull enough out and the weight of the
// hanging string keeps unravelling it by itself. Leave it alone for a few seconds and it reels
// back into place.
//
// Each character is a point on a rope (Verlet integration with distance constraints). Letters
// still in the text stay in the page; a letter that comes loose is moved into a transparent span
// right after its text node, so the page keeps its exact layout, and is drawn on a canvas instead.
// Letters are measured only as they come loose, so a long article costs nothing until pulled.

const GRAVITY = 2200;          // px/s²
const ITERATIONS = 12;         // constraint passes per step
const SUBSTEPS = 2;
const REWIND_AFTER_MS = 5000;  // idle time before the string reels itself back in
const POUR_AFTER = 40;         // a hanging string longer than this keeps unravelling under its own weight

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSpace = (c) => /\s/.test(c);

let shared = null;
function overlay() {
  if (shared) return shared;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:900';
  document.body.appendChild(canvas);
  shared = { canvas, ctx: canvas.getContext('2d'), W: 0, H: 0, dpr: 1 };
  const resize = () => {
    shared.dpr = Math.min(2, devicePixelRatio || 1);
    shared.W = innerWidth; shared.H = innerHeight;
    canvas.width = Math.round(shared.W * shared.dpr); canvas.height = Math.round(shared.H * shared.dpr);
  };
  resize();
  addEventListener('resize', resize);
  return shared;
}

// While the string is out, the page must not scroll or bounce under the finger. Cancelling touch
// events is not enough in in-app browsers on iPhone; touch-action is what they respect.
function holdPage(on) {
  for (const el of [document.documentElement, document.body]) {
    el.style.touchAction = on ? 'none' : '';
    el.style.overscrollBehavior = on ? 'none' : '';
  }
}

// nodes(): the text nodes that make up the string, in reading order.
// grabZone(): optional box (viewport coordinates) that takes hold of the loose end when touched;
//   by default it is the last word still in place.
// maxLoose: most letters that can be out at once, so a whole article never piles up.
export function makePullable({ nodes: collect, grabZone, maxLoose = 1600 }) {
  if (reducedMotion()) return null;
  const view = overlay();

  let segs = null, chars = [], n = 0, pinned = 0;
  let home = [], rest = [], style = [], pts = [];
  const grabs = new Map();            // pointerId -> { i, x, y }
  const held = new Set();
  let rewinding = false, rewindAt = Infinity, running = false, last = 0;

  function build() {
    if (segs) return true;
    const list = collect().filter((t) => t.data.length);
    if (!list.length) return false;
    segs = list.map((node) => ({ node, span: null, hidden: null }));
    segs.forEach((seg, k) => {
      let off = 0;
      for (const c of seg.node.data) { chars.push({ c, k, off, len: c.length }); off += c.length; }
    });
    n = pinned = chars.length;
    home = new Array(n); rest = new Array(n).fill(0); style = new Array(n);
    pts = Array.from({ length: n }, () => ({ x: 0, y: 0, px: 0, py: 0 }));
    return true;
  }

  // Where a character sits on the page (document coordinates). Only works while it is still shown.
  function measure(i) {
    if (home[i]) return home[i];
    const ch = chars[i], node = segs[ch.k].node;
    const el = node.parentElement, cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    style[i] = { font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, color: cs.color, r: size * 0.34, size };
    const range = document.createRange();
    range.setStart(node, ch.off); range.setEnd(node, ch.off + ch.len);
    const rects = range.getClientRects();
    const r = rects[rects.length - 1];
    if (r && r.width > 0) home[i] = { x: r.left + r.width / 2 + scrollX, y: r.top + r.height / 2 + scrollY, w: r.width };
    else if (home[i + 1]) home[i] = { x: home[i + 1].x - size * 0.3, y: home[i + 1].y, w: size * 0.3 };
    else {
      const b = el.getBoundingClientRect();
      home[i] = { x: b.right + scrollX, y: b.bottom - size / 2 + scrollY, w: size * 0.3 };
    }
    // the thread between this letter and the next one
    if (i + 1 < n && home[i + 1]) {
      const a = home[i], b = home[i + 1];
      const sameLine = Math.abs(a.y - b.y) < size * 0.5 && b.x > a.x && b.x - a.x < size * 3;
      rest[i + 1] = isSpace(chars[i].c) && isSpace(chars[i + 1].c) ? 0.5 : sameLine ? b.x - a.x : Math.max(2, (a.w + b.w) / 2);
    }
    return home[i];
  }
  const homeV = (i) => { const h = measure(i); return { x: h.x - scrollX, y: h.y - scrollY }; };

  // Take the last letter still in the text out of it, starting exactly where it was drawn.
  function unpinOne() {
    if (pinned === 0 || n - pinned >= maxLoose) return false;
    const i = pinned - 1;
    const h = homeV(i);
    if (i > 0) measure(i - 1);
    const ch = chars[i], seg = segs[ch.k];
    if (!seg.span) {
      seg.span = document.createElement('span');
      seg.span.style.color = 'transparent';
      seg.hidden = document.createTextNode('');
      seg.span.append(seg.hidden);
      seg.node.after(seg.span);
    }
    seg.node.deleteData(ch.off, ch.len);
    seg.hidden.insertData(0, ch.c);
    pinned = i;
    Object.assign(pts[i], { x: h.x, y: h.y, px: h.x, py: h.y });
    if (!isSpace(ch.c) && navigator.vibrate && grabs.size) navigator.vibrate(3);
    return true;
  }
  // Put the next loose letter back into the text.
  function pinOne() {
    const ch = chars[pinned], seg = segs[ch.k];
    seg.hidden.deleteData(0, ch.len);
    seg.node.appendData(ch.c);
    if (!seg.hidden.length) { seg.span.remove(); seg.span = seg.hidden = null; }
    pinned++;
  }

  function endZone() {
    if (grabZone) return grabZone();
    let box = null;
    for (let i = pinned - 1, k = 0; i >= 0 && k < 8; i--) {
      if (isSpace(chars[i].c)) { if (k) break; continue; }
      const h = homeV(i), s = style[i].size / 2;
      box = box ? { left: Math.min(box.left, h.x - s), right: Math.max(box.right, h.x + s), top: Math.min(box.top, h.y - s), bottom: Math.max(box.bottom, h.y + s) }
        : { left: h.x - s, right: h.x + s, top: h.y - s, bottom: h.y + s };
      k++;
    }
    return box;
  }
  function onEnd(x, y) {
    if (!pinned) return false;
    const z = endZone();
    return !!z && x > z.left - 16 && x < z.right + 24 && y > z.top - 16 && y < z.bottom + 16;
  }
  function hitLoose(x, y) {
    let best = -1, bestD = Infinity;
    for (let i = pinned; i < n; i++) {
      if (isSpace(chars[i].c)) continue;
      const d = (pts[i].x - x) ** 2 + (pts[i].y - y) ** 2, lim = (style[i].r * 2.4) ** 2;
      if (d < lim && d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  const hits = (x, y) => build() && (hitLoose(x, y) >= 0 || onEnd(x, y));

  function grab(e) {
    if (!build()) return false;
    let i = hitLoose(e.clientX, e.clientY);
    if (i < 0 && onEnd(e.clientX, e.clientY) && unpinOne()) i = pinned;
    if (i < 0) return false;
    grabs.set(e.pointerId, { i, x: e.clientX, y: e.clientY });
    held.add(i);
    holdPage(true);
    rewinding = false; rewindAt = Infinity;
    start();
    return true;
  }

  // An invisible handle over the loose end. A touch that starts on it never scrolls the page, which
  // is the only thing in-app browsers on iPhone reliably respect. The tagline has its own CSS.
  let handle = null;
  function placeHandle() {
    if (grabZone || !armed || !build() || pinned < n) return;
    const z = endZone();
    if (!z) return;
    if (!handle) {
      handle = document.createElement('div');
      handle.setAttribute('aria-hidden', 'true');
      handle.style.cssText = 'position:absolute;z-index:2;touch-action:none;cursor:grab;-webkit-user-select:none;user-select:none';
      document.body.appendChild(handle);
    }
    // kept inside the page width, so it never makes the page scroll sideways
    const left = Math.max(0, z.left - 16), right = Math.min(document.documentElement.clientWidth, z.right + 24);
    Object.assign(handle.style, {
      left: `${left + scrollX}px`, top: `${z.top - 16 + scrollY}px`,
      width: `${right - left}px`, height: `${z.bottom - z.top + 32}px`
    });
  }
  // When the page around the text changes size (images loading, rotating the phone), every letter
  // has a new place, so forget the old ones.
  function relayout() {
    if (!segs || pinned < n) return;
    home = new Array(n); rest.fill(0);
    placeHandle();
  }

  let armed = false;
  // Listening starts once the text is ready to be pulled.
  function arm() {
    if (armed) return;
    armed = true;
    addEventListener('pointerdown', (e) => {
      if (e.button > 0 || !grab(e)) return;
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
        const root = document.documentElement.style;
        if (hits(e.clientX, e.clientY)) root.cursor = 'grab';
        else if (root.cursor === 'grab') root.cursor = '';
      }
    });
    const release = (e) => {
      const g = grabs.get(e.pointerId);
      if (!g) return;
      grabs.delete(e.pointerId); held.delete(g.i);
      if (!grabs.size) { rewindAt = performance.now() + REWIND_AFTER_MS; document.documentElement.style.cursor = ''; }
    };
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
    // A new layout moves every letter's place, so put the text back and measure again.
    addEventListener('resize', () => {
      if (!segs) return;
      grabs.clear(); held.clear(); rewinding = false;
      while (pinned < n) pinOne();
      relayout();
    });
    if (!grabZone) new ResizeObserver(relayout).observe(document.body);
  }

  function step(dt, now) {
    const { W, H } = view;
    for (let i = pinned; i < n; i++) {
      if (held.has(i)) continue;
      const p = pts[i];
      const vx = (p.x - p.px) * 0.995, vy = (p.y - p.py) * 0.995;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy + GRAVITY * dt * dt;
    }
    for (const g of grabs.values()) {
      const p = pts[g.i];
      p.px = p.x; p.py = p.y; p.x = g.x; p.y = g.y;
    }

    if (pinned > 0 && !rewinding) {
      if (grabs.size) {
        // Pulling the string taut draws more letters out of the text.
        for (let k = 0; k < 4 && pinned > 0; k++) {
          const a = homeV(pinned - 1);
          let taut = false;
          for (const g of grabs.values()) {
            if (g.i < pinned) continue;
            let len = 0;
            for (let j = pinned; j <= g.i; j++) len += rest[j] || 2;
            if (Math.hypot(g.x - a.x, g.y - a.y) > len * 0.97) taut = true;
          }
          if (!taut || !unpinOne()) break;
        }
      } else if (n - pinned >= POUR_AFTER) {
        // A long hanging string is heavy enough to keep pulling itself out.
        const a = homeV(pinned - 1), p = pts[pinned];
        if (p.y > a.y && Math.hypot(p.x - a.x, p.y - a.y) > (rest[pinned] || 2) * 1.04 && unpinOne()) {
          rewindAt = Math.max(rewindAt, now + 4000);
        }
      }
    }

    // Reeling in: the letter next to the text heads home, dragging the rest of the string after it.
    // The longer the string, the faster it reels, so a whole paragraph comes back in a few seconds.
    let reel = -1;
    if (rewinding) {
      let budget = (1100 + (n - pinned) * 40) * dt;
      while (budget > 0 && pinned < n) {
        const p = pts[pinned], h = homeV(pinned);
        const dx = h.x - p.x, dy = h.y - p.y, d = Math.hypot(dx, dy);
        p.px = p.x; p.py = p.y;
        if (d <= Math.max(budget, 1.5)) { budget -= d; pinOne(); continue; }
        p.x += (dx / d) * budget; p.y += (dy / d) * budget;
        reel = pinned; budget = 0;
      }
      if (pinned === n) rewinding = false;
    }

    const fixed = (i) => i < pinned || i === reel || held.has(i);
    const anchor = pinned > 0 ? homeV(pinned - 1) : null;
    for (let it = 0; it < ITERATIONS; it++) {
      for (let i = Math.max(1, pinned); i < n; i++) {
        const a = i - 1 < pinned ? anchor : pts[i - 1], b = pts[i];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - (rest[i] || 2)) / d;
        const fa = fixed(i - 1), fb = fixed(i);
        if (fa && fb) continue;
        const wa = fa ? 0 : fb ? 1 : 0.5, wb = fb ? 0 : fa ? 1 : 0.5;
        if (!fa) { a.x += dx * diff * wa; a.y += dy * diff * wa; }
        if (!fb) { b.x -= dx * diff * wb; b.y -= dy * diff * wb; }
      }
      if (it % 4 === 0) collide(fixed);
      for (let i = pinned; i < n; i++) {
        if (fixed(i)) continue;
        const p = pts[i], r = style[i].r;
        if (p.y > H - r) { p.y = H - r; p.px += (p.x - p.px) * 0.35; }
        if (p.x < r) p.x = r;
        if (p.x > W - r) p.x = W - r;
      }
    }
  }

  // Letters bump into each other so they heap up instead of passing through. A grid keeps it quick
  // with hundreds of letters out.
  function collide(fixed) {
    let cell = 8;
    for (let i = pinned; i < n; i++) cell = Math.max(cell, style[i].r * 2);
    const grid = new Map();
    for (let i = pinned; i < n; i++) {
      if (isSpace(chars[i].c)) continue;
      const key = `${Math.floor(pts[i].x / cell)},${Math.floor(pts[i].y / cell)}`;
      (grid.get(key) || grid.set(key, []).get(key)).push(i);
    }
    for (let i = pinned; i < n; i++) {
      if (isSpace(chars[i].c)) continue;
      const a = pts[i], cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const list = grid.get(`${gx},${gy}`);
        if (!list) continue;
        for (const j of list) {
          if (j <= i + 1) continue;
          const b = pts[j], min = style[i].r + style[j].r;
          const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2), push = (min - d) / d / 2;
          if (!fixed(i)) { a.x -= dx * push; a.y -= dy * push; }
          if (!fixed(j)) { b.x += dx * push; b.y += dy * push; }
        }
      }
    }
  }

  function draw() {
    const { ctx, dpr, W, H } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (pinned === n) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let font = '', color = '';
    for (let i = pinned; i < n; i++) {
      const c = chars[i].c;
      if (isSpace(c)) continue;
      const p = pts[i];
      if (p.y < -40 || p.y > H + 40) continue;
      const a = i === 0 ? p : i > pinned ? pts[i - 1] : homeV(i - 1);
      const b = i < n - 1 ? pts[i + 1] : p;
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (!Number.isFinite(ang)) ang = 0;
      const s = style[i];
      if (s.font !== font) ctx.font = font = s.font;
      if (s.color !== color) ctx.fillStyle = color = s.color;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      ctx.setTransform(dpr * cos, dpr * sin, -dpr * sin, dpr * cos, dpr * p.x, dpr * p.y);
      ctx.fillText(c, 0, 0);
    }
  }

  function frame(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
    last = now;
    if (!grabs.size && pinned < n && !rewinding && now > rewindAt) rewinding = true;
    for (let s = 0; s < SUBSTEPS; s++) step(dt / SUBSTEPS, now);
    draw();
    if (pinned === n && !grabs.size) { running = false; holdPage(false); placeHandle(); return; }
    requestAnimationFrame(frame);
  }
  function start() {
    if (running) return;
    running = true; last = performance.now();
    requestAnimationFrame(frame);
  }

  return {
    arm,
    placeHandle,
    // Let the last few letters slip and swing back, so it is clear the text comes loose.
    hint(count = 4) {
      if (!build() || grabs.size || pinned < n) return;
      for (let k = 0; k < count; k++) unpinOne();
      for (let i = pinned; i < n; i++) { pts[i].px -= 2.2 * (i - pinned + 1); pts[i].py -= 1.5; }
      rewindAt = performance.now() + 700;
      start();
    }
  };
}

const once = (key) => {
  try {
    if (sessionStorage.getItem(key) === '1') return false;
    sessionStorage.setItem(key, '1');
  } catch {}
  return true;
};

// The home tagline: touching anywhere on it takes hold of its end.
export function pullableTagline(typed) {
  const tagline = typed.closest('.hero-tagline');
  const string = makePullable({
    nodes: () => [...typed.childNodes].filter((t) => t.nodeType === Node.TEXT_NODE),
    grabZone: () => tagline.getBoundingClientRect()
  });
  if (!string) return;
  const ready = () => {
    string.arm();
    if (once('clifcode-string-hint')) setTimeout(() => string.hint(), 900);
  };
  if (typed.dataset.typed === 'done') ready();
  else typed.addEventListener('typed', ready, { once: true });
}

// An article: the string runs through its own text and ends at the last sentence, so it can only be
// pulled once you have read to the bottom. References, figures and links below are left alone.
export function pullableArticle(article) {
  const blocks = [...article.querySelectorAll(':scope > p, :scope > h2, :scope > .book-quote > p, :scope > ul > li, :scope > ol > li')];
  const lastBlock = blocks.filter((b) => b.matches('p')).at(-1);
  if (!lastBlock) return;
  const nodes = () => blocks.flatMap((block) => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => (t.parentElement.closest('button, script, style, sup, .visually-hidden') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const out = [];
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  });
  const string = makePullable({ nodes, maxLoose: innerWidth < 700 ? 700 : 1600 });
  if (!string) return;
  string.arm();
  const seen = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    seen.disconnect();
    string.placeHandle();
    if (once('clifcode-string-hint-article')) setTimeout(() => string.hint(5), 700);
  }, { threshold: 1, rootMargin: '0px 0px -12% 0px' });
  seen.observe(lastBlock);
}
