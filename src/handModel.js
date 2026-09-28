// Hand model: a detailed hand sculpted in code (palm, thenar and hypothenar
// pads, knuckles, a thumb and four three-part fingers in a relaxed curl), with
// palm lines, finger-joint creases and fingernails drawn on by the shader.
// Part of the renderer (used by characterModel.js); it only draws.
//
// The hand is built for the character's right hand, in its own frame:
//   origin at the wrist, fingers pointing down (-y), palm facing -x (towards
//   the body), thumb towards -z (forwards). The left hand is a mirror image.
import * as THREE from '../node_modules/three/build/three.module.js';
import { meshFromDistance, smoothUnion } from './sculptedSurface.js';

const HAND_DETAIL = 0.0017; // sampling size: much finer than the body, for the fingers
const HAND_BOUNDS = { min: [-0.045, -0.175, -0.078], max: [0.032, 0.025, 0.05] };
const OUTLINE_THICKNESS = 0.0022; // thinner than the body's, to suit the fingers

// --- Layout --------------------------------------------------------------

// Each finger: knuckle position, radius at the knuckle / middle / end joints,
// segment lengths, sideways fan and extra curl. Index, middle, ring, pinky.
const FINGERS = [
  { z: -0.025,  y: -0.092, r: [0.0080, 0.0072, 0.0064], len: [0.032, 0.021, 0.018], fan: -0.06,  curl: 0 },
  { z: -0.0082, y: -0.094, r: [0.0082, 0.0074, 0.0066], len: [0.035, 0.023, 0.019], fan: -0.015, curl: 0 },
  { z: 0.0082,  y: -0.093, r: [0.0078, 0.0070, 0.0063], len: [0.033, 0.022, 0.018], fan: 0.03,   curl: 0.05 },
  { z: 0.0235,  y: -0.088, r: [0.0068, 0.0062, 0.0056], len: [0.026, 0.017, 0.016], fan: 0.08,   curl: 0.1 },
];
// Relaxed pose: how far each finger bends towards the palm at each joint (radians).
const FINGER_BEND = [0.2, 0.35, 0.25];
// How much slimmer the fingers are at their joints than mid-segment.
const FINGER_JOINT_PINCH = 0.05;
// Fingertips: how much narrower the tip gets, and how flat its end is (1 = round).
const TIP_TAPER = 0.28;
const TIP_FLATTEN = 1.7;
// How far the tip's end is shifted towards the nail side (0 = centred, 1 = the nail side stays straight).
const TIP_NAIL_SHIFT = 0.9;
// How much the fingers are webbed together next to the knuckles.
const FINGER_WEB = 0.0065;
// How far up the hand (towards the wrist) the knuckles sit above the finger roots.
const KNUCKLE_RAISE = 0.006;
// Where each finger's first segment starts, relative to its knuckle: at the
// back edge of the end of the palm (towards the back of the hand).
const FINGER_ROOT_OFFSET = [0.004, 0.006, 0];
// Half-width of the hand at the knuckle row (the sides are kept within it).
const HAND_SIDE_LIMIT = 0.035;

// Thumb: three bones branching from the base of the palm, angled forwards
// and towards the palm side, clear of the index finger. The first (the
// metacarpal) is inside the thenar pad; the other two are free.
const THUMB = [
  { a: [-0.006, -0.02, -0.021], b: [-0.017, -0.047, -0.041], ra: 0.0105, rb: 0.0086 },
  { a: [-0.017, -0.047, -0.041], b: [-0.0273, -0.0728, -0.0539], ra: 0.0084, rb: 0.0077 },
  { a: [-0.0273, -0.0728, -0.0539], b: [-0.034, -0.0954, -0.0592], ra: 0.0075, rb: 0.0068 },
];
const THUMB_NAIL_FACING = [0.35, 0, -0.94];
const THUMB_BACK = normalize(THUMB_NAIL_FACING); // the back (nail side) of the thumb

