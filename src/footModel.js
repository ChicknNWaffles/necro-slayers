// Foot model: a simplified, stylized foot (like the foot of a soft boot) --
// one smooth shape from a rounded heel along a gently sloping instep to a
// rounded toe, flaring up into the bottom of the leg like a triangle.
// Part of the renderer (used by characterModel.js); it only draws.
//
// Built in the ankle joint's frame: origin at the ankle, the floor at
// y = FLOOR_Y, toes pointing forwards (-z), for the right foot (+x is the
// outer side). The left foot is a mirror image.
import * as THREE from '../node_modules/three/build/three.module.js';
import { registerGeometryCache } from './geometryCaches.js';
import { meshFromDistance, smoothUnion, profile, partDistance } from './sculptedSurface.js';

const FLOOR_Y = -0.08;  // the floor, relative to the ankle
const DETAIL = 0.0028;
const BOUNDS = { min: [-0.06, -0.085, -0.185], max: [0.06, 0, 0.08] }; // max y is set from the leg join

// Height (relative to the ankle) where the trouser leg ends over the foot.
const HEM_Y = 0.028;

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

// The foot's shape from heel to toe, as one smooth form: keyframes of
// [distance forwards from behind the heel, half width, half height, height of
// its centre]. It rises highest under the ankle, slopes down along the
// instep, is widest at the ball of the foot and ends in a low, rounded toe.
const FOOT_SHAPE = partDistance({
  // (The back of the heel is a separate rounded shape, see footDistance.)
  range: [-0.03, 0.168],
  shape: profile([
    [-0.03, 0.031, 0.0348, -0.0472],
    [-0.02, 0.033, 0.0372, -0.0458], // heel
    [0.01, 0.039, 0.042, -0.04],     // under the ankle
    [0.05, 0.04, 0.0336, -0.0484],   // instep
    [0.09, 0.041, 0.024, -0.057],    // ball of the foot
    [0.13, 0.039, 0.018, -0.063],    // toes
    [0.155, 0.029, 0.0144, -0.0656],
    [0.168, 0.006, 0.0072, -0.0678],
  ]),
});

// The foot on its own (right foot).
function footDistance(x, y, z) {
  // The shape runs along the foot (-z), with its cross-sections in x and y.
  let d = FOOT_SHAPE(x, -z, y);
  // The back of the heel: one smooth, rounded curve.
  d = smoothUnion(d, ellipsoid(x, y, z, [0, -0.0484, 0.032], [0.029, 0.0336, 0.027]), 0.012);
  // Rising from the top of the foot into the ankle: a wide base narrowing
  // up towards the leg, like a triangle.
  // (Its base sits inside the heel, so it doesn't bulge out behind it.)
  d = smoothUnion(d, capsule(x, y, z, [0, -0.035, 0.0], [0, 0.065, 0.004], 0.04, 0.029), 0.045);
  // Flat underneath, with the edges rounded off.
  return -smoothUnion(-d, y - FLOOR_Y, 0.006);
}

const cache = registerGeometryCache('feet'); // side + build -> geometry
const CACHE_SIZE = 8;

// The foot's mesh, including the bottom of the leg blended into the ankle.
// `leg` describes the shin it joins onto (see createFoot).
function footGeometry(sign, leg) {
  const key = `${sign}:${leg.key}`;
  let geometry = cache.get(key);
  if (!geometry) {
    const [sx] = leg.scale;
    const top = leg.top - leg.offsetY; // top of the leg stub, relative to the ankle
    const bounds = { min: [...BOUNDS.min], max: [BOUNDS.max[0], top, BOUNDS.max[2]] };
    bounds.min[0] = -BOUNDS.max[0];
    geometry = meshFromDistance((x, y, z) => {
      const foot = footDistance(sign * x, y, z);
      const shin = leg.shin(x * sx, leg.offsetY + y, z) / sx;
      return smoothUnion(foot, shin, leg.blend);
    }, bounds, DETAIL);
    geometry.userData.cached = true;
    geometry.userData.top = top;
    cache.set(key, geometry);
    if (cache.size > CACHE_SIZE) {
      const [oldestKey, oldest] = cache.entries().next().value;
      cache.delete(oldestKey);
      oldest.dispose();
    }
  }
  return geometry;
}

