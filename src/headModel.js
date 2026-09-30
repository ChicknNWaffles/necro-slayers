// Head model: a head sculpted in code -- skull, jaw (with real jaw angles
// tapering to a pointed chin), cheekbones, brow ridge, eye sockets with
// eyelids, nose, lips and anatomical ears -- plus separate eyeballs whose
// irises are coloured on. Eyebrows and blush are coloured onto the skin.
// Part of the renderer (used by characterModel.js); it only draws.
//
// Built around the centre of the skull, in units of the head radius R, facing
// -z (the character's right is +x). The caller scales it by R.
import * as THREE from '../node_modules/three/build/three.module.js';
import { registerGeometryCache } from './geometryCaches.js';
import { meshFromDistance, smoothUnion } from './sculptedSurface.js';

const DETAIL = 0.014;  // sampling size, in head radii
const BOUNDS = { min: [-1.1, -1.7, -1.25], max: [1.1, 1.15, 1.2] };

// Eyes: centre of each eyeball (right eye; the left is mirrored) and its radius.
const EYE = { x: 0.36, y: -0.15, z: -0.72, radius: 0.2, yaw: 0.3, widen: 1.18 };
// Radius of the top of the neck (in head radii), just inside the body's neck.
const NECK_RADIUS = 0.36;

// --- Shape helpers (all distances in head radii) ---------------------------

function ellipsoid(x, y, z, [cx, cy, cz], [rx, ry, rz]) {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.hypot(px, py, pz);
  const k1 = Math.hypot(px / rx, py / ry, pz / rz);
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function capsule(x, y, z, a, b, ra, rb) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const px = x - a[0], py = y - a[1], pz = z - a[2];
  const h = Math.min(Math.max((px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz), 0), 1);
  return Math.hypot(px - bx * h, py - by * h, pz - bz * h) - (ra + (rb - ra) * h);
}

// The overlap of a and b, rounding the edge over about k.
function smoothIntersect(a, b, k) {
  return -smoothUnion(-a, -b, k);
}

// Carve b out of a, rounding the edge over about k.
function smoothSubtract(a, b, k) {
  return -smoothUnion(-a, b, k);
}

// --- Parts ------------------------------------------------------------------

// Skull and face, before the eyes, nose, mouth and ears (x is mirrored, so
// only the right side is described).
// m: 0 female (softer: smaller, rounder jaw and chin, fuller cheeks, gentle
// brow), 1 male (larger, squarer jaw and chin, flatter cheeks, stronger brow).
function skullDistance(ax, y, z, m) {
  // Cranium: longer front to back than side to side.
  let d = ellipsoid(ax, y, z, [0, 0.06, 0.06], [0.88, 0.96, 1.02]);
  // Face: the mass of the cheeks and upper jaw.
  d = smoothUnion(d, ellipsoid(ax, y, z, [0, -0.38, -0.3], [0.66, 0.55, 0.6]), 0.3);
  // Mouth area: the rounded front of the teeth and jaw that the lips sit on.
  d = smoothUnion(d, ellipsoid(ax, y, z, [0, -0.8, -0.52], [0.34, 0.28, 0.32]), 0.18);
  // Cheekbones, and the soft roundness of the cheeks below them.
  // (Cheeks sit low, softening the line of the jaw; the cheekbones flow down into them.)
  const cheekbone = ellipsoid(ax, y, z, [0.49, -0.23, -0.49], [0.24, 0.15, 0.28]);
  const full = 1.04 - 0.12 * m;
  const cheek = ellipsoid(ax, y, z, [0.37, -0.64, -0.48], [0.25 * full, 0.24 * full, 0.24 * full]);
  d = smoothUnion(d, smoothUnion(cheekbone, cheek, 0.25), 0.24 - 0.06 * m);
  // Jaw: from the jaw angle below the ear forwards and down to the chin,
  // so the jaw has a corner rather than being one long triangle.
  // (The jaw angle sits forward, below the outer corners of the eyes.)
  d = smoothUnion(d, capsule(ax, y, z, [0.48 + 0.09 * m, -0.66 - 0.03 * m, -0.12], [0.58 + 0.03 * m, -0.36, 0.12], 0.15 + 0.02 * m, 0.15), 0.2 - 0.05 * m); // up to the ear
  d = smoothUnion(d, capsule(ax, y, z, [0.48 + 0.09 * m, -0.7 - 0.03 * m, -0.14], [0.13 + 0.1 * m, -1.05 - 0.02 * m, -0.61], 0.14 + 0.02 * m, 0.09 + 0.03 * m), 0.22 - 0.06 * m);  // jawline
  // Chin: coming to a point.
  // (The male chin is broader and squarer.)
  d = smoothUnion(d, ellipsoid(ax, y, z, [0, -1.06 - 0.02 * m, -0.66], [0.13 + 0.09 * m, 0.13, 0.15]), 0.12 - 0.03 * m);
  d = smoothUnion(d, ellipsoid(ax, y, z, [0, -1.12 - 0.01 * m, -0.7], [0.07 + 0.07 * m, 0.08, 0.09]), 0.06);
  // Brow ridge.
  d = smoothUnion(d, ellipsoid(ax, y, z, [0, 0.13, -0.72 - 0.03 * m], [0.5 + 0.04 * m, 0.13 + 0.02 * m, 0.28 + 0.03 * m]), 0.26 - 0.1 * m); // (blended well up into the forehead)
  // Underside: behind the jaw angle the head's underside rises steeply
  // towards the ear (the back edge of the jaw), and the back of the skull ends
  // above the neck, so the jaw's corner reads clearly from the side.
  const rising = -0.7 + (z + 0.14) * 1.5;
  const floor = smoothUnion(rising, -0.52, 0.25); // (a rounded bend where the two meet)
  d = smoothIntersect(d, floor - y, 0.3);
  return d;
}

