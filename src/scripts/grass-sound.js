// Sound and touch feedback for Touch grass, all made live with the Web Audio API:
// grass that rustles as fast as you move through it, wind with birds by day and
// crickets at night, and little chimes for finds. Phones also get a light tap.

const STORE_KEY = 'clifcode-grass-sound';

export function createFeedback() {
  let enabled = true;
  try { enabled = localStorage.getItem(STORE_KEY) !== 'off'; } catch {}

  let ctx = null;
  let master, noise, rustleGain, rustleBand, windGain, birdTimer, cricketTimer;
  let scene = 'morning';

  const build = () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    // Mix politely with the visitor's own music, and stay quiet on a silenced iPhone.
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch {}
    ctx = new AudioContext();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    master = ctx.createGain();
    master.gain.value = enabled ? 0.9 : 0;
    master.connect(limiter).connect(ctx.destination);

    // two seconds of white noise, looped, feeds the grass and the wind
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise = buffer;
    const loop = () => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(); return s; };

    // grass: bright, papery noise whose loudness and pitch follow your hand
    const high = ctx.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 1400;
    rustleBand = ctx.createBiquadFilter(); rustleBand.type = 'bandpass'; rustleBand.frequency.value = 3800; rustleBand.Q.value = 0.8;
    rustleGain = ctx.createGain(); rustleGain.gain.value = 0;
    loop().connect(high).connect(rustleBand).connect(rustleGain).connect(master);

    // wind: low, slowly breathing noise
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 420;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    const breathe = ctx.createOscillator(); breathe.frequency.value = 0.09;
    const breatheDepth = ctx.createGain(); breatheDepth.gain.value = 0.018;
    breathe.connect(breatheDepth).connect(windGain.gain);
    breathe.start();
    loop().connect(low).connect(windGain).connect(master);

    setScene(scene);
    return true;
  };

  // ---- small synth helpers
  const tone = (freq, at, { type = 'sine', gain = 0.08, decay = 0.5, attack = 0.006, pan = 0, slideTo } = {}) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + attack + decay * 0.5);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = pan; osc.connect(env).connect(panner).connect(master); } else osc.connect(env).connect(master);
    osc.start(at);
    osc.stop(at + attack + decay + 0.05);
  };
  const burst = (at, { freq = 1800, q = 0.8, gain = 0.3, decay = 0.4, type = 'bandpass' } = {}) => {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    src.connect(filter).connect(env).connect(master);
    src.start(at, Math.random());
    src.stop(at + decay + 0.05);
  };
  const bell = (notes, gap = 0.07, gain = 0.07) => {
    const now = ctx.currentTime;
    notes.forEach((f, i) => {
      tone(f, now + i * gap, { type: 'triangle', gain, decay: 0.9 });
      tone(f * 2, now + i * gap, { gain: gain * 0.35, decay: 0.5 });
    });
  };

  // ---- birds by day, crickets by night
  const chirp = () => {
    if (!ctx || scene === 'night') return;
    const now = ctx.currentTime + 0.05, pan = Math.random() * 1.4 - 0.7;
    const base = 2600 + Math.random() * 1600;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      tone(base * (1 + Math.random() * 0.15), now + i * 0.11, { gain: 0.035, decay: 0.07, attack: 0.004, pan, slideTo: base * 1.45 });
    }
  };
  const crickets = () => {
    if (!ctx || scene !== 'night') return;
    const now = ctx.currentTime + 0.05;
    for (const [freq, pan, offset] of [[4600, -0.5, 0], [4900, 0.6, 0.31], [4300, 0.1, 0.57]]) {
      if (Math.random() < 0.3) continue;
      for (let p = 0; p < 3; p++) tone(freq, now + offset + p * 0.045, { gain: 0.012, decay: 0.03, attack: 0.003, pan });
    }
  };

  const setScene = (name) => {
    scene = name;
    if (!ctx) return;
    windGain.gain.setTargetAtTime(name === 'night' ? 0.025 : 0.035, ctx.currentTime, 1.2);
    clearInterval(birdTimer); clearInterval(cricketTimer);
    if (name === 'night') cricketTimer = setInterval(crickets, 850);
    else birdTimer = setInterval(() => { if (Math.random() < 0.45) chirp(); }, 2600);
  };

  // ---- haptics: vibration where the browser allows it; on iPhone, Safari's
  // switch control gives a light tap when it toggles.
  const canVibrate = typeof navigator.vibrate === 'function';
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const iosTap = () => {
    try {
      const label = document.createElement('label');
      label.ariaHidden = 'true';
      label.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      label.append(input);
      document.head.append(label);
      label.click();
      label.remove();
    } catch {}
  };
  const buzz = (pattern) => {
    if (!enabled) return;
    if (canVibrate) { try { navigator.vibrate(pattern); } catch {} return; }
    if (!isIOS) return;
    const taps = Array.isArray(pattern) ? Math.ceil(pattern.length / 2) : 1;
    for (let i = 0; i < taps; i++) setTimeout(iosTap, i * 90);
  };

  // ---- what the page calls
  let lastBuzz = 0;
  return {
    get enabled() { return enabled; },
    // Audio can only start after the visitor touches the page.
    unlock() {
      if (!enabled) return;
      if (!ctx && !build()) return;
      if (ctx.state === 'suspended') ctx.resume();
    },
    setEnabled(on) {
      enabled = on;
      try { localStorage.setItem(STORE_KEY, on ? 'on' : 'off'); } catch {}
      if (on) this.unlock();
      if (ctx) master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.08);
    },
    setScene,
    // speed is how fast the hand moves across the screen, in pixels per millisecond
    rustle(speed) {
      const amount = Math.min(1, speed / 1.6);
      if (ctx && enabled) {
        const now = ctx.currentTime;
        const level = 0.12 + amount * 1.1 * (0.8 + Math.random() * 0.4);
        rustleGain.gain.cancelScheduledValues(now);
        rustleGain.gain.setTargetAtTime(level, now, 0.03);
        rustleGain.gain.setTargetAtTime(0, now + 0.09, 0.14);
        rustleBand.frequency.setTargetAtTime(2800 + amount * 2600 + Math.random() * 500, now, 0.05);
      }
      // a soft tick now and then as blades brush past
      const t = performance.now();
      if (amount > 0.15 && t - lastBuzz > 140) { lastBuzz = t; buzz(6); }
    },
    event(kind) {
      const sound = ctx && enabled;
      const now = ctx?.currentTime ?? 0;
      if (kind === 'clover') {
        if (sound) bell([1046.5, 1318.5, 1568, 2093, 2637], 0.075, 0.08);
        buzz([20, 50, 20, 50, 40]);
      } else if (kind === 'flower') {
        if (sound) { tone(880, now, { type: 'triangle', gain: 0.06, decay: 0.25 }); tone(1320, now + 0.05, { gain: 0.04, decay: 0.2 }); }
        buzz(10);
      } else if (kind === 'butterfly') {
        if (sound) for (let i = 0; i < 6; i++) tone(i % 2 ? 2349 : 2093, now + i * 0.035, { gain: 0.03, decay: 0.06 });
        buzz([8, 40, 8]);
      } else if (kind === 'shake') {
        if (sound) { burst(now, { freq: 1600, q: 0.6, gain: 0.35, decay: 0.55 }); burst(now + 0.08, { freq: 600, type: 'lowpass', gain: 0.25, decay: 0.45 }); }
        buzz(25);
      } else if (kind === 'level') {
        if (sound) bell([784, 988, 1175, 1568], 0.09, 0.08);
        buzz([15, 40, 15, 40, 30]);
      } else if (kind === 'badge') {
        if (sound) bell([1318.5, 1568], 0.1, 0.06);
        buzz([12, 40, 12]);
      }
    }
  };
}