// Shoes: the foot in the shoe colour, with the bottom of the trouser leg in
// the pants colour above HEM_Y (and a thin hem line between them).
// Sandals: a bare foot in `skinColor` (and a bare leg above it), with a sole
// and straps in the shoe colour -- across the toes, over the instep, round
// the ankle, and up the back of the heel -- each edged with a thin line.
function footMaterial(material, { pantsColor, skinColor, lineColor, sandals }) {
  const uniforms = {
    pantsColor: { value: new THREE.Color(sandals ? skinColor : pantsColor) },
    footSkinColor: { value: new THREE.Color(skinColor ?? '#ffffff') },
    footLineColor: { value: new THREE.Color(lineColor) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec3 vFootPos;
${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vFootPos = position;`)}`;
    shader.fragmentShader = `uniform vec3 pantsColor;
uniform vec3 footSkinColor;
uniform vec3 footLineColor;
varying vec3 vFootPos;
// Coverage in pixels from a signed value (positive = covered), and its edge line.
float cover(float v) { return smoothstep(-0.5, 0.5, v / (fwidth(v) + 1e-6)); }
float edge(float v) { return 1.0 - smoothstep(1.0, 2.0, abs(v / (fwidth(v) + 1e-6))); }
${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 p = vFootPos;
    float h = p.y - ${HEM_Y.toFixed(4)};
${sandals ? `
    // Each strap as a signed value: positive inside it.
    float sole = ${(FLOOR_Y + 0.007).toFixed(4)} - p.y;
    float toes = 0.006 - abs(p.z + 0.118);
    float instep = 0.007 - abs(p.z + 0.045 + 0.35 * (p.y + 0.02));
    float ankle = 0.0055 - abs(p.y - 0.004);
    float heel = min(0.006 - abs(p.x), p.z - 0.02);
    float strap = max(max(sole, toes), max(max(instep, ankle), heel));
    diffuseColor.rgb = mix(footSkinColor, diffuseColor.rgb, cover(strap));
    diffuseColor.rgb = mix(diffuseColor.rgb, footLineColor, edge(strap) * 0.8);
    diffuseColor.rgb = mix(diffuseColor.rgb, pantsColor, cover(h));` : `
    diffuseColor.rgb = mix(diffuseColor.rgb, pantsColor, cover(h));
    diffuseColor.rgb = mix(diffuseColor.rgb, footLineColor, edge(h));`}
  }`)}`;
  };
  material.customProgramCacheKey = () => (sandals ? 'foot-sandal' : 'foot');
  return material;
}

// Outline, fading out at the very top where the leg's own outline takes over.
function footOutlineMaterial(lineColor, top, thickness) {
  const mat = new THREE.MeshBasicMaterial({
    color: lineColor, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  float thickness = ${thickness.toFixed(4)} * (1.0 - smoothstep(${(top * 0.6).toFixed(4)}, ${top.toFixed(4)}, position.y));
  transformed += normalize(normal) * thickness;`);
  };
  mat.customProgramCacheKey = () => `foot-outline-${top.toFixed(4)}-${thickness.toFixed(4)}`;
  return mat;
}

// A finished foot. `sign`: +1 for the right foot, -1 for the left.
// `material` is a toon material in the shoe colour; `sandals` shows a bare
// foot in `skinColor` with sandal straps instead of a shoe. `leg` describes the
// shin it joins onto:
//   shin:    the shin's distance function, in shin (knee) coordinates
//   offsetY: where the ankle is, in shin coordinates
//   scale:   the foot's [x, y, z] scale (only x may differ from 1)
//   top:     how far up the shin (shin coordinates) the foot's mesh reaches
//   blend:   how widely the ankle is smoothed into the leg
//   outline: outline thickness
//   key:     identifies the shin's shape, for reusing meshes
export function createFoot({ sign, material, pantsColor, skinColor, sandals = false, lineColor, leg }) {
  const geometry = footGeometry(sign, leg);
  const foot = new THREE.Mesh(geometry, footMaterial(material, { pantsColor, skinColor, lineColor, sandals }));
  foot.castShadow = true;
  foot.add(new THREE.Mesh(geometry, footOutlineMaterial(lineColor, geometry.userData.top, leg.outline)));
  return foot;
}
