// Decay: what makes a character look undead (a zombie) -- rotting patches on
// the skin, rips in the clothes, and wounds where the flesh of a limb is gone,
// leaving the bones bare between two red, blood-spattered stumps. Part of the
// renderer (used by characterModel.js); it only draws.
//
// A decay description (see enemies.js) is plain data:
//   seed:  a number that varies the patterns from one character to the next
//   wounds: [{ limb, side }] -- limb: 'forearm', 'upperArm' or 'shin'; side: 'left' or 'right'
import * as THREE from '../node_modules/three/build/three.module.js';
import { smoothNormals } from './sculptedSurface.js';

// Where each kind of wound cuts the limb: the band of flesh that's gone
// ([bottom, top] down the limb from its joint, in body units), and the bones
// showing through it: [x, z, radius] across the limb (x towards the
// character's right on the right side, mirrored on the left).
export const WOUNDS = {
  forearm: { band: [-0.14, -0.065], bones: [[0.011, 0.002, 0.0065], [-0.011, -0.002, 0.0058]] }, // radius and ulna
  upperArm: { band: [-0.2, -0.11], bones: [[0, 0, 0.0105]] }, // humerus
  shin: { band: [-0.27, -0.14], bones: [[-0.004, -0.012, 0.0115], [0.02, 0.006, 0.0065]] }, // tibia and fibula
};

// The limb part each wound is on, and the joint it hangs from (see characterModel.js).
export const WOUND_JOINT = { forearm: 'Elbow', upperArm: 'Shoulder', shin: 'Knee' };

// Their faces: the upper eyelids hang half-closed (see lidCurve in
// headModel.js), and the eyes have no highlights.
export const EYELID_DROOP = 0.45;

const BONE_COLOR = '#e3d8b8';   // off-white, slightly yellowed
const FLESH_COLOR = '#7d1a1c';  // the raw ends of the stumps
const BLOOD_COLOR = '#5e0f12';  // spatters around them

// How much of a limb's sculpt a wound removes: positive inside the missing
// band. (Combined with max(), this cuts the limb off flat at both ends.)
export function woundCut(wound, y) {
  const [lo, hi] = WOUNDS[wound.limb].band;
  return Math.min(y - lo, hi - y);
}

// How far a point is from a wound's cut faces (for colouring the stumps and
// the blood around them), from its height down the limb.
export function woundDistance(wound, y) {
  const [lo, hi] = WOUNDS[wound.limb].band;
  return y > hi ? y - hi : y < lo ? lo - y : 0;
}

// The bones bridging a wound's gap, as meshes (in the limb joint's coordinates).
// `part` makes a finished, outlined mesh from a geometry and material.
export function woundBones(wound, sign, width, part, toon) {
  const { band: [lo, hi], bones } = WOUNDS[wound.limb];
  const material = toon(BONE_COLOR);
  return bones.map(([x, z, r]) => {
    // A little longer than the gap, so the ends are buried in the flesh, and
    // slightly thicker towards each end, like a real long bone.
    const length = hi - lo + 0.03;
    const points = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const flare = 1 + 0.25 * (Math.abs(t - 0.5) * 2) ** 3;
      const cap = Math.sqrt(Math.max(Math.min(1, Math.min(t, 1 - t) * 10), 0.02)); // rounded ends
      points.push(new THREE.Vector2(r * width * flare * cap, lo - 0.015 + length * t));
    }
    const geometry = smoothNormals(new THREE.LatheGeometry(points, 12));
    const mesh = part(geometry, material);
    mesh.position.set(sign * x * width, 0, z * width);
    return mesh;
  });
}

// --- Shading -------------------------------------------------------------

// GLSL: smooth noise, and the rot, rips and blood built from it. Positions
// are in the mesh's own coordinates (in body units).
export const DECAY_GLSL = `
float decayHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float decayNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(decayHash(i), decayHash(i + vec3(1, 0, 0)), f.x), mix(decayHash(i + vec3(0, 1, 0)), decayHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(decayHash(i + vec3(0, 0, 1)), decayHash(i + vec3(1, 0, 1)), f.x), mix(decayHash(i + vec3(0, 1, 1)), decayHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float decayFbm(vec3 p) {
  return 0.55 * decayNoise(p) + 0.3 * decayNoise(p * 2.1 + 7.3) + 0.15 * decayNoise(p * 4.3 + 1.7);
}
// Green rotting patches, with a darker, bruised edge round each.
vec3 decaySkin(vec3 skin, vec3 p, float seed) {
  float n = decayFbm(p * 7.0 + seed);
  float rot = smoothstep(0.57, 0.6, n);
  float bruise = smoothstep(0.5, 0.57, n) * (1.0 - rot);
  vec3 green = mix(vec3(0.24, 0.34, 0.1), vec3(0.14, 0.22, 0.06), decayNoise(p * 30.0 + seed));
  skin = mix(skin, skin * vec3(0.72, 0.78, 0.62), bruise * 0.8);
  return mix(skin, green, rot);
}
// Rips in clothes: long, ragged tears (stretched along the body), > 0 where
// torn -- but never over the crotch (a region round the tops of the legs, front
// and back, in body coordinates).
float decayRip(vec3 p, float seed) {
  float rip = decayFbm(p * vec3(14.0, 4.5, 14.0) + seed * 1.7 + 11.0) - 0.64;
  float crotch = length((p - vec3(0.0, 0.9, 0.0)) / vec3(0.15, 0.17, 0.22));
  return mix(-0.2, rip, smoothstep(0.9, 1.3, crotch));
}
// Blood spattered round a wound: dots, denser closer to the cut (dist: from the cut).
float decaySpatter(vec3 p, float dist, float seed) {
  float near = 1.0 - smoothstep(0.0, 0.07, dist);
  float dots = decayNoise(p * 90.0 + seed) * 0.6 + decayNoise(p * 35.0 + seed) * 0.4;
  return step(1.0 - near * 0.75, dots);
}
`;

export const DECAY_COLORS = {
  flesh: new THREE.Color(FLESH_COLOR),
  blood: new THREE.Color(BLOOD_COLOR),
};

// Adds rotting patches to a whole-skin material (the head or hands).
export function addRot(material, seed) {
  const before = material.onBeforeCompile;
  const beforeKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before?.(shader, renderer);
    shader.uniforms.decaySeed = { value: seed };
    shader.vertexShader = `varying vec3 vDecayPos;
${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vDecayPos = position;`)}`;
    // (Straight after the base colour, before any details drawn on top.)
    shader.fragmentShader = `uniform float decaySeed;
varying vec3 vDecayPos;
${DECAY_GLSL}
${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb = decaySkin(diffuseColor.rgb, vDecayPos, decaySeed);`)}`;
  };
  material.customProgramCacheKey = () => `${beforeKey ? beforeKey() : ''}-rot`;
  return material;
}
