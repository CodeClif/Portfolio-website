// A hill of grass you can run your hand through, at morning, golden hour or night.
// Grass is one instanced mesh whose blades sway in a vertex shader and bend away
// from where the pointer has recently been, so the field parts and slowly recovers.
import * as THREE from 'three';

const TRAIL = 14; // recent touch points the grass remembers
const TOUCH_RADIUS = 1.8;
const RECOVER_SECONDS = 2.8;

const MODES = {
  morning: {
    skyTop: '#5f97d6', skyHorizon: '#d9e7ef', sunColor: '#fff6e0', sunDir: [0.24, 0.36, -1], sunSize: 0.99965,
    light: '#fff3dc', lightIntensity: 2.2, hemiSky: '#bcd6ef', hemiGround: '#3d5a22', hemiIntensity: 1.1,
    grassBase: '#0f3209', grassTip: '#7cb43a', ground: '#18350e', fog: '#c9dbe3', fogDensity: 0.012,
    tree: '#55732f', clouds: 0.9, stars: 0, night: 0, exposure: 1.0
  },
  golden: {
    skyTop: '#c98f8a', skyHorizon: '#f6c79a', sunColor: '#fff0d0', sunDir: [0.16, 0.13, -1], sunSize: 0.9996,
    light: '#ffc58a', lightIntensity: 2.4, hemiSky: '#f3c3a0', hemiGround: '#4a4a1c', hemiIntensity: 0.95,
    grassBase: '#163209', grassTip: '#76983a', ground: '#243510', fog: '#e9b993', fogDensity: 0.014,
    tree: '#5b6430', clouds: 0.55, stars: 0, night: 0, exposure: 1.0
  },
  night: {
    skyTop: '#0d1238', skyHorizon: '#3a3a78', sunColor: '#f4f2ff', sunDir: [-0.2, 0.32, -1], sunSize: 0.99965,
    light: '#8fa6ff', lightIntensity: 0.9, hemiSky: '#3a4a9a', hemiGround: '#0b1a1a', hemiIntensity: 0.75,
    grassBase: '#020d0d', grassTip: '#0f4c40', ground: '#05161a', fog: '#25295c', fogDensity: 0.016,
    tree: '#1d3d36', clouds: 0.08, stars: 1, night: 1, exposure: 1.0
  }
};