// A point relative to the (right) eye, in the eye's own turned and widened frame.
export function eyeLocal(ax, y, z) {
  const dx = ax - EYE.x, dz = z - EYE.z;
  const c = Math.cos(EYE.yaw), s = Math.sin(EYE.yaw);
  return [(dx * c + dz * s) / EYE.widen, y - EYE.y, -dx * s + dz * c];
}

// Points along the lash, in the eye's frame (in units of the eye radius):
// [x, y, how far out from the eyeball's centre, thickness].
// Points along the lash, in the eye's frame (in units of the eye radius):
// [x, y, how far out from the eyeball's centre, thickness]. It follows the edge
// of the upper lid at an even thickness right to the outer corner of the eye...
// m: 0 female, 1 male (thinner lashes with no wing, following the squarer lid).
// droop: see lidCurve.
function lashPath(m, droop = 0) {
  const { top, upper } = lidCurve(m, droop);
  const thick = 1 - 0.55 * m;
  return Array.from({ length: 9 }, (_, i) => {
    const x = -1.1 + (2.3 * i) / 8;
    return [x, top - upper * x * x - 0.05, 1.32, (i === 0 ? 0.06 : 0.12) * thick];
  });
}

// The upper lid's edge (its height in the middle, in eye radii) and how
// strongly the upper and lower lid edges curve (lower = flatter, squarer eye).
// droop (0-1): how far the upper lid hangs down over the eye, as if it isn't
// quite open (it flattens a little as it comes down).
function lidCurve(m, droop = 0) {
  return { top: 0.52 - 0.55 * droop, upper: (0.32 - 0.15 * m) * (1 - 0.5 * droop), lower: 0.3 - 0.13 * m };
}
// ...where the wing starts: flicking up, out and tilted back round the side of
// the head -- [offset x, y, z from the corner, thickness].
const LASH_WING = [[0.1, 0.1, 0.16, 0.09], [0.16, 0.2, 0.32, 0.035]];

function lashPoint([x, y, out, t], r) {
  // On a sphere of radius out·r around the eyeball, at (x, y) across it.
  const px = x * r, py = y * r, R = out * r;
  const pz = -Math.sqrt(Math.max(R * R - px * px - py * py, 0));
  return { p: [px, py, pz], t: t * r };
}

const lashCache = new Map(); // (these are needed for every point sampled round the eyes)