// Palm lines, as curves across the palm in (z, y): [start, bend, end].
const PALM_LINES = [
  [[0.036, -0.086], [0.01, -0.078], [-0.016, -0.094]],   // heart line
  [[-0.034, -0.074], [-0.005, -0.07], [0.028, -0.062]],  // head line
  [[-0.033, -0.073], [-0.012, -0.052], [-0.012, -0.014]], // life line (around the thenar pad)
  [[-0.02, -0.012], [0, -0.009], [0.022, -0.012]],       // wrist crease
];
const LINE_POINTS = 6; // each curve is drawn as a chain of this many points

function add(a, b, s = 1) { return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]; }
function normalize(v) { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

// Works out where every finger segment, joint crease and nail is.
function handLayout() {
  const segments = [];     // { finger, a, b, ra, rb, tip }
  const creases = [];      // { pos, axis, palm, r }
  const nails = [];        // { a, b, back, r }
  FINGERS.forEach((f, fi) => {
    let start = [-0.001, f.y, f.z];
    let bend = 0;
    const dirs = [];
    for (let s = 0; s < 3; s++) {
      bend += FINGER_BEND[s] + f.curl;
      // Down the finger, bending towards the palm (-x), fanning slightly apart.
      const dir = normalize([-Math.sin(bend), -Math.cos(bend), f.fan]);
      const palm = normalize([-Math.cos(bend), Math.sin(bend), 0]);
      const end = add(start, dir, f.len[s]);
      const ra = f.r[s], rb = s < 2 ? f.r[s + 1] : f.r[2] * 0.92;
      // The first segment starts at the back edge of the palm's end, under the
      // knuckle, so only the knuckle makes a bump on the back of the hand.
      const a = s === 0 ? add(start, FINGER_ROOT_OFFSET) : start;
      segments.push({ finger: fi, a, b: end, ra, rb, tip: s === 2 ? palm.map((v) => -v) : null });
      dirs.push({ dir, palm, start, end, r: ra });
      start = end;
    }
    // Creases on the palm side: where the finger meets the palm, and at the two joints.
    creases.push({ pos: add(dirs[0].start, dirs[0].dir, 0.007), axis: dirs[0].dir, palm: dirs[0].palm, r: dirs[0].r });
    for (const s of [1, 2]) {
      creases.push({
        pos: dirs[s].start,
        axis: normalize(add(dirs[s - 1].dir, dirs[s].dir)),
        palm: normalize(add(dirs[s - 1].palm, dirs[s].palm)),
        r: dirs[s].r,
      });
    }
    // Nail on the back of the last segment.
    nails.push({ a: dirs[2].start, b: dirs[2].end, back: dirs[2].palm.map((v) => -v), r: dirs[2].r });
  });
  const tip = THUMB[2];
  nails.push({ a: tip.a, b: tip.b, back: normalize(THUMB_NAIL_FACING), r: tip.rb });

  const palmLines = PALM_LINES.flatMap(([p0, p1, p2]) => Array.from({ length: LINE_POINTS }, (_, i) => {
    const t = i / (LINE_POINTS - 1), u = 1 - t;
    return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
  }));
  return { segments, creases, nails, palmLines };
}

const LAYOUT = handLayout();

// --- Sculpt --------------------------------------------------------------

function ellipsoid(x, y, z, [cx, cy, cz], [rx, ry, rz]) {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.hypot(px, py, pz);
  const k1 = Math.hypot(px / rx, py / ry, pz / rz);
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function roundBox(x, y, z, [cx, cy, cz], [bx, by, bz], round) {
  const qx = Math.abs(x - cx) - bx, qy = Math.abs(y - cy) - by, qz = Math.abs(z - cz) - bz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - round;
}

// A rounded segment whose radius changes from ra to rb along its length.
// pinch (0-1) narrows the ends compared with the middle, e.g. at finger joints;
// tip: for a fingertip, the direction its nail faces; the far end is then
// tapered, sloping in from the pad side towards the nail side.
function taperedCapsule(x, y, z, a, b, ra, rb, pinch = 0, tip = null) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const px = x - a[0], py = y - a[1], pz = z - a[2];
  const len2 = bx * bx + by * by + bz * bz;
  const h = Math.min(Math.max((px * bx + py * by + pz * bz) / len2, 0), 1);
  const middle = tip && h > 0.5 ? 1 : Math.sin(Math.PI * h);
  let r = (ra + (rb - ra) * h) * (1 - pinch * (1 - middle));
  let dx = px - bx * h, dy = py - by * h, dz = pz - bz * h;
  if (tip) {
    // Fingertip: tapers in straight lines towards a flatter, rounded-off end
    // (a trapezoid with rounded corners, rather than a round bullet tip).
    const shrink = r * TIP_TAPER * Math.max(0, (h - 0.4) / 0.6);
    r -= shrink;
    // Move the centre towards the nail by the same amount, so the nail side
    // stays straight and only the pad side slopes in.
    dx -= tip[0] * shrink * TIP_NAIL_SHIFT; dy -= tip[1] * shrink * TIP_NAIL_SHIFT; dz -= tip[2] * shrink * TIP_NAIL_SHIFT;
    const len = Math.sqrt(len2);
    const along = (dx * bx + dy * by + dz * bz) / len; // how far past the end
    if (along > 0) {
      const scale = TIP_FLATTEN - 1;
      dx += (bx / len) * along * scale; dy += (by / len) * along * scale; dz += (bz / len) * along * scale;
    }
  }
  return Math.hypot(dx, dy, dz) - r;
}

// Distance from the surface of the (right) hand.
function handDistance(x, y, z) {
  // Palm: narrower at the wrist than across the knuckles.
  const widen = 0.82 + 0.18 * Math.min(Math.max((-0.02 - y) / 0.07, 0), 1);
  let d = roundBox(x, y, z / widen, [-0.002, -0.054, 0], [0.001, 0.030, 0.022], 0.011) * Math.min(widen, 1);
  d = smoothUnion(d, ellipsoid(x, y, z, [0.0, -0.058, 0], [0.011, 0.04, 0.032]), 0.011); // gently domed back of the hand
  d = smoothUnion(d, ellipsoid(x, y, z, [0, -0.004, 0], [0.015, 0.02, 0.019]), 0.012); // wrist
  // Pads on the palm side: the thenar pad at the base of the thumb, the
  // hypothenar pad along the opposite edge, and the padded ridge under the
  // finger bases; the hollow of the palm is left between them.
  d = smoothUnion(d, ellipsoid(x, y, z, [-0.01, -0.04, -0.025], [0.01, 0.025, 0.013]), 0.011);  // thenar
  d = smoothUnion(d, ellipsoid(x, y, z, [-0.008, -0.056, 0.023], [0.008, 0.032, 0.01]), 0.01);   // hypothenar
  d = smoothUnion(d, ellipsoid(x, y, z, [-0.008, -0.086, 0.0], [0.0055, 0.011, 0.032]), 0.011);  // under the fingers
  // Knuckles, with shallow grooves between them so they read as separate bumps.
  for (const f of FINGERS) {
    d = smoothUnion(d, ellipsoid(x, y, z, [0.0045, f.y + KNUCKLE_RAISE, f.z], [0.0055, 0.0065, 0.0065]), 0.004);
  }
  for (let i = 0; i < FINGERS.length - 1; i++) {
    const gz = (FINGERS[i].z + FINGERS[i + 1].z) / 2;
    const gy = (FINGERS[i].y + FINGERS[i + 1].y) / 2;
    d = -smoothUnion(-d, ellipsoid(x, y, z, [0.015, gy + KNUCKLE_RAISE - 0.007, gz], [0.0045, 0.011, 0.0055]), 0.006);
  }
  // Hollow in the middle of the palm, between the pads (carved in, so the
  // pads stand out without the palm getting any thicker).
  d = -smoothUnion(-d, ellipsoid(x, y, z, [-0.018, -0.061, 0.002], [0.0085, 0.022, 0.012]), 0.006);

  // The thumb's metacarpal blends into the thenar pad (forming the web of the
  // thumb); the two free segments only join the thumb itself, so they stay distinct.
  const [meta, ...free] = THUMB.map((t, i) => taperedCapsule(x, y, z, t.a, t.b, t.ra, t.rb, 0, i === THUMB.length - 1 ? THUMB_BACK : null));
  d = smoothUnion(d, meta, 0.008);
  let thumb = meta;
  for (const segment of free) thumb = smoothUnion(thumb, segment, 0.003);

  // Fingers stay separate from each other, except right by the knuckles where
  // they're webbed together (otherwise the narrow slit between them lets the
  // outline show through as dots). They also blend into the palm.
  const web = FINGER_WEB * Math.min(Math.max((y + 0.1) / 0.008, 0), 1);
  let fingers = Infinity;
  for (let fi = 0; fi < FINGERS.length; fi++) {
    let finger = 1;
    for (const s of LAYOUT.segments) {
      if (s.finger === fi) {
        finger = Math.min(finger, taperedCapsule(x, y, z, s.a, s.b, s.ra, s.rb, FINGER_JOINT_PINCH, s.tip));
      }
    }
    fingers = web > 1e-4 && fingers !== Infinity ? smoothUnion(fingers, finger, web) : Math.min(fingers, finger);
  }
  d = smoothUnion(d, fingers, 0.008); // eases the palm-side step into the fingers

  // Keep the index-finger and little-finger edges of the hand straight past
  // the knuckle row (the finger roots would otherwise bulge out sideways).
  // The knuckles still stand out on the back of the hand.
  const sideLimit = HAND_SIDE_LIMIT + Math.max(0, y + 0.07);
  d = -smoothUnion(-d, sideLimit - Math.abs(z), 0.003);

  return Math.min(d, thumb); // the thumb is added last, so the limit doesn't touch it
}

const geometryCache = new Map(); // side + build -> geometry
const GEOMETRY_CACHE_SIZE = 8;

// The hand's mesh, including the lower forearm blended into the wrist.
// `sign` is +1 for the right hand and -1 for the left; `wrist` describes the
// forearm (see createHand).
function handGeometry(sign, wrist) {
  const key = `${sign}:${wrist.key}`;
  let geometry = geometryCache.get(key);
  if (!geometry) {
    const [sx, sy, sz] = wrist.scale;
    const top = (wrist.top - wrist.offsetY) / sy; // top of the forearm stub, in hand coordinates
    const bounds = {
      min: [sign > 0 ? HAND_BOUNDS.min[0] : -HAND_BOUNDS.max[0], HAND_BOUNDS.min[1], HAND_BOUNDS.min[2]],
      max: [sign > 0 ? HAND_BOUNDS.max[0] : -HAND_BOUNDS.min[0], top, HAND_BOUNDS.max[2]],
    };
    const distanceScale = Math.min(sx, sy, sz);
    geometry = meshFromDistance((x, y, z) => {
      const hand = handDistance(sign * x, y, z);
      const arm = wrist.forearm(x * sx, wrist.offsetY + y * sy, z * sz) / distanceScale;
      return smoothUnion(hand, arm, wrist.blend / distanceScale);
    }, bounds, HAND_DETAIL);
    geometry.userData.cached = true;
    geometry.userData.top = top;
    geometryCache.set(key, geometry);
    if (geometryCache.size > GEOMETRY_CACHE_SIZE) {
      const [oldestKey, oldest] = geometryCache.entries().next().value;
      geometryCache.delete(oldestKey);
      oldest.dispose();
    }
  }
  return geometry;
}

// --- Palm lines, creases and nails ----------------------------------------

function v3(a) { return new THREE.Vector3(...a); }

// Adds the drawn-on details to a (toon) skin material.
function addHandDetails(material, sign, lineColor) {
  const uniforms = {
    handMirror: { value: sign },
    palmLines: { value: LAYOUT.palmLines.map(([z, y]) => new THREE.Vector2(z, y)) },
    creasePos: { value: LAYOUT.creases.map((c) => v3(c.pos)) },
    creaseAxis: { value: LAYOUT.creases.map((c) => v3(c.axis)) },
    creasePalm: { value: LAYOUT.creases.map((c) => v3(c.palm)) },
    creaseR: { value: LAYOUT.creases.map((c) => c.r) },
    nailA: { value: LAYOUT.nails.map((n) => v3(n.a)) },
    nailB: { value: LAYOUT.nails.map((n) => v3(n.b)) },
    nailBack: { value: LAYOUT.nails.map((n) => v3(n.back)) },
    nailR: { value: LAYOUT.nails.map((n) => n.r) },
    handLineColor: { value: new THREE.Color(lineColor) },
  };
  const lines = PALM_LINES.length, creases = LAYOUT.creases.length, nails = LAYOUT.nails.length;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec3 vHandPos;
varying vec3 vHandNormal;
${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vHandPos = position;
  vHandNormal = normal;`)}`;
    shader.fragmentShader = `uniform float handMirror;
uniform vec2 palmLines[${lines * LINE_POINTS}];
uniform vec3 creasePos[${creases}];
uniform vec3 creaseAxis[${creases}];
uniform vec3 creasePalm[${creases}];
uniform float creaseR[${creases}];
uniform vec3 nailA[${nails}];
uniform vec3 nailB[${nails}];
uniform vec3 nailBack[${nails}];
uniform float nailR[${nails}];
uniform vec3 handLineColor;
varying vec3 vHandPos;
varying vec3 vHandNormal;

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// How much ink a line of half-width w leaves at distance d: crisp at any
// distance, and fading out (rather than vanishing abruptly) once thinner than a pixel.
float ink(float d, float w) {
  float px = fwidth(d) + 1e-6;
  return (1.0 - smoothstep(w, w + px, d)) * clamp(w / px, 0.15, 1.0);
}
${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    // Work in the right hand's frame (the left hand is mirrored).
    vec3 p = vec3(vHandPos.x * handMirror, vHandPos.yz);
    vec3 n = normalize(vec3(vHandNormal.x * handMirror, vHandNormal.yz));
    float line = 0.0;

    // Palm lines, on the palm side only.
    if (n.x < -0.35 && p.x < -0.008) {
      float d = 1.0;
      for (int l = 0; l < ${lines}; l++) {
        for (int i = 0; i < ${LINE_POINTS - 1}; i++) {
          d = min(d, segmentDistance(p.zy, palmLines[l * ${LINE_POINTS} + i], palmLines[l * ${LINE_POINTS} + i + 1]));
        }
      }
      line = max(line, ink(d, 0.0005));
    }

    // Creases across the palm side of each finger joint.
    for (int j = 0; j < ${creases}; j++) {
      vec3 q = p - creasePos[j];
      float t = dot(q, creaseAxis[j]);
      float r = length(q - t * creaseAxis[j]);
      if (r < creaseR[j] * 1.25 && dot(n, creasePalm[j]) > 0.35) line = max(line, ink(abs(t), 0.0004));
    }

    // Fingernails: the back of the last segment of each finger, with a thin edge.
    float nail = 0.0, nailEdge = 0.0;
    for (int f = 0; f < ${nails}; f++) {
      vec3 ab = nailB[f] - nailA[f];
      float t = dot(p - nailA[f], ab) / dot(ab, ab);
      float r = length(p - nailA[f] - ab * clamp(t, 0.0, 1.0));
      if (r > nailR[f] * 1.4 || t < 0.3 || t > 1.25) continue; // only on this fingertip
      float facing = dot(n, nailBack[f]);
      float m = smoothstep(0.5, 0.56, facing) * smoothstep(0.45, 0.5, t);
      nail = max(nail, m);
      // Thin edge along the sides and base of the nail.
      float edge = min(abs(facing - 0.53) * 0.02, abs(t - 0.475) * length(ab));
      nailEdge = max(nailEdge, ink(edge, 0.0004) * step(0.5, facing) * step(0.45, t));
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 0.98, 0.98) + vec3(0.07), nail * 0.7);
    diffuseColor.rgb = mix(diffuseColor.rgb, handLineColor, clamp(line * 0.45 + nailEdge * 0.3, 0.0, 1.0));
  }`)}`;
  };
  material.customProgramCacheKey = () => `hand-${sign}`;
  return material;
}

// Outline: thin around the hand, thickening up the forearm stub to match the
// body's outline where the two meet.
function handOutlineMaterial(lineColor, top, armThickness) {
  const mat = new THREE.MeshBasicMaterial({
    color: lineColor, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  // ...and fading out at the very top, where the body's own outline takes over.
  float thickness = mix(${OUTLINE_THICKNESS.toFixed(4)}, ${armThickness.toFixed(4)},
    smoothstep(0.0, ${(top * 0.6).toFixed(4)}, position.y))
    * (1.0 - smoothstep(${(top * 0.75).toFixed(4)}, ${top.toFixed(4)}, position.y));
  transformed += normalize(normal) * thickness;`);
  };
  mat.customProgramCacheKey = () => `hand-outline-${top.toFixed(4)}-${armThickness.toFixed(4)}`;
  return mat;
}

