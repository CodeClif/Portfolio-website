// A hill of grass you can run your hand through, at morning, golden hour or night.
// Grass is one instanced mesh whose blades sway in a vertex shader and bend away
// from where the pointer has recently been, so the field parts and slowly recovers.
// The tree is a branching trunk dressed in leaf cards; tap it and it sheds a few.
// Butterflies come to your hand by day, fireflies by night. A four-leaf clover
// hides in the grass; flowers, butterflies and the tree can all be tapped.
// With the cutlass you can clear the grass; it grows back slowly, or fast in the rain.
// Now and then a goat wanders through, grazing, and birds fly over.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TRAIL = 14; // recent touch points the grass remembers
const TOUCH_RADIUS = 1.7;
const RECOVER_SECONDS = 2.8;

const MODES = {
  morning: {
    skyTop: '#4f8fd6', skyHorizon: '#d6e8f2', sunColor: '#fff6e0', sunDir: [0.22, 0.34, -1], sunSize: 0.99968,
    light: '#fff3dc', lightIntensity: 2.4, hemiSky: '#bcd6ef', hemiGround: '#3d5a22', hemiIntensity: 1.15,
    grassBase: '#0b3606', grassTip: '#6cb52c', grassDry: '#b9c845', ground: '#173a0c', fog: '#cfe0e8', fogDensity: 0.011,
    leafLight: '#7fb342', leafDark: '#173a12', bark: '#4a3a2c', ridge: '#7d9cb3', clouds: 0.85, cloudShadow: 0.55,
    stars: 0, night: 0
  },
  golden: {
    skyTop: '#b98f9f', skyHorizon: '#f8c694', sunColor: '#fff2d6', sunDir: [0.21, 0.1, -1], sunSize: 0.99962,
    light: '#ffc88f', lightIntensity: 2.6, hemiSky: '#f3c3a0', hemiGround: '#4a4a1c', hemiIntensity: 1.0,
    grassBase: '#163c08', grassTip: '#7bb032', grassDry: '#c2ad45', ground: '#213a0e', fog: '#efc39d', fogDensity: 0.013,
    leafLight: '#8fa83e', leafDark: '#26351a', bark: '#4a3526', ridge: '#c79a8e', clouds: 0.6, cloudShadow: 0.35,
    stars: 0, night: 0
  },
  night: {
    skyTop: '#0b1036', skyHorizon: '#38397a', sunColor: '#f4f2ff', sunDir: [-0.2, 0.32, -1], sunSize: 0.99966,
    light: '#8fa6ff', lightIntensity: 0.9, hemiSky: '#3a4a9a', hemiGround: '#0b1a1a', hemiIntensity: 0.7,
    grassBase: '#020d0d', grassTip: '#105244', grassDry: '#1c5c4c', ground: '#04141a', fog: '#24285a', fogDensity: 0.016,
    leafLight: '#285a52', leafDark: '#081a1d', bark: '#141a22', ridge: '#1d2150', clouds: 0.08, cloudShadow: 0,
    stars: 1, night: 1
  }
};

// Small GLSL value noise shared by the grass and leaves.
const NOISE_GLSL = /* glsl */`
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }`;