function lashPoints(r, m, droop) {
  const key = `${r}:${m}:${droop}`;
  if (lashCache.has(key)) return lashCache.get(key);
  const points = lashPath(m, droop).map((q) => lashPoint(q, r));
  const end = points[points.length - 1].p;
  if (m < 0.5) for (const [dx, dy, dz, t] of LASH_WING) {
    points.push({ p: [end[0] + dx * r, end[1] + dy * r, end[2] + dz * r], t: t * r });
  }
  lashCache.set(key, points);
  return points;
}

function lashDistance(lx, ly, lz, r, m = 0, droop = 0) {
  const points = lashPoints(r, m, droop);
  let d = Infinity;
  for (let i = 1; i < points.length; i++) {
    d = Math.min(d, capsule(lx, ly, lz, points[i - 1].p, points[i].p, points[i - 1].t, points[i].t));
  }
  return d;
}

function eyeRegion(ax, y, z, es, m = 0, droop = 0) {
  const r = EYE.radius * es;
  const [lx, ly, lz] = eyeLocal(ax, y, z);
  // Socket: carved into the face in front of the eyeball.
  const socket = ellipsoid(lx, ly, lz, [0, -0.01, -0.1], [r * 1.18, r * 1.1, r * 1.0]);
  // Eyelids: a thin shell over the eyeball, above and below the opening.
  const dx = lx / r;
  const cy = 0;
  y = ly;
  const shell = Math.abs(Math.hypot(lx, ly, lz) - r * 1.08) - 0.05;
  const front = lz + 0.35 * r; // only on the front of the eyeball
  const curve = lidCurve(m, droop);
  const upperEdge = cy + r * (curve.top - curve.upper * dx * dx);
  const lowerEdge = cy - r * (0.74 - curve.lower * dx * dx); // low: a tall, stylized eye
  // (Intersections are rounded, so the lid edges are smooth rather than ragged.)
  const upperLid = smoothIntersect(smoothIntersect(shell, upperEdge - y, 0.03), front, 0.05);
  const lowerLid = smoothIntersect(smoothIntersect(shell, y - lowerEdge, 0.03), front, 0.05);
  return { socket, lids: smoothUnion(upperLid, lowerLid, 0.07), lash: lashDistance(lx, ly, lz, r, m, droop) };
}

function noseDistance(ax, y, z) {
  const top = -0.1, bottom = -0.56;
  const t = Math.min(Math.max((top - y) / (top - bottom), 0), 1); // 0 at the top, 1 at the tip
  // The ridge runs forwards as it goes down, dipping slightly in the middle
  // (a concave profile).
  const ridgeZ = -0.9 - 0.27 * t + 0.02 * Math.sin(Math.PI * t);
  // Half-width where the sides meet the face: widening towards the bottom,
  // faster near the tip (concave sides seen from the front).
  const halfWidth = 0.03 + 0.1 * (0.75 * t + 0.25 * t * t);
  const depth = 0.3; // how far back from the ridge the sides reach
  const k = depth / halfWidth;
  const side = (k * ax - (z - ridgeZ)) / Math.hypot(k, 1);
  const under = bottom - y; // flat underside
  const above = y - top;
  let d = smoothIntersect(side, under, 0.025);
  d = smoothIntersect(d, above, 0.05);
  return Math.max(d, z + 0.6); // stops inside the face
}

function mouthDistance(ax, y, z) {
  const upper = ellipsoid(ax, y, z, [0, -0.79, -0.79], [0.15, 0.042, 0.06]);
  const lower = ellipsoid(ax, y, z, [0, -0.875, -0.77], [0.12, 0.048, 0.06]);
  const slit = ellipsoid(ax, y, z, [0, -0.832, -0.83], [0.14, 0.01, 0.08]);
  return { lips: smoothUnion(upper, lower, 0.03), slit };
}

