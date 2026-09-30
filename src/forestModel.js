// The forest clearing, drawn (part of the renderer; the layout -- where the
// trees, paths and so on are -- comes from clearing.js). In the same style as
// the characters: smooth shapes sculpted in code, toon-shaded, with dark
// outlines. Trees come in a few shapes (leafy trees and conifers), each drawn
// many times over (instanced), turned and sized differently. Past the last
// trees, a painted backdrop of more forest fades into the haze.
import * as THREE from '../node_modules/three/build/three.module.js';
import { seededRandom } from './clearing.js';

const LINE_COLOR = '#2b2030'; // (as the characters' outlines)
export const HAZE_COLOR = '#9db3a3'; // the fog, and the nearest painted trees
export const SKY_COLOR = '#a9cbe6';

const COLORS = {
  grass: '#7aa257', grassDark: '#5c8443', forestFloor: '#4d6a39', dirt: '#8d714f', dirtDark: '#76603f',
  bark: '#6b5140', barkDark: '#4a372c',
  leaves: ['#5f9442', '#6fa04a', '#4f8a44', '#7aa84c'], leavesDark: '#2f5a2e',
  needles: '#3f6e45', needlesDark: '#23452f',
  rock: '#8b8d88', rockDark: '#65675f',
  bladeBase: '#446b2f', bladeTip: '#a6cc6c',
};

// --- Materials -----------------------------------------------------------

const gradients = new Map();
function toon(options, steps = [150, 210, 255]) {
  const key = steps.join(',');
  if (!gradients.has(key)) {
    const g = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
    g.minFilter = g.magFilter = THREE.NearestFilter;
    g.needsUpdate = true;
    gradients.set(key, g);
  }
  return new THREE.MeshToonMaterial({ gradientMap: gradients.get(key), ...options });
}

// Shared by everything that sways in the wind (see update).
const time = { value: 0 };

// Leaves and grass sway: the higher up, the further. `amount` per unit of
// height; `from`: the height (in the mesh's own units) where swaying starts.
function addSway(material, amount, from = 0, speed = 1.3) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.forestTime = time;
    shader.vertexShader = `uniform float forestTime;
${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  {
#ifdef USE_INSTANCING
    vec2 swayAt = instanceMatrix[3].xz;
#else
    vec2 swayAt = vec2(0.0);
#endif
    float swayPhase = forestTime * ${speed.toFixed(2)} + swayAt.x * 0.37 + swayAt.y * 0.29;
    float swayHeight = max(position.y - ${from.toFixed(2)}, 0.0);
    transformed.x += sin(swayPhase) * ${amount.toFixed(3)} * swayHeight;
    transformed.z += sin(swayPhase * 0.8 + 1.3) * ${(amount * 0.6).toFixed(3)} * swayHeight;
  }`)}`;
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `sway-${amount}-${from}-${speed}-${key ? key() : ''}`;
  return material;
}

// The dark outline round a shape: its back faces, pushed out along the normals.
function outlineMaterial(thickness, sway = null) {
  const mat = new THREE.MeshBasicMaterial({ color: LINE_COLOR, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed += normalize(normal) * ${thickness.toFixed(4)};`);
  };
  mat.customProgramCacheKey = () => `forest-outline-${thickness}`;
  if (sway) addSway(mat, ...sway);
  return mat;
}

// --- Geometry helpers ------------------------------------------------------

// Joins shapes into one (their positions, colours and normals, if they all
// have them, and triangles).
function mergeGeometries(geometries) {
  const names = ['position', 'color', 'normal'].filter((n) => geometries.every((g) => g.attributes[n]));
  const data = Object.fromEntries(names.map((n) => [n, []])), indices = [];
  let offset = 0;
  for (const g of geometries) {
    const count = g.attributes.position.count;
    for (const n of names) data[n].push(...g.attributes[n].array);
    if (g.index) for (const i of g.index.array) indices.push(i + offset);
    else for (let i = 0; i < count; i++) indices.push(i + offset);
    offset += count;
  }
  const merged = new THREE.BufferGeometry();
  for (const n of names) merged.setAttribute(n, new THREE.Float32BufferAttribute(data[n], 3));
  merged.setIndex(indices);
  return merged;
}