export function startTouchGrass({ canvas, onTouch, onEvent }) {
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
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  const cameraHome = new THREE.Vector3(0, 1.45, 13);
  const lookTarget = new THREE.Vector3(0, 3.7, -20);
  const timer = new THREE.Timer();

  // ---- terrain: a gentle field rising to a hill with the tree on top
  const HILL = new THREE.Vector2(0, -26);
  const height = (x, z) => {
    const dx = (x - HILL.x) / 24, dz = (z - HILL.y) / 19;
    return 7.2 * Math.exp(-(dx * dx + dz * dz)) + 0.12 * Math.sin(x * 0.21) * Math.cos(z * 0.17);
  };

  // ---- shared, animated state (current values; blended toward the chosen time of day)
  const state = {};
  const loadMode = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) =>
    [k, typeof v === 'string' ? new THREE.Color(v) : Array.isArray(v) ? new THREE.Vector3(...v).normalize() : v]));
  const modes = Object.fromEntries(Object.entries(MODES).map(([k, m]) => [k, loadMode(m)]));
  Object.assign(state, loadMode(MODES.morning));

  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  scene.add(hemi, sun);

  // Uniforms several materials share, updated once per frame.
  const shared = {
    uTime: { value: 0 }, uNight: { value: 0 }, uSunDir: { value: new THREE.Vector3() },
    uLight: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uFogDensity: { value: 0.012 },
    uProj: { value: 500 } // pixels per unit at distance 1, for sizing points
  };

  // ---- sky
  const skyUniforms = {
    uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() }, uSunSize: { value: 0.999 }, uClouds: { value: 0 }, uStars: { value: 0 },
    uSunDir: shared.uSunDir, uNight: shared.uNight, uTime: shared.uTime
  };
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
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
        ${NOISE_GLSL}
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
          float s = dot(d, uSunDir);
          col += uSunColor * (pow(max(s, 0.0), 24.0) * 0.3 + pow(max(s, 0.0), 600.0) * 0.5) * (1.0 - 0.6 * uNight);
          // soft clouds, lit from the sun's side
          vec2 cp = d.xz / max(d.y, 0.06) * 0.9 + vec2(uTime * 0.004, 0.0);
          float c = smoothstep(0.5, 0.85, fbm(cp)) * smoothstep(0.02, 0.18, d.y) * uClouds;
          vec3 cloudCol = mix(vec3(1.0), uSunColor, 0.35) * (1.0 - 0.6 * uNight) * (0.88 + 0.2 * max(s, 0.0));
          col = mix(col, cloudCol, c * 0.85);
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
  ));

  // ---- far hills on the horizon, softened by the haze
  const ridgeMat = new THREE.MeshBasicMaterial({ color: 0x7d9cb3 });
  {
    const rand = mulberry32(11);
    for (const [z, peak, spread] of [[-150, 14, 0.035], [-120, 9, 0.05]]) {
      const g = new THREE.PlaneGeometry(520, 30, 140, 1);
      const p = g.attributes.position;
      const phase = rand() * 10;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 0) {
          const x = p.getX(i);
          p.setY(i, peak * (0.45 + 0.35 * Math.sin(x * spread + phase) + 0.2 * Math.sin(x * spread * 2.7 + phase * 2)));
        } else p.setY(i, -12);
      }
      const ridge = new THREE.Mesh(g, ridgeMat);
      ridge.position.z = z;
      scene.add(ridge);
    }
  }

  // ---- ground
  const groundGeo = new THREE.PlaneGeometry(240, 240, 160, 160);
  groundGeo.rotateX(-Math.PI / 2);
  {
    const p = groundGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
    groundGeo.computeVertexNormals();
  }
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x2b4d18 });
  scene.add(new THREE.Mesh(groundGeo, groundMat));

  // ---- the tree: a branching trunk, dressed in leaves
  const treeBase = new THREE.Vector3(HILL.x + 0.8, height(HILL.x + 0.8, HILL.y) - 0.1, HILL.y);
  const crownCenter = treeBase.clone().add(new THREE.Vector3(0, 5.9, 0));
  const crownSphere = new THREE.Sphere(crownCenter, 4.2);
  const barkMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2c });
  const leafSpots = [];
  {
    const rand = mulberry32(7);
    const limbs = [];
    const up = new THREE.Vector3(0, 1, 0);
    const limb = (from, to, r0, r1) => {
      const dir = to.clone().sub(from);
      const g = new THREE.CylinderGeometry(r1, r0, dir.length(), 7, 1, true);
      g.translate(0, dir.length() / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize()));
      g.translate(from.x, from.y, from.z);
      limbs.push(g);
    };
    const grow = (start, dir, length, radius, depth) => {
      // a slight bend partway along each branch
      const mid = start.clone().addScaledVector(dir, length * 0.5)
        .add(new THREE.Vector3(rand() - 0.5, rand() * 0.3, rand() - 0.5).multiplyScalar(length * 0.15));
      const end = mid.clone().addScaledVector(dir, length * 0.5);
      limb(start, mid, radius, radius * 0.85);
      limb(mid, end, radius * 0.85, radius * 0.68);
      if (depth === 0) { leafSpots.push([end, 1]); return; }
      if (depth === 1) leafSpots.push([mid, 0.75]);
      const count = depth >= 2 ? 3 : 2 + (rand() < 0.5 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const spin = (i / count) * Math.PI * 2 + rand() * 0.9;
        const tilt = 0.35 + rand() * 0.4;
        const side = new THREE.Vector3(Math.cos(spin), 0, Math.sin(spin));
        const next = dir.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.sin(tilt));
        next.y = Math.max(next.y, 0.12); // reach out and up, never droop down
        grow(end, next.normalize(), length * (0.68 + rand() * 0.12), radius * 0.62, depth - 1);
      }
    };
    const trunkTop = treeBase.clone().add(new THREE.Vector3(0.05, 3.1, 0));
    limb(treeBase.clone().add(new THREE.Vector3(0, -0.4, 0)), trunkTop, 0.5, 0.36);
    // three main limbs spread wide for a broad, rounded crown
    for (const [x, y, z] of [[-0.62, 1, 0.1], [0.05, 1, -0.1], [0.62, 1, 0.05], [0, 1, 0.6], [0.05, 1, -0.55]]) {
      grow(trunkTop, new THREE.Vector3(x, y, z).normalize(), 1.85, 0.26, 3);
    }
    scene.add(new THREE.Mesh(mergeGeometries(limbs), barkMat));
  }

  // leaves: camera-facing cards, each drawn as a little cluster of leaf shapes
  const LEAVES_PER_SPOT = isSmall ? 30 : 44;
  const leafGeo = new THREE.InstancedBufferGeometry();
  leafGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  leafGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  leafGeo.setIndex([0, 1, 2, 0, 2, 3]);
  {
    const rand = mulberry32(5);
    const n = leafSpots.length * LEAVES_PER_SPOT;
    const pos = new Float32Array(n * 3), data = new Float32Array(n * 4);
    let k = 0;
    for (const [spot, weight] of leafSpots) {
      for (let i = 0; i < LEAVES_PER_SPOT; i++, k++) {
        // a fluffy ball of leaves around each branch tip
        const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
        if (v.lengthSq() > 1) { i--; k--; continue; }
        v.multiplyScalar(1.3 * weight).multiply(new THREE.Vector3(1, 0.8, 1));
        pos.set([spot.x + v.x, spot.y + v.y + 0.15, spot.z + v.z], k * 3);
        data.set([0.55 + rand() * 0.4, rand() * Math.PI * 2, rand(), rand() * 6.28], k * 4);
      }
    }
    leafGeo.setAttribute('leaf', new THREE.InstancedBufferAttribute(pos, 3));
    leafGeo.setAttribute('leafData', new THREE.InstancedBufferAttribute(data, 4));
    leafGeo.instanceCount = n;
  }
  const leafUniforms = {
    ...shared, uCrown: { value: crownCenter }, uCrownR: { value: 3.6 }, uShake: { value: 0 },
    uLeafLight: { value: new THREE.Color() }, uLeafDark: { value: new THREE.Color() }
  };
  const leaves = new THREE.Mesh(leafGeo, new THREE.ShaderMaterial({
    uniforms: leafUniforms, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec3 leaf;
      attribute vec4 leafData; // size, rotation, tint, phase
      uniform float uTime, uShake, uCrownR;
      uniform vec3 uCrown, uSunDir;
      varying vec2 vUv;
      varying float vShade, vTint, vRim, vDist;
      void main() {
        vec3 center = leaf;
        center.x += sin(uTime * 1.3 + leafData.w + leaf.y) * 0.04 + sin(uTime * 31.0 + leafData.w) * 0.09 * uShake;
        center.y += sin(uTime * 27.0 + leafData.w * 2.0) * 0.06 * uShake;
        vec4 mv = viewMatrix * vec4(center, 1.0);
        float c = cos(leafData.y), s = sin(leafData.y);
        mv.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * leafData.x;
        // light the crown as one rounded shape: bright toward the sun, darker inside and underneath
        vec3 n = normalize(leaf - uCrown);
        float depth = clamp(length((leaf - uCrown) * vec3(1.0, 1.25, 1.0)) / uCrownR, 0.0, 1.0);
        vec3 key = normalize(vec3(uSunDir.x * 2.0, 0.9, 0.45));
        float lit = max(dot(n, key), 0.0);
        vShade = (0.2 + 0.8 * lit) * mix(0.4, 1.0, smoothstep(0.3, 0.95, depth));
        vRim = pow(max(dot(normalize(leaf - cameraPosition), uSunDir), 0.0), 4.0) * smoothstep(0.6, 1.0, depth);
        vTint = leafData.z;
        vUv = uv;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uLeafLight, uLeafDark, uLight, uFog;
      uniform float uFogDensity, uNight;
      varying vec2 vUv;
      varying float vShade, vTint, vRim, vDist;
      float leafShape(vec2 p, vec2 at, float angle, float size) {
        p -= at;
        float c = cos(angle), s = sin(angle);
        p = vec2(p.x * c - p.y * s, p.x * s + p.y * c) / size;
        return step(p.x * p.x * 4.0 + p.y * p.y, 0.25 - 0.18 * p.y);
      }
      void main() {
        vec2 p = vUv - 0.5;
        float a = max(leafShape(p, vec2(0.0, 0.1), 0.2, 0.5), max(leafShape(p, vec2(-0.17, -0.1), 1.1, 0.42), leafShape(p, vec2(0.18, -0.08), -1.0, 0.44)));
        if (a < 0.5) discard;
        vec3 col = mix(uLeafDark, uLeafLight, vShade) * (0.82 + 0.36 * vTint);
        col += uLight * vRim * 0.12 * (1.0 - uNight);
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
        gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
        #include <colorspace_fragment>
      }`
  }));
  leaves.frustumCulled = false;
  scene.add(leaves);

  // ---- grass: one blade shape, drawn tens of thousands of times
  const BLADES = isSmall ? 70000 : 140000;
  const SEGMENTS = 4;
  const blade = new THREE.InstancedBufferGeometry();
  const CELL = 2;
  const cells = new Map(); // cell key -> [first blade, last blade + 1]
  let bladeOffsets;
  // per blade: [time it was cut, time it was last watered]; 0 means never
  const lawn = new Float32Array(BLADES * 2);
  const lawnAttr = new THREE.InstancedBufferAttribute(lawn, 2);
  lawnAttr.setUsage(THREE.DynamicDrawUsage);
  {
    const verts = [], idx = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const w = 0.5 * (1 - t * t * 0.95);
      verts.push(-w, t, 0, w, t, 0);
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    blade.setIndex(idx);
  }
  {
    const offsets = new Float32Array(BLADES * 3);
    const shape = new Float32Array(BLADES * 4); // angle, height, width, tint
    const rand = mulberry32(42);
    const start = isSmall ? 2.4 : 2.0;
    for (let i = 0; i < BLADES; i++) {
      // place blades in a wedge in front of the camera, denser close up
      const r = rand();
      const d = start + 70 * r * r;
      const a = (rand() * 2 - 1) * 1.0;
      const x = cameraHome.x + Math.sin(a) * d * 1.15;
      const z = cameraHome.z - Math.cos(a) * d;
      offsets.set([x, height(x, z), z], i * 3);
      const near = Math.max(0, 1 - d / 16);
      // thin, mostly upright blades; a little taller and finer close to the camera
      shape.set([rand() * Math.PI * 2, 0.42 + rand() * 0.42 + near * 0.22, 0.032 + rand() * 0.03 + d * 0.0012, rand()], i * 4);
    }
    // sort blades by 2 m cell, so cutting only visits the blades near the cutlass
    const cellOf = (i) => Math.floor((offsets[i * 3 + 2] + 100) / CELL) * 1000 + Math.floor((offsets[i * 3] + 100) / CELL);
    const order = Array.from({ length: BLADES }, (_, i) => i).sort((a, b) => cellOf(a) - cellOf(b));
    const sortedOffsets = new Float32Array(BLADES * 3), sortedShape = new Float32Array(BLADES * 4);
    order.forEach((from, to) => {
      sortedOffsets.set(offsets.subarray(from * 3, from * 3 + 3), to * 3);
      sortedShape.set(shape.subarray(from * 4, from * 4 + 4), to * 4);
    });
    for (let i = 0; i < BLADES; i++) {
      const key = Math.floor((sortedOffsets[i * 3 + 2] + 100) / CELL) * 1000 + Math.floor((sortedOffsets[i * 3] + 100) / CELL);
      const range = cells.get(key);
      if (range) range[1] = i + 1; else cells.set(key, [i, i + 1]);
    }
    bladeOffsets = sortedOffsets;
    blade.setAttribute('offset', new THREE.InstancedBufferAttribute(sortedOffsets, 3));
    blade.setAttribute('shape', new THREE.InstancedBufferAttribute(sortedShape, 4));
    blade.setAttribute('lawn', lawnAttr);
    blade.instanceCount = BLADES;
  }

  const touchPoints = Array.from({ length: TRAIL + 1 }, () => new THREE.Vector4(0, -999, 0, 0)); // the last one is the goat
  const grassUniforms = {
    ...shared, uWind: { value: reduceMotion ? 0.4 : 1 },
    uTouch: { value: touchPoints }, uRadius: { value: TOUCH_RADIUS },
    uBase: { value: new THREE.Color() }, uTip: { value: new THREE.Color() }, uDry: { value: new THREE.Color() },
    uCloudShadow: { value: 0 }, uRain: { value: 0 }
  };
  const grass = new THREE.Mesh(blade, new THREE.ShaderMaterial({
    side: THREE.DoubleSide, uniforms: grassUniforms,
    vertexShader: /* glsl */`
      attribute vec3 offset;
      attribute vec4 shape;
      attribute vec2 lawn;
      uniform float uTime, uWind, uRadius, uRain;
      uniform vec4 uTouch[${TRAIL + 1}];
      uniform vec3 uSunDir;
      varying float vH, vTint, vTouched, vDist, vFacing, vBack, vPatch, vShadow, vCut, vWet;
      ${NOISE_GLSL}
      void main() {
        float h = position.y;
        // cut grass is a stub that grows back over a minute and a half, or in seconds once watered
        float grow = 1.0, wet = 0.0;
        if (lawn.x > 0.0) {
          float natural = 0.1 + 0.9 * smoothstep(0.0, 90.0, uTime - lawn.x);
          float watered = lawn.y > lawn.x ? 0.1 + 0.9 * smoothstep(0.0, 3.5, uTime - lawn.y) : 0.0;
          grow = max(natural, watered);
        }
        if (lawn.y > 0.0) wet = 1.0 - smoothstep(0.0, 8.0, uTime - lawn.y);
        float tall = shape.y * grow;
        float c = cos(shape.x), s = sin(shape.x);
        vec3 local = vec3(position.x * shape.z * c, h * tall, position.x * shape.z * s);
        vec3 world = offset + local;

        // wind: slow gusts rolling across the field plus a quick flutter
        float gust = sin(uTime * 0.9 - offset.x * 0.08 - offset.z * 0.11) * 0.5 + 0.5;
        float flutter = sin(uTime * 3.1 + offset.x * 1.7 + offset.z * 1.3 + shape.w * 6.0);
        float r2 = fract(shape.w * 7.31);
        vec2 lean = vec2(cos(shape.x * 1.7), sin(shape.x * 1.7)) * (0.03 + 0.12 * r2);
        vec2 bend = lean + vec2(0.04 + 0.16 * gust + 0.04 * flutter, 0.05 * flutter) * uWind;

        // the hand: push blades away from recent touch points, fading as they recover
        vec2 push = vec2(0.0);
        float touched = 0.0;
        for (int i = 0; i < ${TRAIL + 1}; i++) {
          vec2 dv = offset.xz - uTouch[i].xz;
          float dist = length(dv);
          float radius = uRadius * clamp(length(uTouch[i].xyz - cameraPosition) / 9.0, 0.45, 1.0);
          float f = (1.0 - smoothstep(0.0, radius, dist)) * uTouch[i].w;
          push += (dv / max(dist, 0.001)) * f * 2.6;
          touched = max(touched, f);
        }
        vec2 total = bend + push;
        float k = h * h;
        world.xz += total * k * tall;
        world.y -= min(length(total), 1.6) * k * tall * 0.42;

        vH = h;
        vCut = 1.0 - grow;
        vWet = max(wet, uRain * 0.7);
        vTint = shape.w;
        vTouched = touched;
        vPatch = noise(offset.xz * 0.09) * 0.7 + noise(offset.xz * 0.4) * 0.3;
        vShadow = smoothstep(0.42, 0.62, noise(offset.xz * 0.03 + vec2(uTime * 0.018, uTime * 0.006)));
        vFacing = abs(dot(normalize(vec2(-s, c)), normalize(uSunDir.xz)));
        vBack = pow(max(dot(normalize(world - cameraPosition), uSunDir), 0.0), 3.0);
        vec4 mv = viewMatrix * vec4(world, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uBase, uTip, uDry, uLight, uFog;
      uniform float uFogDensity, uNight, uCloudShadow;
      varying float vH, vTint, vTouched, vDist, vFacing, vBack, vPatch, vShadow, vCut, vWet;
      void main() {
        // patches of drier, yellower grass, and single blades that differ from their neighbours
        float dry = smoothstep(0.6, 0.9, vPatch) * 0.6 + step(0.94, fract(vTint * 13.7)) * 0.45;
        vec3 tip = mix(uTip, uDry, clamp(dry, 0.0, 1.0));
        tip = mix(tip, uDry * 1.15, vCut * 0.55);                    // freshly cut ends are paler
        vec3 col = mix(uBase, tip, pow(vH, 1.4));
        col *= 0.74 + 0.46 * vTint;
        col *= mix(0.22, 1.0, smoothstep(0.0, 0.7, vH));            // shadowed near the roots
        col += uLight * (0.08 * vFacing + 0.2 * vBack * (1.0 - 0.8 * uNight)) * vH * vH; // sunlight catching and shining through
        col *= 1.0 - uCloudShadow * 0.45 * vShadow;                  // cloud shadows drifting over the field
        col *= 1.0 - 0.25 * vTouched * (1.0 - uNight);              // pressed grass sits in its own shade
        col = col * (1.0 - 0.2 * vWet) + vec3(0.04, 0.06, 0.07) * vWet * vH; // wet grass is darker, with a sheen
        col += vec3(0.55, 0.95, 0.85) * vTouched * vH * uNight * 0.35; // a glow where you touch at night
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
        gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
        #include <colorspace_fragment>
      }`
  }));
  grass.frustumCulled = false;
  scene.add(grass);

  // ---- flowers: a yellow meadow across the hill, and a few bright ones close by
  const flowerGeo = new THREE.BufferGeometry();
  const NEAR_FLOWERS = isSmall ? 260 : 420; // the first ones, close enough to pick
  {
    const rand = mulberry32(9);
    const near = NEAR_FLOWERS, meadow = isSmall ? 1500 : 2600;
    const n = near + meadow;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), data = new Float32Array(n * 2);
    const bright = [[0.92, 0.28, 0.26], [0.95, 0.45, 0.55], [0.36, 0.42, 0.9], [0.97, 0.6, 0.22], [0.97, 0.96, 0.92], [0.98, 0.84, 0.25]];
    for (let i = 0; i < n; i++) {
      let x, z, c, size;
      if (i < near) {
        const r = rand(), d = 2.6 + 26 * r, a = (rand() * 2 - 1) * 0.95;
        x = Math.sin(a) * d * 1.15; z = cameraHome.z - Math.cos(a) * d;
        c = bright[Math.floor(rand() * bright.length)]; size = 0.13 + rand() * 0.06;
      } else {
        // a drift of small yellow flowers along the slope, thicker in its middle
        const u = rand(), v = (rand() + rand() + rand()) / 3;
        x = (u * 2 - 1) * 26; z = -11 - v * 10 + Math.sin(x * 0.2) * 1.5;
        const warm = rand();
        c = warm < 0.8 ? [0.98, 0.8 + rand() * 0.1, 0.2] : [0.98, 0.55, 0.2];
        size = 0.1 + rand() * 0.05;
      }
      pos.set([x, height(x, z) + 0.35 + rand() * 0.3, z], i * 3);
      col.set(c, i * 3);
      data.set([size, rand() * 6.28], i * 2);
    }
    flowerGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    flowerGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    flowerGeo.setAttribute('flower', new THREE.BufferAttribute(data, 2));
  }
  const flowerSizes = flowerGeo.attributes.flower.array.slice();
  const picked = []; // [index, time picked]
  const flowerUniforms = { ...shared, uDim: { value: 1 } };
  const flowers = new THREE.Points(flowerGeo, new THREE.ShaderMaterial({
    uniforms: flowerUniforms,
    vertexShader: /* glsl */`
      attribute vec3 color;
      attribute vec2 flower; // size, rotation
      uniform float uTime, uProj;
      varying vec3 vColor; varying float vDist, vRot;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 1.2 + p.z * 0.7 + flower.y) * 0.04;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vDist = -mv.z;
        vColor = color;
        vRot = flower.y;
        gl_PointSize = min(flower.x * uProj / vDist, 60.0 * uProj / 900.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uFog; uniform float uFogDensity, uDim;
      varying vec3 vColor; varying float vDist, vRot;
      void main() {
        vec2 p = (gl_PointCoord - 0.5) * 2.0;
        float r = length(p);
        float a = atan(p.y, p.x) + vRot;
        float petals = 0.62 + 0.38 * abs(cos(2.5 * a)); // five petals
        if (r > petals) discard;
        vec3 centre = mix(vec3(1.0, 0.82, 0.25), vec3(0.75, 0.4, 0.1), step(0.75, vColor.g) * step(vColor.b, 0.35));
        vec3 col = mix(vColor * (0.8 + 0.25 * r), centre, smoothstep(0.3, 0.2, r)) * uDim;
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
        gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
        #include <colorspace_fragment>
      }`
  }));
  flowers.frustumCulled = false;
  scene.add(flowers);

  // ---- touching the grass
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(0, 0);
  const pointerScreen = new THREE.Vector2(0, 0);
  let pointerOver = false;
  const lastTrail = new THREE.Vector3(0, -999, 0);
  let trailIndex = 0;
  const trailBorn = new Float32Array(TRAIL).fill(-999);
  const hand = new THREE.Vector4(0, -999, 0, 0);
  let handSeen = -999; // when the hand last touched the grass

  // Where the pointer meets the top of the grass, not the ground hidden beneath it,
  // so the blades that part are the ones under your finger.
  const CANOPY = 0.55;
  const grassUnder = (ray) => {
    const p = new THREE.Vector3();
    for (let t = 0.5; t < 140; t += 0.05 + t * 0.01) {
      ray.at(t, p);
      if (p.y - height(p.x, p.z) < CANOPY) return p;
    }
    return null;
  };

  // ---- falling leaves, shaken loose when you tap the tree
  const FALLING = 60;
  const fallPos = new Float32Array(FALLING * 3).fill(-999);
  const fallData = new Float32Array(FALLING * 2); // life, spin
  const fallVel = new Float32Array(FALLING * 3);
  const fallGeo = new THREE.BufferGeometry();
  fallGeo.setAttribute('position', new THREE.BufferAttribute(fallPos, 3));
  fallGeo.setAttribute('fall', new THREE.BufferAttribute(fallData, 2));
  const falling = new THREE.Points(fallGeo, new THREE.ShaderMaterial({
    uniforms: { ...shared, uLeafLight: leafUniforms.uLeafLight }, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec2 fall;
      uniform float uProj;
      varying vec2 vFall;
      void main() {
        vFall = fall;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 0.32 * uProj / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uLeafLight;
      varying vec2 vFall;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float c = cos(vFall.y), s = sin(vFall.y);
        p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
        if (p.x * p.x * 9.0 + p.y * p.y * 2.2 > 0.25) discard;
        gl_FragColor = vec4(uLeafLight * 1.1, min(vFall.x * 3.0, 1.0));
        #include <colorspace_fragment>
      }`
  }));
  falling.frustumCulled = false;
  scene.add(falling);
  let nextFall = 0;
  const shakeTree = () => {
    leafUniforms.uShake.value = 1;
    const rand = Math.random;
    for (let k = 0; k < 14; k++) {
      const i = nextFall; nextFall = (nextFall + 1) % FALLING;
      const v = new THREE.Vector3(rand() * 2 - 1, rand() * 0.8 - 0.6, rand() * 2 - 1).multiplyScalar(3);
      fallPos.set([crownCenter.x + v.x, crownCenter.y + v.y, crownCenter.z + v.z + 1.5], i * 3);
      fallVel.set([(rand() - 0.5) * 0.6, -0.5 - rand() * 0.5, 0.3 + rand() * 0.5], i * 3);
      fallData.set([1, rand() * 6.28], i * 2);
    }
  };

  // ---- butterflies by day
  const BUTTERFLIES = isSmall ? 5 : 7;
  const wingTexture = (fill, edge, spots) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const wing = () => {
      g.beginPath();
      g.ellipse(30, 22, 26, 18, -0.35, 0, Math.PI * 2);
      g.ellipse(24, 46, 17, 13, 0.4, 0, Math.PI * 2);
    };
    g.fillStyle = edge; wing(); g.fill();
    g.save(); g.translate(5, 4); g.scale(0.84, 0.84); g.fillStyle = fill; wing(); g.fill(); g.restore();
    g.fillStyle = spots;
    for (const [x, y, r] of [[48, 14, 3], [44, 26, 2.4], [30, 50, 2.6]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const wingLooks = [['#f08a24', '#2a1a10', '#fff4e0'], ['#f6f1e4', '#8a8a7a', '#f6c84a'], ['#5aa0f0', '#1b2a4a', '#e8f2ff'], ['#f3d23c', '#3a2a10', '#fff8d8']]
    .map((look) => new THREE.MeshBasicMaterial({ map: wingTexture(...look), side: THREE.DoubleSide, alphaTest: 0.5, transparent: true }));
  const wingGeo = new THREE.PlaneGeometry(0.2, 0.2);
  wingGeo.rotateX(-Math.PI / 2);
  wingGeo.translate(0.1, 0, 0); // hinge along the body
  const butterflies = Array.from({ length: BUTTERFLIES }, (_, i) => {
    const group = new THREE.Group();
    const material = wingLooks[i % wingLooks.length];
    const right = new THREE.Mesh(wingGeo, material);
    const left = new THREE.Mesh(wingGeo, material);
    left.scale.x = -1;
    group.add(right, left);
    scene.add(group);
    const x = (Math.random() - 0.5) * 10, z = 4 + Math.random() * 6;
    return {
      group, right, left, phase: Math.random() * 10,
      pos: new THREE.Vector3(x, height(x, z) + 1 + Math.random(), z),
      vel: new THREE.Vector3(), target: new THREE.Vector3(), retarget: 0,
      orbit: new THREE.Vector3(Math.cos(i * 2.4), 0.5 + (i % 3) * 0.25, Math.sin(i * 2.4)).multiplyScalar(0.8),
      happyUntil: 0, calmUntil: 0
    };
  });

  // ---- fireflies by night, drawn toward your hand
  const FIREFLIES = isSmall ? 60 : 110;
  const flyGeo = new THREE.BufferGeometry();
  const flyHome = new Float32Array(FIREFLIES * 3), flySeed = new Float32Array(FIREFLIES);
  const flyPos = new Float32Array(FIREFLIES * 3), flyPull = new Float32Array(FIREFLIES * 3);
  {
    const rand = mulberry32(3);
    for (let i = 0; i < FIREFLIES; i++) {
      const d = 3 + rand() * 30, a = (rand() * 2 - 1) * 0.9;
      const x = Math.sin(a) * d * 1.2, z = cameraHome.z - Math.cos(a) * d;
      flyHome.set([x, height(x, z) + 0.6 + rand() * 2.2, z], i * 3);
      flySeed[i] = rand() * 100;
    }
    flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
    flyGeo.setAttribute('seed', new THREE.BufferAttribute(flySeed, 1));
  }
  const fireflies = new THREE.Points(flyGeo, new THREE.ShaderMaterial({
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, uniforms: shared,
    vertexShader: /* glsl */`
      attribute float seed;
      uniform float uTime, uProj;
      varying float vBlink;
      void main() {
        vBlink = smoothstep(0.1, 0.9, sin(uTime * 1.4 + seed * 3.1) * 0.5 + 0.5);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(0.28 * uProj / -mv.z, 16.0 * uProj / 900.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uNight;
      varying float vBlink;
      void main() {
        float glow = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * glow * glow * glow * 1.4 * vBlink * uNight, 1.0);
      }`
  }));
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  // sparkles that rise from the grass where you touch it at night
  const SPARKS = 220;
  const sparkPos = new Float32Array(SPARKS * 3).fill(-999);
  const sparkLife = new Float32Array(SPARKS);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkKind = new Float32Array(SPARKS); // 0: night touch, 1: golden burst, 2: grass clippings
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('life', new THREE.BufferAttribute(sparkLife, 1));
  sparkGeo.setAttribute('kind', new THREE.BufferAttribute(sparkKind, 1));
  const sparks = new THREE.Points(sparkGeo, new THREE.ShaderMaterial({
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, uniforms: shared,
    vertexShader: /* glsl */`
      attribute float life, kind;
      uniform float uProj;
      varying float vLife, vKind;
      void main() {
        vLife = life;
        vKind = kind;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(0.12 * uProj / -mv.z, 9.0 * uProj / 900.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uNight;
      varying float vLife, vKind;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        if (vKind > 1.5) {
          // a clipping: a small solid fleck of green
          if (r > 0.42) discard;
          gl_FragColor = vec4(vec3(0.35, 0.62, 0.16) * (0.7 + 0.3 * vLife), 1.0);
          return;
        }
        vec3 col = mix(vec3(0.8, 1.0, 0.95), vec3(1.0, 0.86, 0.42), vKind);
        gl_FragColor = vec4(col * smoothstep(0.5, 0.0, r) * vLife * max(uNight, vKind), 1.0);
      }`
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let nextSpark = 0;
  const spawnSparks = (point, n, kind = 0, spread = 1.4) => {
    for (let k = 0; k < n; k++) {
      const i = nextSpark; nextSpark = (nextSpark + 1) % SPARKS;
      sparkPos.set([point.x + (Math.random() - 0.5) * spread, point.y + 0.2 + Math.random() * 0.5, point.z + (Math.random() - 0.5) * spread], i * 3);
      const burst = kind ? 1.6 : 0.3;
      sparkVel.set([(Math.random() - 0.5) * burst, 0.35 + Math.random() * (kind ? 1.2 : 0.5) + (kind === 2 ? 0.8 : 0), (Math.random() - 0.5) * burst], i * 3);
      sparkLife[i] = 1;
      sparkKind[i] = kind;
    }
  };

  // ---- a four-leaf clover hidden low in the grass; sweep the grass to find it
  const drawTexture = (size, draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const clover = new THREE.Sprite(new THREE.SpriteMaterial({
    alphaTest: 0.5,
    map: drawTexture(128, (g) => {
      g.translate(64, 60);
      g.strokeStyle = '#2f6b1f'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 6); g.quadraticCurveTo(6, 40, -2, 64); g.stroke();
      for (let k = 0; k < 4; k++) {
        g.save(); g.rotate(k * Math.PI / 2 + Math.PI / 4);
        // a heart-shaped leaflet pointing out from the middle
        g.fillStyle = '#3f9a2f';
        g.beginPath(); g.moveTo(0, -2);
        g.bezierCurveTo(-30, -14, -26, -50, -8, -46);
        g.bezierCurveTo(-2, -45, 0, -38, 0, -34);
        g.bezierCurveTo(0, -38, 2, -45, 8, -46);
        g.bezierCurveTo(26, -50, 30, -14, 0, -2);
        g.fill();
        g.strokeStyle = '#8fd46a'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, -6); g.lineTo(0, -30); g.stroke();
        g.restore();
      }
    })
  }));
  clover.scale.setScalar(0.36);
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    map: drawTexture(64, (g, n) => {
      const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      grad.addColorStop(0, 'rgba(255,255,230,1)'); grad.addColorStop(0.25, 'rgba(255,240,170,.5)'); grad.addColorStop(1, 'rgba(255,230,150,0)');
      g.fillStyle = grad; g.fillRect(0, 0, n, n);
      g.fillStyle = 'rgba(255,255,240,.9)';
      g.fillRect(n / 2 - 1, 4, 2, n - 8); g.fillRect(4, n / 2 - 1, n - 8, 2);
    })
  }));
  glint.scale.setScalar(0.6);
  scene.add(clover, glint);
  let cloverBack = 0; // when a new clover appears after one is found
  const placeClover = () => {
    // somewhere in view and within reach, never in the same spot twice
    const d = 4 + Math.random() * 7, a = (Math.random() * 2 - 1) * 0.2;
    const x = Math.sin(a) * d * 1.15, z = cameraHome.z - Math.cos(a) * d;
    clover.position.set(x, height(x, z) + 0.26, z);
    clover.visible = true;
  };
  placeClover();

  // ---- the lawn: clearing it with the cutlass, and rain that grows it back
  let tool = 'hand';
  let lawnDirty = null; // [first, last] blade whose cut state changed this frame
  const markLawn = (a, b) => { lawnDirty = lawnDirty ? [Math.min(lawnDirty[0], a), Math.max(lawnDirty[1], b)] : [a, b]; };
  const smooth = (e0, e1, x) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
  // how tall a blade is now, 0.1 (a stub) to 1; the grass shader draws the same thing
  const growthOf = (i, t) => {
    const cutTime = lawn[i * 2], wateredTime = lawn[i * 2 + 1];
    if (cutTime === 0) return 1;
    const natural = 0.1 + 0.9 * smooth(0, 90, t - cutTime);
    const watered = wateredTime > cutTime ? 0.1 + 0.9 * smooth(0, 3.5, t - wateredTime) : 0;
    return Math.max(natural, watered);
  };
  const mown = []; // [flower index, time it was cut]
  const restoreFlower = (i) => { flowerGeo.attributes.flower.array[i * 2] = flowerSizes[i * 2]; flowerGeo.attributes.flower.needsUpdate = true; };
  // Cut every standing blade within radius of a point; returns how many were cut.
  const cutAt = (point, radius) => {
    const t = timer.getElapsed();
    const r2 = radius * radius;
    let count = 0, first = Infinity, last = -1;
    const x0 = Math.floor((point.x - radius + 100) / CELL), x1 = Math.floor((point.x + radius + 100) / CELL);
    const z0 = Math.floor((point.z - radius + 100) / CELL), z1 = Math.floor((point.z + radius + 100) / CELL);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const range = cells.get(cz * 1000 + cx);
        if (!range) continue;
        for (let i = range[0]; i < range[1]; i++) {
          const dx = bladeOffsets[i * 3] - point.x, dz = bladeOffsets[i * 3 + 2] - point.z;
          if (dx * dx + dz * dz > r2 || growthOf(i, t) < 0.55) continue;
          lawn[i * 2] = t; lawn[i * 2 + 1] = 0;
          count++; first = Math.min(first, i); last = Math.max(last, i);
        }
      }
    }
    if (count) markLawn(first, last);
    // flowers in the way go too
    const fp = flowerGeo.attributes.position.array, fd = flowerGeo.attributes.flower.array;
    for (let i = 0; i < fd.length / 2; i++) {
      if (fd[i * 2] === 0) continue;
      const dx = fp[i * 3] - point.x, dz = fp[i * 3 + 2] - point.z;
      if (dx * dx + dz * dz < r2) { fd[i * 2] = 0; mown.push([i, t]); flowerGeo.attributes.flower.needsUpdate = true; }
    }
    if (count) spawnSparks(point, Math.min(10, 2 + Math.ceil(count / 25)), 2, radius);
    return count;
  };
  // Rain waters every cut blade, so it all grows back in a few seconds.
  const waterAll = () => {
    const t = timer.getElapsed();
    let count = 0;
    for (let i = 0; i < BLADES; i++) {
      if (lawn[i * 2] > 0 && lawn[i * 2 + 1] <= lawn[i * 2] && growthOf(i, t) < 0.95) { lawn[i * 2 + 1] = t; count++; }
    }
    if (count) markLawn(0, BLADES - 1);
    for (const [i] of mown.splice(0)) restoreFlower(i);
    return count;
  };

  // ---- rain: streaks falling in front of the camera, a greyer sky, and wet grass
  const DROPS = isSmall ? 700 : 1400;
  // each drop is a thin strip (two triangles), so rain costs almost nothing to draw
  const rainGeo = new THREE.InstancedBufferGeometry();
  rainGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  rainGeo.setIndex([0, 1, 2, 0, 2, 3]);
  {
    const rand = mulberry32(21);
    const drop = new Float32Array(DROPS * 4);
    for (let i = 0; i < DROPS; i++) {
      const d = 1.5 + rand() * 34, a = (rand() * 2 - 1) * 0.85;
      const x = Math.sin(a) * d * 1.15, z = cameraHome.z - Math.cos(a) * d;
      drop.set([x, rand(), z, height(x, z)], i * 4); // x, start offset, z, ground height
    }
    rainGeo.setAttribute('drop', new THREE.InstancedBufferAttribute(drop, 4));
    rainGeo.instanceCount = DROPS;
  }
  const rainUniforms = { uTime: shared.uTime, uRain: grassUniforms.uRain, uNight: shared.uNight, uProj: shared.uProj };
  const rainLines = new THREE.Mesh(rainGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: rainUniforms,
    vertexShader: /* glsl */`
      attribute vec4 drop;
      uniform float uTime;
      varying float vAlong, vFade;
      void main() {
        float fall = mod(drop.y * 20.0 - uTime * 16.0, 20.0);
        vec3 world = vec3(drop.x + fall * 0.04, drop.w + fall, drop.z) + vec3(0.025, 0.55, 0.0) * position.y;
        vec4 mv = viewMatrix * vec4(world, 1.0);
        mv.x += position.x * max(0.012, 0.0028 * -mv.z); // at least a pixel or two wide at any distance
        vAlong = position.y;
        vFade = smoothstep(0.0, 1.5, fall);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uRain, uNight;
      varying float vAlong, vFade;
      void main() {
        float a = (0.25 + 0.5 * vAlong) * uRain * vFade;
        gl_FragColor = vec4(mix(vec3(0.9, 0.94, 1.0), vec3(0.6, 0.68, 0.9), uNight), a);
      }`
  }));
  rainLines.frustumCulled = false;
  scene.add(rainLines);
  let rainAmount = 0, rainUntil = -1, rainReady = 0, nextWatering = 0, nextShower = 150 + Math.random() * 150;
  const rainyTop = new THREE.Color('#7f8b98'), rainyHorizon = new THREE.Color('#b9c1c8'), rainyFog = new THREE.Color('#aab3bb');
  const startRain = (byVisitor) => {
    const t = timer.getElapsed();
    if (t < rainReady) return Math.ceil(rainReady - t);
    rainUntil = t + 7; rainReady = t + 25; nextWatering = t;
    nextShower = t + 180 + Math.random() * 180;
    onEvent?.('rain', byVisitor);
    return 0;
  };

  // ---- a goat that wanders across now and then, grazing as it goes
  const goat = new THREE.Group();
  const goatLegs = [];
  const goatHead = new THREE.Group();
  {
    const coat = new THREE.MeshLambertMaterial({ color: 0x7a4b2c });
    const pale = new THREE.MeshLambertMaterial({ color: 0xefe6d6 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a211b });
    const add = (parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      parent.add(m);
      return m;
    };
    add(goat, new THREE.CapsuleGeometry(0.2, 0.5, 4, 12), coat, 0, 0.62, 0, Math.PI / 2);   // body
    add(goat, new THREE.SphereGeometry(0.17, 12, 8), pale, 0, 0.6, 0.18);                    // pale belly patch
    add(goat, new THREE.ConeGeometry(0.05, 0.18, 6), coat, 0, 0.82, -0.42, -0.6);            // tail
    // head on a neck that can dip to graze
    goatHead.position.set(0, 0.72, 0.36);
    goat.add(goatHead);
    add(goatHead, new THREE.CylinderGeometry(0.08, 0.11, 0.32, 8), coat, 0, 0.12, 0.04, 0.5);
    add(goatHead, new THREE.BoxGeometry(0.17, 0.18, 0.3), pale, 0, 0.27, 0.2, 0.35);
    add(goatHead, new THREE.ConeGeometry(0.03, 0.18, 6), dark, 0.05, 0.42, 0.12, -0.7, 0, 0.15);  // horns
    add(goatHead, new THREE.ConeGeometry(0.03, 0.18, 6), dark, -0.05, 0.42, 0.12, -0.7, 0, -0.15);
    add(goatHead, new THREE.BoxGeometry(0.16, 0.05, 0.08), coat, 0.13, 0.3, 0.12, 0, 0, -0.5);   // ears
    add(goatHead, new THREE.BoxGeometry(0.16, 0.05, 0.08), coat, -0.13, 0.3, 0.12, 0, 0, 0.5);
    add(goatHead, new THREE.ConeGeometry(0.035, 0.12, 6), dark, 0, 0.1, 0.3, Math.PI);         // beard
    add(goatHead, new THREE.SphereGeometry(0.022, 6, 4), dark, 0.075, 0.3, 0.26);               // eyes
    add(goatHead, new THREE.SphereGeometry(0.022, 6, 4), dark, -0.075, 0.3, 0.26);
    for (const [x, z] of [[0.12, 0.26], [-0.12, 0.26], [0.12, -0.26], [-0.12, -0.26]]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.52, z);
      add(leg, new THREE.CylinderGeometry(0.04, 0.035, 0.5, 6), pale, 0, -0.25, 0);
      add(leg, new THREE.CylinderGeometry(0.038, 0.04, 0.06, 6), dark, 0, -0.5, 0);
      goat.add(leg);
      goatLegs.push(leg);
    }
    goat.scale.setScalar(1.5);
    goat.visible = false;
    scene.add(goat);
  }
  const goatState = { active: false, next: 20 + Math.random() * 25, x: 0, z: 0, dir: 1, grazeUntil: 0, nextGraze: 0, hop: -9, step: 0 };
  const goatHeadWorld = new THREE.Vector3();

  // ---- birds that fly over now and then
  const BIRDS = 7;
  const birdPos = new Float32Array(BIRDS * 3).fill(-999);
  const birdGeo = new THREE.BufferGeometry();
  birdGeo.setAttribute('position', new THREE.BufferAttribute(birdPos, 3));
  birdGeo.setAttribute('seed', new THREE.BufferAttribute(Float32Array.from({ length: BIRDS }, (_, i) => i * 1.7), 1));
  const birdUniforms = { uTime: shared.uTime, uProj: shared.uProj, uDay: { value: 1 } };
  const birds = new THREE.Points(birdGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: birdUniforms,
    vertexShader: /* glsl */`
      attribute float seed;
      uniform float uTime, uProj;
      varying float vFlap;
      void main() {
        vFlap = sin(uTime * 9.0 + seed * 2.3);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 1.4 * uProj / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uDay;
      varying float vFlap;
      float segment(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float tip = -0.12 + vFlap * 0.18;
        float d = min(segment(p, vec2(0.0, 0.05), vec2(-0.42, tip)), segment(p, vec2(0.0, 0.05), vec2(0.42, tip)));
        float a = smoothstep(0.05, 0.02, d) * uDay;
        if (a < 0.02) discard;
        gl_FragColor = vec4(vec3(0.12, 0.12, 0.14), a * 0.85);
      }`
  }));
  birds.frustumCulled = false;
  scene.add(birds);
  const birdState = { active: false, next: 12 + Math.random() * 20, start: 0, y: 22, z: -70, dir: 1 };

  // ---- pointer
  const aim = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    pointerScreen.copy(pointer);
    raycaster.setFromCamera(pointer, camera);
  };
  let lastMove = null;
  const updatePointer = (event) => {
    aim(event);
    // how fast the hand is moving across the screen, in pixels per millisecond
    const speed = lastMove ? Math.hypot(event.clientX - lastMove.x, event.clientY - lastMove.y) / Math.max(8, event.timeStamp - lastMove.t) : 0;
    lastMove = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    pointerOver = true;
    const point = grassUnder(raycaster.ray);
    if (!point) { hand.w = 0; return; }
    hand.set(point.x, point.y, point.z, 1);
    handSeen = timer.getElapsed();
    onTouch?.(speed);
    if (tool === 'cut') {
      // a wider swing further away, so the far slope is not a chore
      const cut = cutAt(point, 0.7 + camera.position.distanceTo(point) * 0.05);
      if (cut) onEvent?.('cut', cut);
      return;
    }
    if (point.distanceTo(lastTrail) > 0.45) {
      lastTrail.copy(point);
      touchPoints[trailIndex].set(point.x, point.y, point.z, 1);
      trailBorn[trailIndex] = timer.getElapsed();
      trailIndex = (trailIndex + 1) % TRAIL;
      spawnSparks(point, 3);
    }
  };
  canvas.addEventListener('pointermove', updatePointer);
  // A tap (a quick press that barely moves) picks whatever is under it.
  const projected = new THREE.Vector3();
  const tap = (event) => {
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    const away = (v) => {
      projected.copy(v).project(camera);
      if (projected.z > 1) return Infinity;
      return Math.hypot((projected.x + 1) / 2 * rect.width - px, (1 - projected.y) / 2 * rect.height - py);
    };
    const t = timer.getElapsed();
    const reach = isSmall ? 1.25 : 1;
    if (goat.visible && away(goat.position.clone().add(new THREE.Vector3(0, 0.6, 0))) < 60 * reach) {
      goatState.hop = t;
      onEvent?.('goat');
      return;
    }
    if (clover.visible && away(clover.position) < 40 * reach) {
      clover.visible = false;
      cloverBack = t + 20;
      spawnSparks(clover.position, 36, 1, 0.5);
      onEvent?.('clover');
      return;
    }
    if (state.night < 0.5) {
      for (const b of butterflies) {
        if (t > b.calmUntil && away(b.pos) < 36 * reach) {
          b.happyUntil = t + 1.6; b.calmUntil = t + 5;
          spawnSparks(b.pos, 8, 1, 0.3);
          onEvent?.('butterfly');
          return;
        }
      }
    }
    const fp = flowerGeo.attributes.position.array, fd = flowerGeo.attributes.flower.array;
    let best = -1, bestAway = 30 * reach;
    for (let i = 0; i < NEAR_FLOWERS; i++) {
      if (fd[i * 2] === 0) continue;
      const dist = away(projected.set(fp[i * 3], fp[i * 3 + 1], fp[i * 3 + 2]));
      if (dist < bestAway) { best = i; bestAway = dist; }
    }
    if (best >= 0) {
      fd[best * 2] = 0;
      flowerGeo.attributes.flower.needsUpdate = true;
      picked.push([best, t]);
      spawnSparks(new THREE.Vector3(fp[best * 3], fp[best * 3 + 1] - 0.3, fp[best * 3 + 2]), 10, 1, 0.3);
      onEvent?.('flower');
      return;
    }
    aim(event);
    if (raycaster.ray.intersectsSphere(crownSphere)) { shakeTree(); onEvent?.('shake'); }
  };
  let pressed = null;
  canvas.addEventListener('pointerdown', (e) => {
    pressed = { x: e.clientX, y: e.clientY, at: performance.now() };
    canvas.setPointerCapture?.(e.pointerId);
    updatePointer(e);
  });
  canvas.addEventListener('pointerleave', () => { pointerOver = false; hand.w = 0; });
  canvas.addEventListener('pointerup', (e) => {
    if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < 12 && performance.now() - pressed.at < 450) tap(e);
    pressed = null;
    if (e.pointerType !== 'mouse') { pointerOver = false; hand.w = 0; }
  });

  // ---- time of day
  let from = null, to = 'morning', blendStart = 0;
  const BLEND_SECONDS = 1.6;
  const cloneMode = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v?.clone ? v.clone() : v]));
  const setMode = (name, instant = false) => {
    if (!modes[name]) return;
    from = instant ? null : cloneMode(state);
    to = name;
    blendStart = timer.getElapsed();
    if (instant) Object.assign(state, cloneMode(modes[name]));
  };
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
    skyUniforms.uSunColor.value.copy(state.sunColor);
    skyUniforms.uSunSize.value = state.sunSize;
    skyUniforms.uClouds.value = state.clouds;
    skyUniforms.uStars.value = state.stars;
    shared.uSunDir.value.copy(state.sunDir);
    shared.uLight.value.copy(state.light);
    shared.uFog.value.copy(state.fog);
    shared.uFogDensity.value = state.fogDensity;
    shared.uNight.value = state.night;
    grassUniforms.uBase.value.copy(state.grassBase);
    grassUniforms.uTip.value.copy(state.grassTip);
    grassUniforms.uDry.value.copy(state.grassDry);
    grassUniforms.uCloudShadow.value = state.cloudShadow;
    leafUniforms.uLeafLight.value.copy(state.leafLight);
    leafUniforms.uLeafDark.value.copy(state.leafDark);
    flowerUniforms.uDim.value = 1 - 0.7 * state.night;
    hemi.color.copy(state.hemiSky); hemi.groundColor.copy(state.hemiGround); hemi.intensity = state.hemiIntensity;
    sun.color.copy(state.light); sun.intensity = state.lightIntensity;
    sun.position.copy(state.sunDir).multiplyScalar(50);
    groundMat.color.copy(state.ground);
    barkMat.color.copy(state.bark);
    ridgeMat.color.copy(state.ridge).lerp(state.fog, 0.45);
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
    shared.uProj.value = (h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---- loop
  const sway = new THREE.Vector2();
  const restingSway = new THREE.Vector2();
  const steer = new THREE.Vector3();
  let running = true;
  const frame = () => {
    if (!running) return;
    timer.update();
    const t = timer.getElapsed();
    const dt = Math.min(timer.getDelta(), 0.05);
    shared.uTime.value = t;

    if (from) {
      const k = Math.min(1, (t - blendStart) / BLEND_SECONDS);
      blendModes(k * k * (3 - 2 * k));
      if (k >= 1) from = null;
    }
    applyState();
    const handActive = t - handSeen < 1.5;
    const day = 1 - state.night;

    // trail fades so the grass slowly stands back up
    for (let i = 0; i < TRAIL; i++) {
      touchPoints[i].w = Math.max(0, 1 - (t - trailBorn[i]) / RECOVER_SECONDS) ** 1.5;
    }
    // the slot under the hand stays fully pressed while it rests there
    if (hand.w > 0 && pointerOver) {
      const slot = (trailIndex + TRAIL - 1) % TRAIL;
      touchPoints[slot].set(hand.x, hand.y, hand.z, 1);
      trailBorn[slot] = t;
    }

    // the clover glints when your hand gets close, and a new one appears after a find
    if (!clover.visible && t > cloverBack) placeClover();
    const handNear = clover.visible && handActive ? clover.position.distanceTo(new THREE.Vector3(hand.x, hand.y, hand.z)) : 99;
    const glow = Math.max(0, 1 - handNear / 2.4);
    glint.material.opacity += ((glow > 0 ? 0.55 + 0.45 * Math.sin(t * 9) : 0) * glow - glint.material.opacity) * Math.min(1, dt * 8);
    glint.position.copy(clover.position).add(new THREE.Vector3(0, 0.5, 0));
    glint.visible = glint.material.opacity > 0.01;
    // picked flowers grow back after a while
    while (picked.length && t - picked[0][1] > 45) {
      const [i] = picked.shift();
      flowerGeo.attributes.flower.array[i * 2] = flowerSizes[i * 2];
      flowerGeo.attributes.flower.needsUpdate = true;
    }

    // tree settles after a shake; loose leaves drift down
    leafUniforms.uShake.value = Math.max(0, leafUniforms.uShake.value - dt * 1.2);
    for (let i = 0; i < FALLING; i++) {
      if (fallData[i * 2] <= 0) continue;
      const x = i * 3;
      fallPos[x] += (fallVel[x] + Math.sin(t * 2.2 + i) * 0.5) * dt;
      fallPos[x + 1] += fallVel[x + 1] * dt;
      fallPos[x + 2] += fallVel[x + 2] * dt;
      fallData[i * 2 + 1] += dt * 2.5;
      if (fallPos[x + 1] < height(fallPos[x], fallPos[x + 2]) + 0.3) fallData[i * 2] -= dt * 0.8;
    }
    fallGeo.attributes.position.needsUpdate = true;
    fallGeo.attributes.fall.needsUpdate = true;

    // butterflies wander, and come to the hand when it is in the grass
    for (const b of butterflies) {
      b.group.visible = day > 0.05;
      if (!b.group.visible) continue;
      if (handActive) {
        b.target.set(hand.x, hand.y, hand.z).add(b.orbit).add(new THREE.Vector3(Math.sin(t * 1.3 + b.phase) * 0.4, 0, Math.cos(t * 1.1 + b.phase) * 0.4));
      } else if (t > b.retarget) {
        const x = (Math.random() - 0.5) * 12, z = 2 + Math.random() * 9;
        b.target.set(x, height(x, z) + 0.8 + Math.random() * 1.2, z);
        b.retarget = t + 2 + Math.random() * 3;
      }
      if (t < b.happyUntil) {
        // a delighted loop-the-loop
        b.vel.set(Math.cos(t * 7 + b.phase) * 1.5, 0.6 + Math.sin(t * 7 + b.phase) * 1.2, Math.sin(t * 7 + b.phase) * 1.5);
        b.pos.addScaledVector(b.vel, dt);
        b.group.position.copy(b.pos);
        b.group.rotation.y = Math.atan2(b.vel.x, b.vel.z);
        const flap = 0.2 + Math.abs(Math.sin(t * 22 + b.phase)) * 1.2;
        b.right.rotation.z = flap; b.left.rotation.z = -flap;
        continue;
      }
      steer.copy(b.target).sub(b.pos);
      const dist = steer.length();
      b.vel.addScaledVector(steer.normalize(), Math.min(dist, 2) * 2.2 * dt);
      b.vel.y += Math.sin(t * 6 + b.phase) * 1.6 * dt; // the bobbing, fluttery path
      b.vel.multiplyScalar(1 - 1.6 * dt);
      if (b.vel.length() > 1.6) b.vel.setLength(1.6);
      b.pos.addScaledVector(b.vel, dt);
      b.pos.y = Math.max(b.pos.y, height(b.pos.x, b.pos.z) + 0.45);
      b.group.position.copy(b.pos);
      b.group.rotation.y = Math.atan2(b.vel.x, b.vel.z);
      const flap = 0.2 + Math.abs(Math.sin(t * 14 + b.phase)) * 1.1;
      b.right.rotation.z = flap; b.left.rotation.z = -flap;
      b.group.scale.setScalar(day);
    }

    // fireflies drift around their homes, gathering at the hand at night
    for (let i = 0; i < FIREFLIES; i++) {
      const x = i * 3, s = flySeed[i];
      const hx = flyHome[x] + Math.sin(t * 0.31 + s) * 1.1;
      const hy = flyHome[x + 1] + Math.sin(t * 0.53 + s * 1.7) * 0.45;
      const hz = flyHome[x + 2] + Math.cos(t * 0.27 + s * 0.6) * 1.1;
      const near = handActive && state.night > 0.5 && i % 3 === 0;
      const tx = near ? hand.x + Math.sin(t * 0.9 + s) * 1.2 - hx : 0;
      const ty = near ? hand.y + 0.6 + Math.sin(t * 1.3 + s) * 0.5 - hy : 0;
      const tz = near ? hand.z + Math.cos(t * 0.8 + s) * 1.2 - hz : 0;
      const ease = Math.min(1, dt * (near ? 1.2 : 0.4));
      flyPull[x] += (tx - flyPull[x]) * ease;
      flyPull[x + 1] += (ty - flyPull[x + 1]) * ease;
      flyPull[x + 2] += (tz - flyPull[x + 2]) * ease;
      flyPos[x] = hx + flyPull[x]; flyPos[x + 1] = hy + flyPull[x + 1]; flyPos[x + 2] = hz + flyPull[x + 2];
    }
    flyGeo.attributes.position.needsUpdate = true;

    for (let i = 0; i < SPARKS; i++) {
      if (sparkLife[i] <= 0) continue;
      sparkLife[i] = Math.max(0, sparkLife[i] - dt * 0.7);
      if (sparkKind[i] === 2) sparkVel[i * 3 + 1] -= 5 * dt; // clippings fall back down
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.life.needsUpdate = true;
    sparkGeo.attributes.kind.needsUpdate = true;

    // rain: fades in and out, waters the lawn while it falls, darkens the sky
    if (t > nextShower && t > rainReady && state.night < 0.5) startRain(false);
    rainAmount += ((t < rainUntil ? 1 : 0) - rainAmount) * Math.min(1, dt * 1.5);
    grassUniforms.uRain.value = rainAmount;
    rainLines.visible = rainAmount > 0.01;
    if (t < rainUntil && t >= nextWatering) { waterAll(); nextWatering = t + 1.5; }
    if (rainAmount > 0.01) {
      const k = rainAmount * (1 - 0.6 * state.night);
      skyUniforms.uTop.value.lerp(rainyTop, 0.45 * k);
      skyUniforms.uHorizon.value.lerp(rainyHorizon, 0.45 * k);
      skyUniforms.uClouds.value = Math.min(1, skyUniforms.uClouds.value + rainAmount);
      skyUniforms.uSunSize.value = THREE.MathUtils.lerp(skyUniforms.uSunSize.value, 1.0001, rainAmount);
      shared.uLight.value.multiplyScalar(1 - 0.4 * rainAmount);
      shared.uFog.value.lerp(rainyFog, 0.3 * k);
      scene.fog.color.copy(shared.uFog.value);
      grassUniforms.uCloudShadow.value *= 1 - rainAmount;
    }
    // flowers cut down come back after a while, like the grass
    while (mown.length && t - mown[0][1] > 90) restoreFlower(mown.shift()[0]);

    // the goat: wanders in by day, grazes, nibbles the grass, and leaves
    if (!goatState.active && t > goatState.next && state.night < 0.5) {
      goatState.active = true;
      goatState.dir = Math.random() < 0.5 ? 1 : -1;
      // along the lower slope, where it stands out against the hill rather than hiding in tall grass
      goatState.x = -13 * goatState.dir;
      goatState.z = -4 - Math.random() * 4;
      goatState.nextGraze = t + 4 + Math.random() * 5;
      goat.visible = true;
      onEvent?.('goat-arrives');
    }
    if (goatState.active) {
      const grazing = t < goatState.grazeUntil;
      if (!grazing) {
        goatState.x += goatState.dir * 0.55 * dt;
        goatState.step += dt * 7;
        if (t > goatState.nextGraze) { goatState.grazeUntil = t + 2.5 + Math.random() * 2; goatState.nextGraze = goatState.grazeUntil + 4 + Math.random() * 6; }
      }
      const hop = Math.max(0, Math.sin(Math.min(1, (t - goatState.hop) / 0.45) * Math.PI)) * 0.35;
      goat.position.set(goatState.x, height(goatState.x, goatState.z) + hop + (grazing ? 0 : Math.abs(Math.sin(goatState.step)) * 0.03), goatState.z);
      goat.rotation.y = goatState.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      goatLegs.forEach((leg, i) => { leg.rotation.x = grazing ? 0 : Math.sin(goatState.step + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.45; });
      goatHead.rotation.x += ((grazing ? 0.9 : 0) - goatHead.rotation.x) * Math.min(1, dt * 4);
      if (grazing && goatHead.rotation.x > 0.7) {
        goatHead.localToWorld(goatHeadWorld.set(0, 0.25, 0.35));
        cutAt(goatHeadWorld, 0.35);
      }
      touchPoints[TRAIL].set(goat.position.x, goat.position.y, goat.position.z, 1);
      if (Math.abs(goatState.x) > 14) {
        goatState.active = false; goat.visible = false;
        touchPoints[TRAIL].w = 0;
        goatState.next = t + 60 + Math.random() * 60;
      }
    }

    // birds cross the sky in a loose V
    birdUniforms.uDay.value = day;
    if (!birdState.active && t > birdState.next && day > 0.5) {
      Object.assign(birdState, { active: true, start: t, y: 18 + Math.random() * 8, z: -55 - Math.random() * 30, dir: Math.random() < 0.5 ? 1 : -1 });
    }
    if (birdState.active) {
      const along = (t - birdState.start) * 7 - 70;
      for (let i = 0; i < BIRDS; i++) {
        const rank = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        birdPos.set([(along - rank * 2.2) * birdState.dir, birdState.y + rank * 0.4 + Math.sin(t * 1.3 + i) * 0.3, birdState.z + rank * side * 2.2], i * 3);
      }
      birdGeo.attributes.position.needsUpdate = true;
      if (along > 90) { birdState.active = false; birdState.next = t + 35 + Math.random() * 50; }
    }

    // send this frame's cutting to the graphics card
    if (lawnDirty) {
      lawnAttr.clearUpdateRanges();
      lawnAttr.addUpdateRange(lawnDirty[0] * 2, (lawnDirty[1] - lawnDirty[0] + 1) * 2);
      lawnAttr.needsUpdate = true;
      lawnDirty = null;
    }

    // a little parallax toward the pointer
    if (!reduceMotion) sway.lerp(pointerOver ? pointerScreen : restingSway, 0.03);
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
  // Prepare every material up front (rain and the goat start hidden), so the first
  // shower or goat does not stall a frame while the browser builds its shaders.
  rainLines.visible = goat.visible = true;
  renderer.compile(scene, camera);
  rainLines.visible = goat.visible = false;
  requestAnimationFrame(frame);

  // Where the clover is on screen right now (for a hint), or null once it is found.
  const whereIsClover = () => {
    if (!clover.visible) return null;
    const rect = canvas.getBoundingClientRect();
    const p = clover.position.clone().project(camera);
    return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height };
  };

  // Pick what the hand does: 'hand' brushes the grass, 'cut' swings the cutlass.
  const setTool = (name) => { tool = name; };
  // Ask for rain; returns 0 if it starts, or the seconds until it can.
  const rain = () => startRain(true);

  return { setMode, whereIsClover, setTool, rain };
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