// One ear (right side), in the ear's own frame: u outwards, v up, w backwards.
function earDistance(ax, y, z) {
  const tilt = 0.25; // the top of the ear leans back
  const px = ax - 0.82, py = y + 0.22, pz = z - 0.1;
  const flare = 0.45; // turned so the front sits flush with the head and the back flares out
  const roll = 0.28;  // and tilted so the top leans out while the bottom meets the head
  const u1 = px * Math.cos(flare) - pz * Math.sin(flare);
  const w0 = px * Math.sin(flare) + pz * Math.cos(flare);
  const v1 = py * Math.cos(tilt) + w0 * Math.sin(tilt);
  const u = u1 * Math.cos(roll) - v1 * Math.sin(roll);
  const v = u1 * Math.sin(roll) + v1 * Math.cos(roll);
  const w = -py * Math.sin(tilt) + w0 * Math.cos(tilt);

  let d = ellipsoid(u, v, w, [0.03, 0.02, 0], [0.045, 0.27, 0.17]); // the ear's body
  // Helix: the rolled outer rim, round the top and back.
  const rim = Math.hypot(v / 0.27, w / 0.17);
  const helix = smoothIntersect(Math.hypot((rim - 1) * 0.2, u - 0.07) - 0.032, -(v + 0.12) - Math.max(w, 0), 0.04);
  d = smoothUnion(d, helix, 0.02);
  // Antihelix: the inner ridge.
  const inner = Math.hypot((v - 0.02) / 0.17, (w + 0.01) / 0.1);
  const antihelix = smoothIntersect(Math.hypot((inner - 1) * 0.12, u - 0.07) - 0.02, -(v + 0.05), 0.03);
  d = smoothUnion(d, antihelix, 0.015);
  // Earlobe and tragus.
  d = smoothUnion(d, ellipsoid(u, v, w, [0.045, -0.24, 0.02], [0.038, 0.08, 0.065]), 0.05);
  d = smoothUnion(d, ellipsoid(u, v, w, [0.06, -0.07, -0.14], [0.03, 0.05, 0.035]), 0.02);
  // Concha: the bowl leading into the ear.
  d = smoothSubtract(d, ellipsoid(u, v, w, [0.11, -0.07, -0.03], [0.06, 0.1, 0.08]), 0.025);
  return d;
}

function headDistance(x, y, z, es, m = 0, droop = 0) {
  const ax = Math.abs(x);
  let d = skullDistance(ax, y, z, m);
  const eye = eyeRegion(ax, y, z, es, m, droop);
  d = smoothSubtract(d, eye.socket, 0.08);
  d = smoothUnion(d, eye.lids, 0.09); // (wide, so the thin lid corners are filled in)
  d = smoothUnion(d, eye.lash, 0.012);
  d = smoothUnion(d, noseDistance(ax, y, z), 0.05);
  const mouth = mouthDistance(ax, y, z);
  d = smoothUnion(d, mouth.lips, 0.04);
  d = smoothSubtract(d, mouth.slit, 0.012);
  d = smoothUnion(d, earDistance(ax, y, z), 0.05);
  // Submental region: the soft underside of the jaw, from the chin back to the neck.
  d = smoothUnion(d, capsule(ax, y, z, [0, -1.02, -0.5], [0, -1.02, -0.05], 0.1, 0.16), 0.2);
  // Nape: the back of the head curving down into the back of the neck.
  d = smoothUnion(d, capsule(ax, y, z, [0, -0.4, 0.5], [0, -0.95, 0.28], 0.26, 0.22), 0.3);
  // Top of the neck.
  d = smoothUnion(d, capsule(ax, y, z, [0, -0.3, 0.11], [0, -1.5, 0.23], NECK_RADIUS, NECK_RADIUS), 0.28);
  return d;
}

const cache = registerGeometryCache('heads'); // eye size -> geometry

// The head's skin mesh, scaled to head radius R. m: body type (0 female, 1
// male); droop: how far the upper eyelids hang down (0-1, see lidCurve).
export function headGeometry(eyeSize, R, m = 0, droop = 0) {
  const key = eyeSize.toFixed(3) + ':' + R + ':' + m + ':' + droop;
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = meshFromDistance((x, y, z) => headDistance(x, y, z, eyeSize, m, droop), BOUNDS, DETAIL);
    const pos = geometry.attributes.position;
    const lash = new Float32Array(pos.count);
    const r = EYE.radius * eyeSize;
    for (let i = 0; i < pos.count; i++) {
      const [lx, ly, lz] = eyeLocal(Math.abs(pos.getX(i)), pos.getY(i), pos.getZ(i));
      lash[i] = 1 - Math.min(Math.max(lashDistance(lx, ly, lz, r, m, droop) / 0.012, 0), 1);
    }
    geometry.setAttribute('lashMask', new THREE.Float32BufferAttribute(lash, 1));
    geometry.scale(R, R, R);
    geometry.userData.cached = true;
    cache.set(key, geometry);
  }
  return geometry;
}