// Welds together vertices in the same place (with the same colour, if any),
// so the shape's normals can be smoothed across them.
function mergeVertices(geometry) {
  const pos = geometry.attributes.position, col = geometry.attributes.color;
  const map = new Map(), positions = [], colors = [], remap = [];
  for (let i = 0; i < pos.count; i++) {
    const key = [pos.getX(i), pos.getY(i), pos.getZ(i), ...(col ? [col.getX(i), col.getY(i), col.getZ(i)] : [])].map((v) => Math.round(v * 1e4)).join(',');
    let index = map.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      map.set(key, index);
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (col) colors.push(col.getX(i), col.getY(i), col.getZ(i));
    }
    remap.push(index);
  }
  const indices = geometry.index ? Array.from(geometry.index.array, (i) => remap[i]) : remap;
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (col) merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.setIndex(indices);
  return merged;
}

// --- Noise ---------------------------------------------------------------

// Smooth 3D value noise (0 to 1), from a seed.
function makeNoise(seed) {
  const random = seededRandom(seed);
  const perm = new Uint8Array(512), values = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; values[i] = random(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const at = (i, j, k) => values[perm[perm[perm[i & 255] + (j & 255)] + (k & 255)]];
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    const u = fade(x - i), v = fade(y - j), w = fade(z - k);
    const lerp = (a, b, t) => a + (b - a) * t;
    return lerp(
      lerp(lerp(at(i, j, k), at(i + 1, j, k), u), lerp(at(i, j + 1, k), at(i + 1, j + 1, k), u), v),
      lerp(lerp(at(i, j, k + 1), at(i + 1, j, k + 1), u), lerp(at(i, j + 1, k + 1), at(i + 1, j + 1, k + 1), u), v),
      w,
    );
  };
}

// --- Shapes --------------------------------------------------------------

const color = new THREE.Color();

