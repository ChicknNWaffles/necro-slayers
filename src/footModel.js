// Foot model: a simplified, stylized foot (like the foot of a soft boot) --
// one smooth shape from a rounded heel along a gently sloping instep to a
// rounded toe, flaring up into the bottom of the leg like a triangle.
// Part of the renderer (used by characterModel.js); it only draws.
//
// Built in the ankle joint's frame: origin at the ankle, the floor at
// y = FLOOR_Y, toes pointing forwards (-z), for the right foot (+x is the
// outer side). The left foot is a mirror image.
import * as THREE from '../node_modules/three/build/three.module.js';
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
    [-0.03, 0.031, 0.029, -0.053],
    [-0.02, 0.033, 0.031, -0.052],   // heel
    [0.01, 0.039, 0.035, -0.047],    // under the ankle
    [0.05, 0.04, 0.028, -0.054],     // instep
    [0.09, 0.041, 0.02, -0.061],     // ball of the foot
    [0.13, 0.039, 0.015, -0.066],    // toes
    [0.155, 0.029, 0.012, -0.068],
    [0.168, 0.006, 0.006, -0.069],
  ]),
});

// The foot on its own (right foot).
function footDistance(x, y, z) {
  // The shape runs along the foot (-z), with its cross-sections in x and y.
  let d = FOOT_SHAPE(x, -z, y);
  // The back of the heel: one smooth, rounded curve.
  d = smoothUnion(d, ellipsoid(x, y, z, [0, -0.054, 0.032], [0.029, 0.028, 0.027]), 0.012);
  // Rising from the top of the foot into the ankle: a wide base narrowing
  // up towards the leg, like a triangle.
  // (Its base sits inside the heel, so it doesn't bulge out behind it.)
  d = smoothUnion(d, capsule(x, y, z, [0, -0.035, 0.0], [0, 0.065, 0.004], 0.04, 0.029), 0.045);
  // Flat underneath, with the edges rounded off.
  return -smoothUnion(-d, y - FLOOR_Y, 0.006);
}

const cache = new Map(); // side + build -> geometry
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

// The foot in the shoe colour, with the bottom of the trouser leg in the
// pants colour above HEM_Y (and a thin hem line between them).
function footMaterial(material, pantsColor, lineColor) {
  const uniforms = {
    pantsColor: { value: new THREE.Color(pantsColor) },
    footLineColor: { value: new THREE.Color(lineColor) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying float vFootY;
${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vFootY = position.y;`)}`;
    shader.fragmentShader = `uniform vec3 pantsColor;
uniform vec3 footLineColor;
varying float vFootY;
${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    float h = vFootY - ${HEM_Y.toFixed(4)};
    float px = h / (fwidth(h) + 1e-6);
    diffuseColor.rgb = mix(diffuseColor.rgb, pantsColor, smoothstep(-0.5, 0.5, px));
    diffuseColor.rgb = mix(diffuseColor.rgb, footLineColor, 1.0 - smoothstep(1.0, 2.0, abs(px)));
  }`)}`;
  };
  material.customProgramCacheKey = () => 'foot';
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
// `skinMaterial` is a toon material in the shoe colour. `leg` describes the
// shin it joins onto:
//   shin:    the shin's distance function, in shin (knee) coordinates
//   offsetY: where the ankle is, in shin coordinates
//   scale:   the foot's [x, y, z] scale (only x may differ from 1)
//   top:     how far up the shin (shin coordinates) the foot's mesh reaches
//   blend:   how widely the ankle is smoothed into the leg
//   outline: outline thickness
//   key:     identifies the shin's shape, for reusing meshes
export function createFoot({ sign, material, pantsColor, lineColor, leg }) {
  const geometry = footGeometry(sign, leg);
  const foot = new THREE.Mesh(geometry, footMaterial(material, pantsColor, lineColor));
  foot.castShadow = true;
  foot.add(new THREE.Mesh(geometry, footOutlineMaterial(lineColor, geometry.userData.top, leg.outline)));
  return foot;
}