// Where each eyeball goes, and its radius (in head radii).
export function eyePlacement(eyeSize) {
  const radius = EYE.radius * eyeSize;
  return {
    radius, yaw: EYE.yaw, widen: EYE.widen,
    eyes: [{ sign: -1, centre: [-EYE.x, EYE.y, EYE.z] }, { sign: 1, centre: [EYE.x, EYE.y, EYE.z] }],
  };
}

// --- Colouring --------------------------------------------------------------

// Adds eyebrows, blush and freckles to the head's skin material (a toon material).
// blush, freckles: how strong they are (0 = none, 1 = strongest).
// Work in display-space HSL, then convert back to the shader's linear colour.
export function blushColour(skin) {
  const hsl = skin.getHSL({}, THREE.SRGBColorSpace);
  const warm = THREE.MathUtils.clamp((hsl.h - 0.045) / 0.085, 0, 1);
  const hue = THREE.MathUtils.lerp(0.015, 0.07, warm);
  const saturation = THREE.MathUtils.clamp(hsl.s * 1.25 + 0.22, 0.58, 0.9);
  const lightness = hsl.l > 0.5 ? hsl.l * 0.73 : hsl.l * 1.12;
  return new THREE.Color().setHSL(hue, saturation, lightness, THREE.SRGBColorSpace);
}

export function addFaceColour(material, browColor, R, eyeSize, { blush = 0.3, freckles = 0 } = {}) {
  const uniforms = {
    browColor: { value: new THREE.Color(browColor) }, headRadius: { value: R }, eyeSize: { value: eyeSize },
    blushColor: { value: blushColour(material.color) }, blushAmount: { value: blush }, freckleAmount: { value: freckles },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float lashMask;
varying float vLash;
varying vec3 vHeadPos;
varying vec3 vHeadNormal;
${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vHeadPos = position;
  vHeadNormal = normal;
  vLash = lashMask;`)}`;
    shader.fragmentShader = `uniform vec3 browColor;
uniform float headRadius;
uniform float eyeSize;
uniform vec3 blushColor;
uniform float blushAmount;
uniform float freckleAmount;
varying float vLash;
varying vec3 vHeadPos;
varying vec3 vHeadNormal;
${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 p = vHeadPos / headRadius;
    float ax = abs(p.x);
    float facing = -normalize(vHeadNormal).z; // 1 on the front of the face
    // Blush on the cheeks.
    float blush = exp(-(pow((ax - 0.42) / 0.14, 2.0) + pow((p.y + 0.33) / 0.09, 2.0))) * step(0.3, facing);
    diffuseColor.rgb = mix(diffuseColor.rgb, blushColor, blush * blushAmount);
    // Freckles: small, uneven dots scattered over the nose and cheeks, one
    // (or none) in each cell of a grid, fading out towards the edges.
    if (freckleAmount > 0.0) {
      vec2 q = p.xy * 30.0;
      vec2 cell = floor(q);
      vec2 rnd = fract(sin(vec2(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)))) * 43758.5453);
      float size = 0.14 + 0.14 * fract(rnd.x * 7.13);
      float dotShape = 1.0 - smoothstep(size * 0.7, size, length(q - cell - 0.2 - 0.6 * rnd));
      float area = exp(-(pow(p.x / 0.5, 2.0) + pow((p.y + 0.3) / 0.14, 2.0))) * step(0.45, facing);
      float freckle = dotShape * step(1.0 - freckleAmount * area * 1.6, fract(rnd.y * 3.7));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.55, 0.42), freckle * 0.75);
    }
    // Eyebrows: thin arcs above the eyes, thinning towards the outer ends.
    float t = (ax - ${EYE.x.toFixed(3)}) / 0.24;
    float browY = ${(EYE.y + 0.31).toFixed(3)} + 0.05 * (1.0 - t * t) - 0.02 * t;
    float browHalf = 0.022 * (1.0 - 0.5 * clamp(t, 0.0, 1.0));
    float dist = abs(p.y - browY);
    float brow = (1.0 - smoothstep(browHalf, browHalf + fwidth(p.y) + 0.004, dist)) * step(abs(t), 1.0) * step(0.35, facing);
    diffuseColor.rgb = mix(diffuseColor.rgb, browColor, brow);
    // Sculpted eyelashes: dark.
    float lash = smoothstep(0.35, 0.6, vLash);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.06, 0.1), lash);
  }`)}`;
  };
  material.customProgramCacheKey = () => 'head-skin';
  return material;
}

// Colours an eyeball material (a toon material in white): a large anime iris,
// darker at the top, with a pupil and highlights, facing forwards.
// glints: whether the eyes have the bright highlights that make them look alive.
export function eyeMaterial(material, eyeColor, sign, { glints = true } = {}) {
  const iris = new THREE.Color(eyeColor);
  const uniforms = {
    irisColor: { value: iris },
    irisDark: { value: iris.clone().multiplyScalar(0.4) },
    irisLight: { value: iris.clone().lerp(new THREE.Color('#ffffff'), 0.18) }, // (only a little lighter, so the colour stays rich)
    // The iris looks mostly along the eye opening, turned partway forwards.
    irisCentreX: { value: -sign * Math.sin(EYE.yaw * 0.35) },
    eyeWiden: { value: EYE.widen },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec3 vEyeDir;
${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vEyeDir = normalize(position);`)}`;
    shader.fragmentShader = `uniform vec3 irisColor;