// A trunk or branch: rings swept along a curve through `points`, their size
// from radius(t, angle) (t: 0 at the start, 1 at the end), coloured by
// shade(t, angle) (from barkDark, 0, to bark, 1).
function sweep(points, radius, shade, { sides = 12, rows = 20 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(rows, false);
  const positions = [], colors = [], indices = [];
  const dark = new THREE.Color(COLORS.barkDark), light = new THREE.Color(COLORS.bark);
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, centre = curve.getPointAt(t);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2, r = radius(t, a);
      positions.push(
        centre.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * r,
        centre.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * r,
        centre.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * r,
      );
      color.copy(dark).lerp(light, shade(t, a));
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < sides; j++) {
    const a = i * (sides + 1) + j, b = a + 1, c = a + sides + 1, d = c + 1;
    indices.push(a, b, c, b, d, c); // (facing outwards)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// A lumpy, rounded clump of leaves at `centre`: a ball pushed in and out by
// noise into puffy bulges, flattened a little underneath, and shaded darker
// underneath and inside.
function leafClump(centre, size, noise, leafColor, darkColor, { detail = 9, flatten = 0.75 } = {}) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute('normal').deleteAttribute('uv'));
  const pos = g.attributes.position, colors = [];
  const light = new THREE.Color(leafColor), dark = new THREE.Color(darkColor);
  const offset = centre.x * 3.1 + centre.z * 1.7;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Big, soft lumps, and smaller puffs over them.
    const lumps = noise(x * 1.3 + offset, y * 1.3, z * 1.3) - 0.5;
    const puffs = Math.pow(noise(x * 3.6 + offset, y * 3.6 + 7, z * 3.6), 1.5);
    const r = size * (1 + 0.32 * lumps + 0.16 * puffs);
    pos.setXYZ(i, centre.x + x * r, centre.y + (y < 0 ? y * flatten : y) * r, centre.z + z * r);
    color.copy(dark).lerp(light, THREE.MathUtils.smoothstep(y + 0.25 * puffs, -0.7, 0.7));
    colors.push(color.r, color.g, color.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

// A leafy tree: a trunk that flares into roots at the bottom, a few branches
// reaching up and out, and big clumps of leaves at their ends and on top.
function leafyTree(seed) {
  const random = seededRandom(seed * 7919 + 1), noise = makeNoise(seed + 11);
  const between = (lo, hi) => lo + (hi - lo) * random();
  const height = between(4.4, 5.8), lean = [between(-0.3, 0.3), between(-0.3, 0.3)];
  const trunkPoints = [0, 0.3, 0.65, 1].map((t, i) => new THREE.Vector3(lean[0] * t * t + (i === 2 ? between(-0.12, 0.12) : 0), -0.3 + t * (height + 0.3), lean[1] * t * t));
  const flarePhase = between(0, 6);
  const trunk = sweep(trunkPoints,
    (t, a) => 0.3 * (1 - 0.55 * t) * (1 + (1 - THREE.MathUtils.smoothstep(t, 0, 0.14)) * (0.5 + 0.55 * Math.max(0, Math.cos(5 * a + flarePhase)))),
    (t, a) => 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(a * 7 + t * 3)) * (0.6 + 0.4 * noise(a * 2, t * 12, seed)),
    { sides: 14, rows: 24 });
  const curve = new THREE.CatmullRomCurve3(trunkPoints);
  const parts = [trunk], clumps = [];
  const count = 4 + Math.floor(random() * 2);
  for (let i = 0; i < count; i++) {
    const t = between(0.48, 0.82), start = curve.getPointAt(t);
    const az = (i / count) * Math.PI * 2 + between(-0.4, 0.4), up = between(0.55, 0.95), length = between(1.4, 2.2);
    const dir = new THREE.Vector3(Math.cos(up) * Math.sin(az), Math.sin(up), Math.cos(up) * Math.cos(az));
    const end = start.clone().addScaledVector(dir, length);
    const mid = start.clone().addScaledVector(dir, length * 0.5).add(new THREE.Vector3(0, -0.12, 0));
    parts.push(sweep([start, mid, end], (s) => 0.12 * (1 - 0.6 * s), (s, a) => 0.4 + 0.3 * Math.sin(a * 5), { sides: 8, rows: 8 }));
    clumps.push({ at: end.clone().add(new THREE.Vector3(0, 0.3, 0)), size: between(1.1, 1.5) });
  }
  const top = curve.getPointAt(1);
  clumps.push({ at: top.clone().add(new THREE.Vector3(0, 0.55, 0)), size: between(1.5, 1.8) });
  clumps.push({ at: curve.getPointAt(0.82).add(new THREE.Vector3(between(-0.4, 0.4), 0.3, between(-0.4, 0.4))), size: 1.4 });
  const leafColor = COLORS.leaves[seed % COLORS.leaves.length];
  const leaves = mergeGeometries(clumps.map((c) => leafClump(c.at, c.size, noise, leafColor, COLORS.leavesDark)));
  return { wood: mergeGeometries(parts), leaves, height };
}

// A conifer: a straight trunk, and tiers of drooping, jagged boughs, smaller
// towards the pointed top.
function conifer(seed) {
  const random = seededRandom(seed * 104729 + 3);
  const between = (lo, hi) => lo + (hi - lo) * random();
  const height = between(7, 9);
  const wood = sweep([new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, height * 0.5, 0), new THREE.Vector3(0, height * 0.95, 0)],
    (t, a) => 0.26 * (1 - 0.85 * t) * (1 + (1 - THREE.MathUtils.smoothstep(t, 0, 0.1)) * 0.4 * Math.max(0, Math.cos(4 * a))),
    (t, a) => 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(a * 6 + t * 9)), { sides: 10, rows: 12 });
  const tiers = [], count = 6;
  const light = new THREE.Color(COLORS.needles), dark = new THREE.Color(COLORS.needlesDark);
  for (let i = 0; i < count; i++) {
    const f = i / (count - 1);
    const bottom = 1.3 + (height - 2.6) * Math.pow(f, 0.85), tierHeight = 2.3 - 1.0 * f;
    const spread = 2.3 * (1 - f) + 0.55, points = 9 + Math.floor(random() * 3), phase = between(0, 1);
    const sides = 72, rows = 10;
    const positions = [], colors = [], indices = [];
    for (let r = 0; r <= rows; r++) {
      // Down the top of the tier to its edge, then back in underneath.
      const outer = r <= 7, u = outer ? r / 7 : 1 - (r - 7) / 3 * 0.85;
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        const saw = Math.abs(((a / (Math.PI * 2)) * points + phase) % 1 - 0.5) * 2; // 1 at the tips of the boughs, 0 between
        const reach = spread * (0.78 + 0.28 * saw);
        const radius = reach * Math.sin(u * Math.PI / 2);
        const droop = 0.35 * saw * u * u;
        const y = outer ? bottom + tierHeight * (1 - u) - droop : bottom + 0.25 * (1 - u) - droop * 0.8;
        positions.push(Math.sin(a) * radius, y, Math.cos(a) * radius);
        color.copy(dark).lerp(light, outer ? 0.35 + 0.65 * saw * u : 0.1);
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let r = 0; r < rows; r++) for (let j = 0; j < sides; j++) {
      const a = r * (sides + 1) + j, b = a + 1, c = a + sides + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    tiers.push(mergeVertices(g));
  }
  const leaves = mergeGeometries(tiers);
  leaves.computeVertexNormals();
  return { wood, leaves, height };
}