export function startTouchGrass({ canvas, onReady, onTouch }) {
  const isSmall = Math.min(innerWidth, innerHeight) < 700;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !isSmall, powerPreference: 'high-performance' });
  } catch {
    return null; // no WebGL 2 on this device
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, isSmall ? 2 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xc9dbe3, 0.012);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  const cameraHome = new THREE.Vector3(0, 1.45, 13);
  const lookTarget = new THREE.Vector3(0, 3.7, -20);

  // ---- terrain: a gentle field rising to a hill with the tree on top
  const HILL = new THREE.Vector2(0, -26);
  const height = (x, z) => {
    const dx = (x - HILL.x) / 24, dz = (z - HILL.y) / 19;
    return 7.2 * Math.exp(-(dx * dx + dz * dz)) + 0.12 * Math.sin(x * 0.21) * Math.cos(z * 0.17);
  };

  // ---- shared, animated state (current values; lerped toward the target mode)
  const state = {};
  const color = (hex) => new THREE.Color(hex);
  const loadMode = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) =>
    [k, typeof v === 'string' ? color(v) : Array.isArray(v) ? new THREE.Vector3(...v).normalize() : v]));
  const modes = Object.fromEntries(Object.entries(MODES).map(([k, m]) => [k, loadMode(m)]));
  Object.assign(state, loadMode(MODES.morning));

  // ---- lights for the tree and ground
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  scene.add(hemi, sun);

  // ---- sky
  const skyUniforms = {
    uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
    uSunSize: { value: 0.999 }, uClouds: { value: 0 }, uStars: { value: 0 }, uNight: { value: 0 }, uTime: { value: 0 }
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: skyUniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uHorizon, uSunDir, uSunColor;
        uniform float uSunSize, uClouds, uStars, uNight, uTime;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
          float s = dot(d, uSunDir);
          col += uSunColor * (pow(max(s, 0.0), 24.0) * 0.3 + pow(max(s, 0.0), 600.0) * 0.5) * (1.0 - 0.6 * uNight);
          // soft clouds in a band above the horizon
          vec2 cp = d.xz / max(d.y, 0.06) * 0.9 + vec2(uTime * 0.004, 0.0);
          float c = smoothstep(0.52, 0.85, fbm(cp)) * smoothstep(0.02, 0.18, d.y) * uClouds;
          col = mix(col, mix(vec3(1.0), uSunColor, 0.35) * (1.0 - 0.6 * uNight), c * 0.8);
          // stars
          vec2 sp = floor(d.xz / max(d.y, 0.08) * 160.0);
          float star = step(0.9965, hash(sp)) * smoothstep(0.05, 0.3, d.y);
          col += vec3(star) * uStars * (0.6 + 0.4 * sin(uTime * 2.0 + hash(sp) * 30.0));
          // sun or moon disc, with a soft edge
          float disc = smoothstep(uSunSize - 0.00015, uSunSize + 0.00005, s);
          col = mix(col, uSunColor * (1.6 - 0.4 * uNight), disc);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`
    })
  );
  scene.add(sky);

  // ---- ground
  const groundGeo = new THREE.PlaneGeometry(220, 220, 160, 160);
  groundGeo.rotateX(-Math.PI / 2);
  {
    const p = groundGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
    groundGeo.computeVertexNormals();
  }
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x2b4d18 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  scene.add(ground);

  // ---- tree on the hilltop
  const treeMat = new THREE.MeshLambertMaterial({ color: 0x3e5a24 });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3a2b1f });
  const tree = new THREE.Group();
  {
    const base = new THREE.Vector3(HILL.x + 0.8, height(HILL.x + 0.8, HILL.y), HILL.y);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 4.2, 9), trunkMat);
    trunk.position.set(base.x, base.y + 2.0, base.z);
    tree.add(trunk);
    const rand = mulberry32(7);
    // a broad crown made of lumpy blobs
    const blobs = [[0, 5.4, 0, 2.6], [-2.1, 5.0, 0.3, 2.0], [2.1, 5.0, -0.2, 2.0], [-1.1, 6.4, 0, 1.9], [1.2, 6.5, 0.2, 1.9],
      [-3.3, 4.6, 0, 1.4], [3.3, 4.7, 0, 1.4], [0, 4.4, 1.1, 1.8], [0, 6.9, -0.5, 1.5],
      [-2.4, 6.0, 0.8, 1.2], [2.5, 6.0, 0.6, 1.2], [-1.6, 4.2, 1.2, 1.3], [1.7, 4.3, 1.1, 1.3]];
    for (const [x, y, z, r] of blobs) {
      const g = new THREE.IcosahedronGeometry(r, 3);
      const pos = g.attributes.position;
      const k = 2.4 / r, phase = rand() * 10;
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        const lump = Math.sin(v.x * k + phase) * Math.sin(v.y * k * 1.3) * Math.sin(v.z * k + phase * 0.5);
        v.multiplyScalar(1 + 0.13 * lump);
        pos.setXYZ(i, v.x, v.y * 0.84, v.z);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, treeMat);
      m.position.set(base.x + x, base.y + y, base.z + z);
      tree.add(m);
    }
  }
  scene.add(tree);

  // ---- grass: one blade shape, drawn tens of thousands of times
  const BLADES = isSmall ? 42000 : 90000;
  const SEGMENTS = 5;
  const blade = new THREE.InstancedBufferGeometry();
  {
    const verts = [], idx = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const w = 0.5 * (1 - t * t * 0.92);
      verts.push(-w, t, 0, w, t, 0);
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    blade.setIndex(idx);
  }
  const offsets = new Float32Array(BLADES * 3);
  const shape = new Float32Array(BLADES * 4); // angle, height, width, tint
  {
    const rand = mulberry32(42);
    const halfFov = 0.75;
    for (let i = 0; i < BLADES; i++) {
      // place blades in a wedge in front of the camera, denser close up
      const r = rand();
      const d = 1.7 + 69 * r * r;
      const a = (rand() * 2 - 1) * (halfFov + 0.25);
      const x = cameraHome.x + Math.sin(a) * d * 1.15;
      const z = cameraHome.z - Math.cos(a) * d;
      offsets.set([x, height(x, z), z], i * 3);
      const near = Math.max(0, 1 - d / 18);
      shape.set([rand() * Math.PI * 2, 0.45 + rand() * 0.45 + near * 0.3, 0.05 + rand() * 0.04, rand()], i * 4);
    }
  }
  blade.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
  blade.setAttribute('shape', new THREE.InstancedBufferAttribute(shape, 4));
  blade.instanceCount = BLADES;

  const touchPoints = Array.from({ length: TRAIL }, () => new THREE.Vector4(0, -999, 0, 0));
  const grassUniforms = {
    uTime: { value: 0 }, uWind: { value: reduceMotion ? 0.4 : 1 },
    uTouch: { value: touchPoints }, uRadius: { value: TOUCH_RADIUS },
    uBase: { value: new THREE.Color() }, uTip: { value: new THREE.Color() },
    uLight: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() },
    uFog: { value: new THREE.Color() }, uFogDensity: { value: 0.012 }, uNight: { value: 0 }
  };
  const grass = new THREE.Mesh(blade, new THREE.ShaderMaterial({
    side: THREE.DoubleSide, uniforms: grassUniforms,
    vertexShader: /* glsl */`
      attribute vec3 offset;
      attribute vec4 shape;
      uniform float uTime, uWind, uRadius;
      uniform vec4 uTouch[${TRAIL}];
      varying float vH, vTint, vTouched, vDist, vFacing, vBack;
      uniform vec3 uSunDir;
      void main() {
        float h = position.y;
        float c = cos(shape.x), s = sin(shape.x);
        vec3 local = vec3(position.x * shape.z * c, h * shape.y, position.x * shape.z * s);
        vec3 world = offset + local;

        // wind: slow gusts rolling across the field plus a quick flutter
        float gust = sin(uTime * 0.9 - offset.x * 0.08 - offset.z * 0.11) * 0.5 + 0.5;
        float flutter = sin(uTime * 3.1 + offset.x * 1.7 + offset.z * 1.3 + shape.w * 6.0);
        float r2 = fract(shape.w * 7.31);
        vec2 lean = vec2(cos(shape.x * 1.7), sin(shape.x * 1.7)) * (0.08 + 0.22 * r2);
        vec2 bend = lean + vec2(0.06 + 0.2 * gust + 0.05 * flutter, 0.06 * flutter) * uWind;

        // the hand: push blades away from recent touch points, fading as they recover
        vec2 push = vec2(0.0);
        float touched = 0.0;
        for (int i = 0; i < ${TRAIL}; i++) {
          vec2 dv = offset.xz - uTouch[i].xz;
          float dist = length(dv);
          float f = (1.0 - smoothstep(0.0, uRadius, dist)) * uTouch[i].w;
          push += (dv / max(dist, 0.001)) * f * 2.6;
          touched = max(touched, f);
        }
        vec2 total = bend + push;
        float k = h * h;
        float len = length(total);
        world.xz += total * k * shape.y;
        world.y -= min(len, 1.6) * k * shape.y * 0.42;

        vH = h;
        vTint = shape.w;
        vTouched = touched;
        vFacing = abs(dot(normalize(vec2(-s, c)), normalize(uSunDir.xz)));
        vBack = pow(max(dot(normalize(world - cameraPosition), uSunDir), 0.0), 3.0);
        vec4 mv = viewMatrix * vec4(world, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uBase, uTip, uLight, uFog;
      uniform float uFogDensity, uNight, uTime;
      varying float vH, vTint, vTouched, vDist, vFacing, vBack;
      void main() {
        vec3 tip = mix(uTip, uTip * vec3(1.18, 1.08, 0.7), fract(vTint * 13.7)); // some blades drier than others
        vec3 col = mix(uBase, tip, smoothstep(0.0, 1.0, vH));
        col *= 0.72 + 0.5 * vTint;
        col *= mix(0.25, 1.0, smoothstep(0.0, 0.75, vH));          // shadowed near the roots
        col += uLight * (0.08 * vFacing + 0.35 * vBack * (1.0 - 0.8 * uNight)) * vH * vH;  // light catching and shining through the blades
        col *= 1.0 - 0.35 * vTouched * (1.0 - uNight);              // pressed grass sits in its own shade
        col += vec3(0.55, 0.95, 0.85) * vTouched * vH * uNight * 0.6; // a glow where you touch at night
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
        gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
        #include <colorspace_fragment>
      }`
  }));
  grass.frustumCulled = false;
  scene.add(grass);

  // ---- wildflowers and fireflies as soft points
  const pointMaterial = (extra) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, ...extra
  });
  const FLOWERS = isSmall ? 500 : 900;
  const flowerGeo = new THREE.BufferGeometry();
  {
    const rand = mulberry32(9);
    const pos = new Float32Array(FLOWERS * 3), col = new Float32Array(FLOWERS * 3);
    const palette = [[0.86, 0.22, 0.2], [0.93, 0.36, 0.3], [0.42, 0.45, 0.85], [0.95, 0.78, 0.3], [0.96, 0.95, 0.9]];
    for (let i = 0; i < FLOWERS; i++) {
      const r = rand(); const d = 1.5 + 55 * r * r; const a = (rand() * 2 - 1) * 1.0;
      const x = Math.sin(a) * d * 1.15, z = cameraHome.z - Math.cos(a) * d;
      pos.set([x, height(x, z) + 0.55 + rand() * 0.4, z], i * 3);
      col.set(palette[Math.floor(rand() * palette.length)], i * 3);
    }
    flowerGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    flowerGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const flowerUniforms = { uTime: grassUniforms.uTime, uScale: { value: 1 }, uDim: { value: 1 }, uFog: grassUniforms.uFog, uFogDensity: grassUniforms.uFogDensity };
  const flowers = new THREE.Points(flowerGeo, pointMaterial({
    uniforms: flowerUniforms,
    vertexShader: /* glsl */`
      attribute vec3 color;
      uniform float uTime, uScale;
      varying vec3 vColor; varying float vDist;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 1.2 + p.z * 0.7) * 0.05;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vDist = -mv.z;
        vColor = color;
        gl_PointSize = uScale * 20.0 / vDist;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uFog; uniform float uFogDensity, uDim;
      varying vec3 vColor; varying float vDist;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        if (r > 0.5) discard;
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
        gl_FragColor = vec4(mix(vColor * uDim, uFog, fog), smoothstep(0.5, 0.3, r));
        #include <colorspace_fragment>
      }`
  }));
  scene.add(flowers);

  const FIREFLIES = isSmall ? 60 : 110;
  const flyGeo = new THREE.BufferGeometry();
  {
    const rand = mulberry32(3);
    const pos = new Float32Array(FIREFLIES * 3), seed = new Float32Array(FIREFLIES);
    for (let i = 0; i < FIREFLIES; i++) {
      const d = 3 + rand() * 30, a = (rand() * 2 - 1) * 0.9;
      const x = Math.sin(a) * d * 1.2, z = cameraHome.z - Math.cos(a) * d;
      pos.set([x, height(x, z) + 0.6 + rand() * 2.2, z], i * 3);
      seed[i] = rand() * 100;
    }
    flyGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    flyGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  }
  const flyUniforms = { uTime: grassUniforms.uTime, uNight: grassUniforms.uNight, uScale: flowerUniforms.uScale };
  const fireflies = new THREE.Points(flyGeo, pointMaterial({
    blending: THREE.AdditiveBlending, uniforms: flyUniforms,
    vertexShader: /* glsl */`
      attribute float seed;
      uniform float uTime, uScale;
      varying float vBlink;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.31 + seed) * 1.1;
        p.y += sin(uTime * 0.53 + seed * 1.7) * 0.45;
        p.z += cos(uTime * 0.27 + seed * 0.6) * 1.1;
        vBlink = smoothstep(0.1, 0.9, sin(uTime * 1.4 + seed * 3.1) * 0.5 + 0.5);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * 60.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uNight;
      varying float vBlink;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float glow = smoothstep(0.5, 0.0, r);
        gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * glow * glow * vBlink * uNight, 1.0);
      }`
  }));
  scene.add(fireflies);

  // sparkles that rise from the grass where you touch it at night
  const SPARKS = 220;
  const sparkPos = new Float32Array(SPARKS * 3).fill(-999);
  const sparkLife = new Float32Array(SPARKS);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('life', new THREE.BufferAttribute(sparkLife, 1));
  const sparks = new THREE.Points(sparkGeo, pointMaterial({
    blending: THREE.AdditiveBlending, uniforms: { uNight: grassUniforms.uNight, uScale: flowerUniforms.uScale },
    vertexShader: /* glsl */`
      attribute float life;
      uniform float uScale;
      varying float vLife;
      void main() {
        vLife = life;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uScale * 22.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uNight;
      varying float vLife;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(0.8, 1.0, 0.95) * smoothstep(0.5, 0.0, r) * vLife * uNight, 1.0);
      }`
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let nextSpark = 0;
  const spawnSparks = (point, n) => {
    for (let k = 0; k < n; k++) {
      const i = nextSpark; nextSpark = (nextSpark + 1) % SPARKS;
      sparkPos.set([point.x + (Math.random() - 0.5) * 1.4, point.y + 0.2 + Math.random() * 0.5, point.z + (Math.random() - 0.5) * 1.4], i * 3);
      sparkVel.set([(Math.random() - 0.5) * 0.3, 0.35 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3], i * 3);
      sparkLife[i] = 1;
    }
  };

  // ---- touching the grass
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(0, 0);
  const pointerScreen = new THREE.Vector2(0, 0);
  let pointerOver = false;
  let lastTrail = new THREE.Vector3(0, -999, 0);
  let trailIndex = 0;
  const trailBorn = new Float32Array(TRAIL).fill(-999);
  const hand = new THREE.Vector4(0, -999, 0, 0);

  // Where the pointer meets the top of the grass, not the ground hidden beneath it,
  // so the blades that part are the ones under your finger.
  const CANOPY = 0.6;
  const grassUnder = (ray) => {
    const p = new THREE.Vector3();
    for (let t = 0.5; t < 140; t += 0.05 + t * 0.01) {
      ray.at(t, p);
      if (p.y - height(p.x, p.z) < CANOPY) return p;
    }
    return null;
  };

  const updatePointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    pointerScreen.copy(pointer);
    pointerOver = true;
    raycaster.setFromCamera(pointer, camera);
    const point = grassUnder(raycaster.ray);
    if (!point) { hand.w = 0; return; }
    hand.set(point.x, point.y, point.z, 1);
    if (point.distanceTo(lastTrail) > 0.45) {
      lastTrail.copy(point);
      touchPoints[trailIndex].set(point.x, point.y, point.z, 1);
      trailBorn[trailIndex] = timer.getElapsed();
      trailIndex = (trailIndex + 1) % TRAIL;
      spawnSparks(point, 3);
      onTouch?.();
    }
  };
  canvas.addEventListener('pointermove', updatePointer);
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture?.(e.pointerId); updatePointer(e); });
  canvas.addEventListener('pointerleave', () => { pointerOver = false; hand.w = 0; });
  canvas.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') { pointerOver = false; hand.w = 0; } });

  // ---- time of day
  let from = null, to = 'morning', blendStart = 0;
  const BLEND_SECONDS = 1.6;
  const setMode = (name, instant = false) => {
    if (!modes[name]) return;
    from = instant ? null : snapshot();
    to = name;
    blendStart = timer.getElapsed();
    if (instant) Object.assign(state, cloneMode(modes[name]));
  };
  const snapshot = () => cloneMode(state);
  const cloneMode = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v?.clone ? v.clone() : v]));
  const blendModes = (t) => {
    const target = modes[to];
    for (const key of Object.keys(target)) {
      const a = from[key], b = target[key];
      if (typeof b === 'number') state[key] = a + (b - a) * t;
      else if (b.isColor) state[key].copy(a).lerp(b, t);
      else state[key].copy(a).lerp(b, t).normalize();
    }
  };
  const applyState = () => {
    skyUniforms.uTop.value.copy(state.skyTop);
    skyUniforms.uHorizon.value.copy(state.skyHorizon);
    skyUniforms.uSunDir.value.copy(state.sunDir);
    skyUniforms.uSunColor.value.copy(state.sunColor);
    skyUniforms.uSunSize.value = state.sunSize;
    skyUniforms.uClouds.value = state.clouds;
    skyUniforms.uStars.value = state.stars;
    skyUniforms.uNight.value = state.night;
    grassUniforms.uBase.value.copy(state.grassBase);
    grassUniforms.uTip.value.copy(state.grassTip);
    grassUniforms.uLight.value.copy(state.light);
    grassUniforms.uSunDir.value.copy(state.sunDir);
    grassUniforms.uFog.value.copy(state.fog);
    grassUniforms.uFogDensity.value = state.fogDensity;
    grassUniforms.uNight.value = state.night;
    flowerUniforms.uDim.value = 1 - 0.65 * state.night;
    hemi.color.copy(state.hemiSky); hemi.groundColor.copy(state.hemiGround); hemi.intensity = state.hemiIntensity;
    sun.color.copy(state.light); sun.intensity = state.lightIntensity;
    sun.position.copy(state.sunDir).multiplyScalar(50);
    groundMat.color.copy(state.ground);
    treeMat.color.copy(state.tree);
    scene.fog.color.copy(state.fog);
    scene.fog.density = state.fogDensity;
  };

  // ---- sizing
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the tree in view on tall phone screens
    camera.fov = camera.aspect < 0.8 ? 64 : 50;
    camera.updateProjectionMatrix();
    flowerUniforms.uScale.value = h / 900 * renderer.getPixelRatio();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---- loop
  const timer = new THREE.Timer();
  const sway = new THREE.Vector2();
  let running = true;
  const frame = () => {
    if (!running) return;
    timer.update();
    const t = timer.getElapsed();
    const dt = Math.min(timer.getDelta(), 0.05);
    grassUniforms.uTime.value = t;
    skyUniforms.uTime.value = t;

    if (from) {
      const k = Math.min(1, (t - blendStart) / BLEND_SECONDS);
      blendModes(k * k * (3 - 2 * k));
      if (k >= 1) from = null;
    }
    applyState();

    // trail fades so the grass slowly stands back up
    for (let i = 0; i < TRAIL; i++) {
      const age = t - trailBorn[i];
      touchPoints[i].w = Math.max(0, 1 - age / RECOVER_SECONDS) ** 1.5;
    }
    // the slot under the hand stays fully pressed while it rests there
    if (hand.w > 0 && pointerOver) {
      const slot = (trailIndex + TRAIL - 1) % TRAIL;
      touchPoints[slot].set(hand.x, hand.y, hand.z, 1);
      trailBorn[slot] = t;
    }

    for (let i = 0; i < SPARKS; i++) {
      if (sparkLife[i] <= 0) continue;
      sparkLife[i] = Math.max(0, sparkLife[i] - dt * 0.7);
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.life.needsUpdate = true;

    // a little parallax toward the pointer
    if (!reduceMotion) sway.lerp(pointerOver ? pointerScreen : new THREE.Vector2(), 0.03);
    camera.position.set(cameraHome.x + sway.x * 0.6, cameraHome.y + sway.y * 0.2, cameraHome.z);
    camera.lookAt(lookTarget);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { timer.reset?.(); requestAnimationFrame(frame); }
  });

  setMode('morning', true);
  applyState();
  requestAnimationFrame(() => { frame(); onReady?.(); });

  return { setMode };
}

// Small deterministic random so the field looks the same on every visit.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