uniform vec3 irisDark;
uniform vec3 irisLight;
uniform float irisCentreX;
uniform float eyeWiden;
varying vec3 vEyeDir;
${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec2 q = vec2((vEyeDir.x - irisCentreX) * eyeWiden, vEyeDir.y);
    float onFront = step(vEyeDir.z, 0.0);
    // Tall oval iris, filling the tall eye opening.
    float r = length(vec2(q.x, (q.y + 0.06) * 0.66));
    float aa = fwidth(r) + 1e-4;
    float irisMask = (1.0 - smoothstep(0.6 - aa, 0.6 + aa, r)) * onFront;
    vec3 irisCol = mix(irisLight, irisDark, smoothstep(-0.5, 0.5, q.y));
    irisCol = mix(irisCol, irisDark, smoothstep(0.45, 0.6, r)); // darker rim
    float pupil = 1.0 - smoothstep(0.22 - aa, 0.22 + aa, length(vec2(q.x, (q.y + 0.08) * 0.55)));
    irisCol = mix(irisCol, vec3(0.08, 0.06, 0.12), pupil * 0.9);
    vec3 col = mix(vec3(1.0), irisCol, irisMask);
    float glint = 1.0 - smoothstep(0.08, 0.1, length(q - vec2(-0.18, 0.22)));
    float glint2 = 1.0 - smoothstep(0.04, 0.055, length(q - vec2(0.2, -0.25)));
    col = mix(col, vec3(1.0), max(glint, glint2) * irisMask * ${glints ? '1.0' : '0.0'});
    diffuseColor.rgb = col;
  }`)}`;
  };
  material.customProgramCacheKey = () => `eyeball${sign}${glints ? '' : '-dull'}`;
  return material;
}

// Outline for the head: like the body's, but faded out close around each eye.
export function headOutlineMaterial(lineColor, thickness, R, eyeSize) {
  const mat = new THREE.MeshBasicMaterial({
    color: lineColor, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
  });
  const r = EYE.radius * eyeSize;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vec3 hp = position / ${R.toFixed(5)};
  vec2 fromEye = vec2(abs(hp.x) - ${EYE.x.toFixed(3)}, hp.y - ${EYE.y.toFixed(3)});
  float nearEye = length(vec2(fromEye.x / ${EYE.widen.toFixed(3)}, fromEye.y)) / ${r.toFixed(4)};
  float fade = smoothstep(1.35, 1.75, nearEye) + step(hp.z, ${(EYE.z + 0.35).toFixed(3)} - 1.0) * 0.0
    + step(${(EYE.z + 0.2).toFixed(3)}, hp.z); // (the eye region is only on the front of the face)
  transformed += normalize(normal) * ${thickness.toFixed(4)} * clamp(fade, 0.0, 1.0);`);
  };
  mat.customProgramCacheKey = () => `head-outline-${eyeSize.toFixed(3)}`;
  return mat;
}