// A bush: a few small clumps of leaves together, low to the ground.
function bush(seed) {
  const random = seededRandom(seed * 31 + 5), noise = makeNoise(seed + 101);
  const clumps = [];
  const count = 3 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + random(), d = i ? 0.45 + 0.2 * random() : 0;
    clumps.push(leafClump(new THREE.Vector3(Math.sin(a) * d, 0.35 + 0.15 * random(), Math.cos(a) * d), 0.5 + 0.25 * random(), noise,
      COLORS.leaves[(seed + i) % COLORS.leaves.length], COLORS.leavesDark, { detail: 6, flatten: 0.5 }));
  }
  return mergeGeometries(clumps);
}

// A rock: a lumpy, flattened stone, half sunk into the ground.
function rock(seed) {
  const noise = makeNoise(seed + 501);
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 4).deleteAttribute('normal').deleteAttribute('uv'));
  const pos = g.attributes.position, colors = [];
  const light = new THREE.Color(COLORS.rock), dark = new THREE.Color(COLORS.rockDark);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = 1 + 0.35 * (noise(x * 1.5, y * 1.5, z * 1.5) - 0.5) + 0.1 * (noise(x * 4, y * 4, z * 4) - 0.5);
    pos.setXYZ(i, x * r * 1.2, y * r * 0.6 - 0.15, z * r);
    color.copy(dark).lerp(light, THREE.MathUtils.smoothstep(y, -0.3, 0.8));
    colors.push(color.r, color.g, color.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

// A tuft of grass: thin, curving blades fanning out from a point, dark at the
// base and lighter towards the tips. (Lit as if flat, like the ground.)
function grassTuft() {
  const random = seededRandom(77);
  const positions = [], colors = [], indices = [];
  const base = new THREE.Color(COLORS.bladeBase), tip = new THREE.Color(COLORS.bladeTip);
  for (let b = 0; b < 7; b++) {
    const az = random() * Math.PI * 2, height = 0.22 + random() * 0.22, lean = 0.1 + random() * 0.15, width = 0.035;
    const start = positions.length / 3;
    for (let s = 0; s <= 4; s++) {
      const t = s / 4, out = lean * t * t, w = width * (1 - t);
      const cx = Math.sin(az) * (out + 0.03), cz = Math.cos(az) * (out + 0.03), y = height * t;
      positions.push(cx - Math.cos(az) * w, y, cz + Math.sin(az) * w, cx + Math.cos(az) * w, y, cz - Math.sin(az) * w);
      color.copy(base).lerp(tip, t);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
    for (let s = 0; s < 4; s++) {
      const a = start + s * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(indices);
  return g;
}

// A small flower: a stem and a flat head of petals round a yellow middle.
function flower() {
  const positions = [], colors = [];
  const stem = new THREE.Color(COLORS.bladeBase), petal = new THREE.Color('#ffffff'), middle = new THREE.Color('#f2c94c');
  const tri = (a, b, c, col) => { positions.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) colors.push(col.r, col.g, col.b); };
  tri([-0.012, 0, 0], [0.012, 0, 0], [0, 0.3, 0], stem);
  tri([0, 0, -0.012], [0, 0, 0.012], [0, 0.3, 0], stem);
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * Math.PI * 2, b = a + 0.5, c = a - 0.5;
    tri([0, 0.3, 0], [Math.sin(c) * 0.07, 0.31, Math.cos(c) * 0.07], [Math.sin(b) * 0.07, 0.31, Math.cos(b) * 0.07], petal);
  }
  for (let p = 0; p < 6; p++) {
    const a = (p / 6) * Math.PI * 2, b = a + Math.PI / 3;
    tri([0, 0.315, 0], [Math.sin(a) * 0.022, 0.312, Math.cos(a) * 0.022], [Math.sin(b) * 0.022, 0.312, Math.cos(b) * 0.022], middle);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

// --- The ground ----------------------------------------------------------

// Grass over the clearing, darker under the trees, with dirt paths worn into
// it. Flat where characters walk; gently uneven among the trees.
function ground(clearing, noise) {
  const size = 110, segments = 220;
  const g = new THREE.PlaneGeometry(size, size, segments, segments).rotateX(-Math.PI / 2);
  const pos = g.attributes.position, colors = [];
  const grass = new THREE.Color(COLORS.grass), grassDark = new THREE.Color(COLORS.grassDark), floor = new THREE.Color(COLORS.forestFloor);
  const dirt = new THREE.Color(COLORS.dirt), dirtDark = new THREE.Color(COLORS.dirtDark), c = new THREE.Color();
  const halfWidth = clearing.paths[0].halfWidth;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z), edge = clearing.radiusAt(Math.atan2(x, -z));
    const open = 1 - THREE.MathUtils.smoothstep(r, edge - 1.5, edge + 2.5); // 1 in the clearing, 0 in the forest
    const n = noise(x * 0.35, 0, z * 0.35), fine = noise(x * 1.7, 3, z * 1.7);
    c.copy(grassDark).lerp(grass, 0.35 + 0.65 * n);
    c.lerp(floor, (1 - open) * 0.85);
    // The paths: bare earth down the middle, grass growing in at the edges.
    const path = 1 - THREE.MathUtils.smoothstep(clearing.pathDistance(x, z) + (fine - 0.5) * 0.7, halfWidth - 0.55, halfWidth + 0.25);
    if (path > 0) c.lerp(color.copy(dirtDark).lerp(dirt, 0.4 + 0.6 * fine), path * (0.55 + 0.45 * Math.min(1, r / edge)));
    colors.push(c.r, c.g, c.b);
    if (!clearing.isWalkable(x, z, -0.8)) pos.setY(i, (noise(x * 0.5, 9, z * 0.5) - 0.3) * 0.35 * (1 - open) * (1 - path));
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, toon({ vertexColors: true }, [175, 225, 255]));
  mesh.receiveShadow = true;
  // (Past it, as far as the backdrop, plain forest floor.)
  const beyond = new THREE.Mesh(new THREE.CircleGeometry(100, 48).rotateX(-Math.PI / 2), toon({ color: COLORS.forestFloor }, [175, 225, 255]));
  beyond.position.y = -0.05;
  return [mesh, beyond];
}

// --- The painted backdrop --------------------------------------------------

// A painting of more forest all round, hazier the further back each row of
// trees is, under the sky. It goes on the inside of a tall cylinder far away.
function backdrop(seed) {
  const random = seededRandom(seed + 999);
  const width = 4096, height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, height * 0.7);
  sky.addColorStop(0, SKY_COLOR);
  sky.addColorStop(1, '#dfe9e1');
  g.fillStyle = sky;
  g.fillRect(0, 0, width, height);
  // Rows of trees, from the furthest (palest, highest on the painting) to the
  // nearest (the colour of the haze, which the real trees fade into).
  const rows = [
    { color: '#c6d3cf', top: 0.44, size: 70 },
    { color: '#b4c5bd', top: 0.5, size: 90 },
    { color: '#a6bbae', top: 0.57, size: 115 },
    { color: HAZE_COLOR, top: 0.64, size: 140 },
  ];
  for (const row of rows) {
    g.fillStyle = row.color;
    const baseline = row.top * height;
    g.fillRect(0, baseline, width, height - baseline);
    for (let x = -row.size; x < width + row.size; x += row.size * (0.35 + 0.3 * random())) {
      const h = row.size * (0.8 + 0.9 * random()), w = row.size * (0.45 + 0.3 * random());
      // (Drawn at both edges where it wraps round, so the seam doesn't show.)
      for (const shift of [0, -width, width]) {
        const cx = x + shift;
        if (cx < -row.size * 2 || cx > width + row.size * 2) continue;
        g.beginPath();
        if (random() < 0.5) {
          // A conifer: a jagged spire.
          const tiers = 5;
          g.moveTo(cx, baseline - h);
          for (let t = 1; t <= tiers; t++) {
            const y = baseline - h + (h * t) / tiers, ww = (w * t) / tiers;
            g.lineTo(cx + ww, y);
            g.lineTo(cx + ww * 0.55, y - h * 0.05);
          }
          for (let t = tiers; t >= 1; t--) {
            const y = baseline - h + (h * t) / tiers, ww = (w * t) / tiers;
            g.lineTo(cx - ww * 0.55, y - h * 0.05);
            g.lineTo(cx - ww, y);
          }
          g.closePath();
          g.fill();
        } else {
          // A round-topped tree: a few overlapping circles.
          for (let k = 0; k < 4; k++) {
            g.beginPath();
            g.arc(cx + (random() - 0.5) * w, baseline - h * (0.55 + 0.3 * random()), w * (0.45 + 0.25 * random()), 0, Math.PI * 2);
            g.fill();
          }
          g.fillRect(cx - w * 0.6, baseline - h * 0.6, w * 1.2, h * 0.6);
        }
      }
    }
    // Haze drifting in front of each row, thicker lower down.
    const haze = g.createLinearGradient(0, baseline - row.size * 1.5, 0, height);
    haze.addColorStop(0, 'rgba(223, 233, 225, 0)');
    haze.addColorStop(1, 'rgba(223, 233, 225, 0.35)');
    g.fillStyle = haze;
    g.fillRect(0, baseline - row.size * 1.5, width, height);
  }
  g.fillStyle = HAZE_COLOR;
  g.fillRect(0, height * 0.75, width, height * 0.25);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(96, 96, 80, 64, 1, true),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  mesh.position.y = 80 * 0.5 - 20; // (the bottom well below the ground; the rows of trees at the horizon)
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

// --- Putting it together -------------------------------------------------

// Instanced copies of a shape, with its outline, at each of `places`
// ({ x, z, scale, rotation, lean? }).
function instances(geometry, material, outline, places, { shadows = true, tint = 0 } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, places.length);
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const random = seededRandom(places.length * 13 + 7);
  places.forEach((p, i) => {
    e.set(p.lean ?? 0, p.rotation, (p.lean ?? 0) * 0.7);
    q.setFromEuler(e);
    matrix.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
    mesh.setMatrixAt(i, matrix);
    if (tint) mesh.setColorAt(i, color.setScalar(1 - tint + tint * 2 * random()));
  });
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  const group = [mesh];
  if (outline) {
    const lines = new THREE.InstancedMesh(geometry, outline, places.length);
    lines.instanceMatrix = mesh.instanceMatrix;
    group.push(lines);
  }
  return group;
}

// The whole clearing: returns the group to add to the scene, and update(time)
// to call each frame (for the leaves and grass swaying).
export function createForest(clearing) {
  const group = new THREE.Group();
  group.name = 'forest';
  const noise = makeNoise(clearing.seed);
  group.add(...ground(clearing, noise), backdrop(clearing.seed));

  // Trees: four leafy shapes and four conifers.
  const bark = toon({ vertexColors: true });
  const leaves = addSway(toon({ vertexColors: true }, [120, 180, 228, 255]), 0.012, 2.5);
  const needles = addSway(toon({ vertexColors: true }, [120, 180, 228, 255]), 0.008, 2);
  const barkLine = outlineMaterial(0.025), leafLine = outlineMaterial(0.035, [0.012, 2.5]), needleLine = outlineMaterial(0.035, [0.008, 2]);
  for (const kind of ['leafy', 'conifer']) {
    for (let variant = 0; variant < 4; variant++) {
      const places = clearing.trees.filter((t) => (t.conifer ? 'conifer' : 'leafy') === kind && t.variant === variant);
      if (!places.length) continue;
      const shape = kind === 'leafy' ? leafyTree(variant + 1) : conifer(variant + 1);
      group.add(...instances(shape.wood, bark, barkLine, places));
      group.add(...instances(shape.leaves, kind === 'leafy' ? leaves : needles, kind === 'leafy' ? leafLine : needleLine, places, { tint: 0.12 }));
    }
  }

  // Bushes and rocks.
  const bushLeaves = addSway(toon({ vertexColors: true }, [120, 180, 228, 255]), 0.02, 0.3);
  const bushLine = outlineMaterial(0.02, [0.02, 0.3]);
  for (let variant = 0; variant < 3; variant++) {
    const places = clearing.bushes.filter((b) => b.variant === variant);
    if (places.length) group.add(...instances(bush(variant + 1), bushLeaves, bushLine, places, { tint: 0.1 }));
  }
  if (clearing.rocks.length) group.add(...instances(rock(3), toon({ vertexColors: true }), outlineMaterial(0.02), clearing.rocks, { tint: 0.08 }));

  // Grass tufts everywhere but the paths (thinner under the trees), and a
  // scattering of flowers in the clearing.
  const random = seededRandom(clearing.seed + 5);
  const tufts = [], flowers = [];
  const reach = 17 + clearing.forestDepth;
  for (let tries = 0; tries < 16000 && tufts.length < 5200; tries++) {
    const x = (random() * 2 - 1) * reach, z = (random() * 2 - 1) * reach;
    const r = Math.hypot(x, z), edge = clearing.radiusAt(Math.atan2(x, -z));
    if (r > edge + clearing.forestDepth) continue;
    if (clearing.pathDistance(x, z) < clearing.paths[0].halfWidth - 0.35 + random() * 0.6) continue;
    if (r > edge && random() < 0.55) continue;
    tufts.push({ x, z, scale: 0.7 + random() * 0.8, rotation: random() * Math.PI * 2 });
    if (r < edge - 1 && random() < 0.05) flowers.push({ x: x + 0.1, z: z + 0.1, scale: 0.8 + random() * 0.5, rotation: random() * Math.PI * 2 });
  }
  const grass = addSway(toon({ vertexColors: true, side: THREE.DoubleSide }, [175, 225, 255]), 0.12, 0, 2.2);
  group.add(...instances(grassTuft(), grass, null, tufts, { shadows: false, tint: 0.15 }));
  const petals = addSway(toon({ vertexColors: true, side: THREE.DoubleSide }, [175, 225, 255]), 0.1, 0, 2.2);
  const flowerMesh = instances(flower(), petals, null, flowers, { shadows: false })[0];
  const palette = ['#ffffff', '#fff2a8', '#e3c9f2', '#ffd1dc'].map((c) => new THREE.Color(c));
  flowers.forEach((_, i) => flowerMesh.setColorAt(i, palette[Math.floor(random() * palette.length)]));
  group.add(flowerMesh);

  return {
    group,
    update(seconds) { time.value = seconds; },
  };
}