// A finished hand: `skinMaterial` is a toon material in the skin colour; the
// hand's origin is the wrist. `sign`: +1 for the right hand, -1 for the left.
// `wrist` describes the forearm it joins onto:
//   forearm: the forearm's distance function, in forearm coordinates
//   offsetY: where the wrist is, in forearm coordinates
//   scale:   the hand's [x, y, z] scale relative to the forearm
//   top:     how far up the forearm (forearm coordinates) the hand's mesh reaches
//   blend:   how widely the wrist is smoothed into the forearm
//   outline: the body's outline thickness, which the hand's outline matches at the top
//   key:     identifies the forearm's shape, for reusing meshes
// The hand can bend at the wrist: set hand.userData.wristBend (x, y, z
// rotations, radians; x bends it towards the palm, z sideways).
export function createHand({ sign, skinMaterial, lineColor, wrist }) {
  const geometry = handGeometry(sign, wrist);
  const bend = { value: new THREE.Vector3() };
  const top = geometry.userData.top;
  const hand = new THREE.Mesh(geometry, bendAtWrist(addHandDetails(skinMaterial, sign, lineColor), bend, top));
  hand.castShadow = true;
  const armThickness = wrist.outline / Math.min(...wrist.scale);
  hand.add(new THREE.Mesh(geometry, bendAtWrist(handOutlineMaterial(lineColor, top, armThickness), bend, top)));
  hand.userData.wristBend = bend.value;
  hand.userData.bendWrist = (material) => bendAtWrist(material, bend, top); // (for anything drawn over the hand)
  return hand;
}

// Bends a hand material's mesh at the wrist: the hand turns about the wrist,
// easing into the bend over the wrist itself, so the stub of forearm above it
// stays in line with the arm (and the join stays hidden).
function bendAtWrist(material, bend, top) {
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before?.(shader, renderer);
    shader.uniforms.wristBend = bend;
    shader.vertexShader = `uniform vec3 wristBend;
mat3 wristRotation(float y) {
  // (Full below the wrist, fading to none up the stub.)
  vec3 a = wristBend * (1.0 - smoothstep(-0.03, ${(top * 0.7).toFixed(4)}, y));
  float cx = cos(a.x), sx = sin(a.x), cy = cos(a.y), sy = sin(a.y), cz = cos(a.z), sz = sin(a.z);
  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  mat3 ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  mat3 rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
  return rx * ry * rz;
}
${shader.vertexShader
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  objectNormal = wristRotation(position.y) * objectNormal;`)
    .replace('#include <project_vertex>', `transformed = wristRotation(position.y) * transformed;
  #include <project_vertex>`)}`;
  };
  return material;
}
