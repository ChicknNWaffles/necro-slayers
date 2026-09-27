// Character model: builds the player's 3D body from an appearance
// (see characterAppearance.js). Part of the renderer -- it only draws.
//
// Anime style: a sculpted body (see sculptedSurface.js), cel (toon) shading,
// dark outlines, large drawn eyes and hair made of individual pointed locks.
// The body is rebuilt whenever the appearance changes, so a character creator
// can edit it live. Limbs hang from named joints so they can be animated later.
import * as THREE from '../node_modules/three/build/three.module.js';
import {
  profile, blob, ridge, partDistance, smoothUnion, meshFromDistance, angleAround, smoothNormals,
} from './sculptedSurface.js';
import { createHand } from './handModel.js';
import { createFoot } from './footModel.js';
import { headGeometry, eyePlacement, addFaceColour, eyeMaterial, headOutlineMaterial } from './headModel.js';

// Body measurements at default height and build, in world units.
// The feet are at y = 0 and the character faces -Z. Total height is about 2,
// matching the player's collision shape in game.js.
const BODY = {
  hipHeight: 1.0,
  hipSpread: 0.085,      // sideways distance from the centre to each leg
  thighLength: 0.47,
  shinLength: 0.45,
  shoulderHeight: 1.43,
  shoulderSpread: 0.19,  // sideways distance from the centre to each arm
  upperArmLength: 0.27,
  forearmLength: 0.25,
  neckTop: 1.61,         // where the head sits
  headRadius: 0.138,     // about 6.5 heads tall: realistic anime proportions
};

// The body above is about 1.88 units tall; this scales it to about 2, matching
// the player's collision shape in game.js.
const OVERALL_SCALE = 1.065;

const LINE_COLOR = '#2b2030';     // outlines, lashes and mouth
const OUTLINE_THICKNESS = 0.0028; // thin, matching the hands (whose outline is 0.0022 at 1.25x scale)
// Brightness of the shadow, mid and lit bands (soft, anime-like). Skin is
// shaded more gently still so faces stay bright.
const TOON_STEPS = [150, 210, 255];
const SKIN_TOON_STEPS = [190, 215, 238, 255]; // an extra band so muscle shapes read

export class CharacterModel {
  constructor(appearance) {
    this.root = new THREE.Group(); // add this to the scene; its origin is at the feet
    this.body = null;
    this.joints = {};
    this.setAppearance(appearance);
  }

  // Rebuild the body to match a new appearance.
  setAppearance(appearance) {
    if (this.body) {
      this.root.remove(this.body);
      disposeTree(this.body);
    }
    const { body, joints } = buildBody(appearance);
    this.body = body;
    this.joints = joints;
    this.root.add(body);
  }
}

// --- Body ----------------------------------------------------------------
// The torso, neck, arms and legs are one sculpt: each part is a shape with
// muscles, and the parts are melted together with smooth blends where they
// meet (shoulders, armpits, elbows, hips, knees). The sculpt is made in an
// "A-pose" (arms out, so the armpits stay clear) and a skeleton then bends it
// into the standing pose -- the same skeleton can animate it later.

// Joint rotations (radians, outwards from the body) in the sculpting pose and
// the standing pose.
const SCULPT_POSE = { shoulder: 0.6, hip: 0.04 }; // legs are sculpted as they stand, so posing doesn't crease the hips
const STAND_POSE = { shoulder: 0.1, hip: 0.04 };

// How far (in units) each join between parts is smoothed over.
const BLEND = { shoulder: 0.045, elbow: 0.01, hip: 0.03, knee: 0.01 };

// Size of the hands (handModel.js) relative to how they were modelled, so the
// base of the hand matches the wrist end of the forearm.
const HAND_SCALE = 1.25;

// The hands are sculpted in finer detail than the body, so the wrist is joined
// like this: the hand's sculpt includes the lower forearm, smoothly blended
// into the wrist, up to WRIST_JOIN.top (forearm coordinates). Over the overlap
// below that, the body's forearm is pulled slightly inwards (hidden inside the
// hand's surface) and ends at WRIST_JOIN.cut.
const WRIST_JOIN = { top: -0.17, cut: -0.2, inset: 0.007, blend: 0.009 };
// The feet (footModel.js) join the shins the same way (shin coordinates).
const ANKLE_JOIN = { top: -0.33, cut: -0.36, inset: 0.005, blend: 0.012 };
const JOINS = { forearm: WRIST_JOIN, shin: ANKLE_JOIN };

const SCULPT_DETAIL = 0.008; // sampling size when turning the sculpt into a mesh
const SCULPT_CACHE_SIZE = 4;
const sculptCache = new Map(); // build -> finished body mesh geometry

function buildBody(a) {
  const mats = {
    skin:  toon(a.skinColor, SKIN_TOON_STEPS),
    shoes: toon(a.shoeColor),
    hair:  toon(a.hairColor),
  };
  const w = a.build; // widens the torso, limbs and stance

  // Skeleton, in the sculpting pose.
  const bone = (parent, x, y, z) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent?.add(b);
    return b;
  };
  const root = bone(null, 0, 0, 0);
  const joints = { root, head: bone(root, 0, BODY.neckTop, -0.025) }; // head forward, over the leaning neck
  const parts = [{ name: 'torso', bone: root, ...torso(w) }];
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? -1 : 1; // the character's left is -X
    const shoulder = bone(root, sign * BODY.shoulderSpread * w, BODY.shoulderHeight, 0);
    const elbow = bone(shoulder, 0, -BODY.upperArmLength, 0);
    const hip = bone(root, sign * BODY.hipSpread * w, BODY.hipHeight, 0);
    const knee = bone(hip, 0, -BODY.thighLength, 0);
    const ankle = bone(knee, 0, -BODY.shinLength, 0);
    shoulder.rotation.z = sign * SCULPT_POSE.shoulder;
    hip.rotation.z = sign * SCULPT_POSE.hip;
    Object.assign(joints, {
      [`${side}Shoulder`]: shoulder, [`${side}Elbow`]: elbow,
      [`${side}Hip`]: hip, [`${side}Knee`]: knee, [`${side}Ankle`]: ankle,
    });
    parts.push(
      { name: 'upperArm', bone: shoulder, blend: BLEND.shoulder, ...upperArm(w, sign) },
      { name: 'forearm', bone: elbow, blend: BLEND.elbow, ...forearm(w, sign) },
      { name: 'thigh', bone: hip, blend: BLEND.hip, ...thigh(w, sign) },
      { name: 'shin', bone: knee, blend: BLEND.knee, ...shin(w, sign) },
    );
  }
  root.updateMatrixWorld(true);

  // Each part's distance function, in body coordinates.
  const p = new THREE.Vector3();
  for (const part of parts) {
    let local = partDistance(part);
    part.local = local;
    if (JOINS[part.name]) {
      const full = local;
      const { top, cut, inset } = JOINS[part.name];
      local = (x, y, z) => {
        const tuck = inset * Math.min(Math.max((top - y) / (top - cut), 0), 1);
        return Math.max(full(x, y, z) + tuck, cut - y);
      };
    }
    const toPart = part.bone.matrixWorld.clone().invert();
    part.toPart = toPart;
    part.distance = part.bone === root ? local : (x, y, z) => {
      p.set(x, y, z).applyMatrix4(toPart);
      return local(p.x, p.y, p.z);
    };
  }
  const bodyDistance = (x, y, z) => {
    let d = parts[0].distance(x, y, z);
    for (let i = 1; i < parts.length; i++) d = smoothUnion(d, parts[i].distance(x, y, z), parts[i].blend);
    return d;
  };

  // Sculpting takes about a second, and only the build changes the sculpt, so
  // recent sculpts are kept and reused (e.g. while a character creator changes colours).
  const key = w.toFixed(3);
  let geometry = sculptCache.get(key);
  if (!geometry) {
    geometry = meshFromDistance(bodyDistance, sculptBounds(parts), SCULPT_DETAIL);
    addSkinWeightsAndClothes(geometry, parts, joints);
    geometry.userData.cached = true;
    sculptCache.set(key, geometry);
    if (sculptCache.size > SCULPT_CACHE_SIZE) {
      const [oldestKey, oldest] = sculptCache.entries().next().value;
      sculptCache.delete(oldestKey);
      oldest.dispose();
    }
  }

  // The body mesh and its outline, both bent by the skeleton.
  const body = new THREE.Group();
  body.scale.setScalar(a.height * OVERALL_SCALE);
  body.add(root);
  const skin = new THREE.SkinnedMesh(geometry, clothedSkinMaterial(a));
  const outline = new THREE.SkinnedMesh(geometry, outlineMaterial);
  for (const m of [skin, outline]) {
    m.frustumCulled = false;
    body.add(m);
  }
  skin.castShadow = true;
  body.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(Object.values(joints));
  skin.bind(skeleton);
  outline.bind(skeleton);

  // Hands (detailed, see handModel.js) and shoes, carried by their joints.
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? -1 : 1;
    const handWidth = 1 + (w - 1) * 0.4; // build affects the hands a little
    const scale = [handWidth * HAND_SCALE, HAND_SCALE, handWidth * HAND_SCALE];
    const forearmPart = parts.find((q) => q.name === 'forearm' && q.bone === joints[`${side}Elbow`]);
    const hand = createHand({
      sign,
      skinMaterial: toon(a.skinColor, SKIN_TOON_STEPS),
      lineColor: LINE_COLOR,
      // The lower forearm, for blending into the wrist (see WRIST_JOIN).
      wrist: {
        forearm: forearmPart.local,
        offsetY: -BODY.forearmLength,
        scale,
        top: WRIST_JOIN.top,
        blend: WRIST_JOIN.blend,
        outline: OUTLINE_THICKNESS,
        key: `${w.toFixed(3)}`,
      },
    });
    hand.position.y = -BODY.forearmLength; // the hand's origin is the wrist
    hand.scale.set(...scale);
    joints[`${side}Elbow`].add(hand);

    // Feet (see footModel.js), blended into the bottom of the legs.
    const footWidth = 1 + (w - 1) * 0.4; // build widens the feet a little
    const shinPart = parts.find((q) => q.name === 'shin' && q.bone === joints[`${side}Knee`]);
    const foot = createFoot({
      sign,
      material: toon(a.shoeColor, SKIN_TOON_STEPS), // shaded like the body, so the trouser leg matches
      pantsColor: a.pantsColor,
      lineColor: LINE_COLOR,
      leg: {
        shin: shinPart.local,
        offsetY: -BODY.shinLength,
        scale: [footWidth, 1, 1],
        top: ANKLE_JOIN.top,
        blend: ANKLE_JOIN.blend,
        outline: OUTLINE_THICKNESS,
        key: w.toFixed(3),
      },
    });
    foot.scale.x = footWidth;
    joints[`${side}Ankle`].add(foot);
  }

  // Head (the head joint itself is not scaled, so the neck isn't either).
  const head = new THREE.Group();
  head.scale.setScalar(a.headSize);
  joints.head.add(head);
  buildHead(head, a, mats);

  // Bend the sculpt into the standing pose.
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? -1 : 1;
    joints[`${side}Shoulder`].rotation.z = sign * STAND_POSE.shoulder;
    joints[`${side}Hip`].rotation.z = sign * STAND_POSE.hip;
  }

  return { body, joints };
}

// A box around the whole sculpt, from where each part's ends are.
function sculptBounds(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const v = new THREE.Vector3();
  for (const part of parts) {
    for (const y of part.range) {
      for (const [x, z] of [[-0.2, -0.2], [0.2, 0.2]]) {
        v.set(x, y, z).applyMatrix4(part.bone.matrixWorld);
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], v.getComponent(i));
          max[i] = Math.max(max[i], v.getComponent(i));
        }
      }
    }
  }
  // Shift the sampling grid off the body's centre line: a symmetric body lined
  // up exactly with the grid can leave a pinched sliver down the middle.
  min[0] -= SCULPT_DETAIL * 0.37;
  return { min, max };
}

// For every vertex: which joints move it (blending smoothly where parts meet)
// and whether it is covered by the shirt or pants.
function addSkinWeightsAndClothes(geometry, parts, joints) {
  const bones = Object.values(joints);
  const pos = geometry.attributes.position;
  const count = pos.count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const shirtField = new Float32Array(count);
  const pantsField = new Float32Array(count);
  const local = new THREE.Vector3();
  const falloff = 0.015; // how gradually a vertex is shared between neighbouring parts

  for (let v = 0; v < count; v++) {
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    const d = parts.map((part) => part.distance(x, y, z));
    const nearest = Math.min(...d);
    const weights = d.map((di) => Math.exp(-(di - nearest) / falloff));
    const total = weights.reduce((s, wi) => s + wi, 0);

    // Clothing: a value per part that is positive where that part is covered,
    // blended with the same weights so the edges are smooth. The torso and
    // legs share one rule (by height on the body), so the shirt's hem isn't
    // bent where the legs join; the arms use distance down the arm.
    const bodyShirt = clampField(Math.min(CLOTHES.neckline(angleAround(x, z, 0)) - y, y - CLOTHES.hem));
    const bodyPants = clampField(CLOTHES.waist - y);
    const influence = new Map();
    let shirt = 0, pants = 0;
    parts.forEach((part, i) => {
      const share = weights[i] / total;
      if (share < 0.001) return;
      local.set(x, y, z).applyMatrix4(part.toPart);
      const along = -local.y; // distance down the limb from its joint
      if (part.name === 'torso') {
        shirt += share * bodyShirt;
        pants += share * bodyPants;
        // The top of the neck turns with the head.
        const withHead = THREE.MathUtils.smoothstep(y, 1.56, 1.66);
        addInfluence(influence, joints.root, share * (1 - withHead));
        addInfluence(influence, joints.head, share * withHead);
        return;
      }
      const bare = -CLOTHES.fieldLimit;
      if (part.name === 'upperArm') { shirt += share * clampField(CLOTHES.sleeve - along); pants += share * bare; }
      if (part.name === 'forearm') { shirt += share * bare; pants += share * bare; }
      if (part.name === 'thigh' || part.name === 'shin') { shirt += share * bodyShirt; pants -= share * bare; }
      addInfluence(influence, part.bone, share);
    });
    shirtField[v] = shirt;
    pantsField[v] = pants;

    // Keep the 4 strongest joints.
    const top = [...influence].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = top.reduce((s, [, wi]) => s + wi, 0);
    top.forEach(([b, wi], k) => {
      skinIndex[v * 4 + k] = bones.indexOf(b);
      skinWeight[v * 4 + k] = wi / sum;
    });
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setAttribute('shirtField', new THREE.Float32BufferAttribute(shirtField, 1));
  geometry.setAttribute('pantsField', new THREE.Float32BufferAttribute(pantsField, 1));
}

function addInfluence(map, bone, weight) {
  map.set(bone, (map.get(bone) ?? 0) + weight);
}

// Where the basic outfit covers the body (heights in units; the shirt's
// neckline dips at the front).
const CLOTHES = {
  neckline: (angle) => 1.482 - 0.02 * Math.cos(angle),
  hem: 1.06,     // bottom of the shirt
  waist: 1.115,  // top of the pants (under the shirt)
  sleeve: 0.15,  // sleeve length down the upper arm (ends below the armpit)
  fieldLimit: 0.05, // coverage values are capped so blends between parts stay local
};

function clampField(value) {
  return Math.min(Math.max(value, -CLOTHES.fieldLimit), CLOTHES.fieldLimit);
}

// Skin-toned toon material that paints the shirt and pants onto the body, with
// crisp edges and a thin line along each hem.
function clothedSkinMaterial(a) {
  const mat = toon('#ffffff', SKIN_TOON_STEPS);
  const uniforms = {
    skinColor: { value: new THREE.Color(a.skinColor) },
    shirtColor: { value: new THREE.Color(a.shirtColor) },
    pantsColor: { value: new THREE.Color(a.pantsColor) },
    lineColor: { value: new THREE.Color(LINE_COLOR) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float shirtField;
attribute float pantsField;
varying float vShirt;
varying float vPants;
${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vShirt = shirtField;
  vPants = pantsField;`)}`;
    shader.fragmentShader = `uniform vec3 skinColor;
uniform vec3 shirtColor;
uniform vec3 pantsColor;
uniform vec3 lineColor;
varying float vShirt;
varying float vPants;
${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    // Measured in pixels, so edges stay crisp and lines stay thin at any distance.
    float shirtPx = vShirt / (fwidth(vShirt) + 1e-6);
    float pantsPx = vPants / (fwidth(vPants) + 1e-6);
    float shirt = smoothstep(-0.5, 0.5, shirtPx);
    float pants = smoothstep(-0.5, 0.5, pantsPx) * (1.0 - shirt);
    vec3 cloth = mix(mix(skinColor, pantsColor, pants), shirtColor, shirt);
    float edge = max(1.0 - smoothstep(1.0, 2.0, abs(shirtPx)),
                     (1.0 - smoothstep(1.0, 2.0, abs(pantsPx))) * (1.0 - shirt));
    diffuseColor.rgb *= mix(cloth, lineColor, edge);
  }`)}`;
  };
  mat.customProgramCacheKey = () => 'clothed-skin';
  return mat;
}

// --- Body sculpting ------------------------------------------------------
// Shapes are keyframes of [height, half width, half depth, forward offset];
// muscles use surface angles (0 = front, +π/2 = the character's right side,
// π = back). For limbs, `sign` mirrors the muscles onto the correct side.

// Build widens the body; the neck widens less.
function scaled(keys, w, neckFrom = Infinity) {
  return keys.map(([y, rx, rz, cz]) => {
    const s = y >= neckFrom ? 1 + (w - 1) * 0.4 : w;
    return [y, rx * s, rz * s, cz];
  });
}

function torso(w) {
  return { shape: torsoShape(w), bumps: torsoMuscles(), range: [0.86, 1.7] };
}

function torsoShape(w) {
  return profile(scaled([
    // The bottom closes gradually and lower down, between the tops of the
    // thighs, the way fabric fills in there (no hollow underneath the seat).
    [0.86, 0.004, 0.004, 0.02],    // crotch
    [0.88, 0.05, 0.05, 0.02],
    [0.91, 0.09, 0.075, 0.016],
    [0.95, 0.158, 0.1, 0.012],
    [1.0, 0.168, 0.104, 0.014],    // hips: wide enough to contain the tops of the thighs,
    [1.05, 0.163, 0.1, 0.011],     // curving smoothly up into the waist
    [1.11, 0.146, 0.093, 0.004],
    [1.17, 0.128, 0.086, 0],       // waist
    [1.24, 0.138, 0.092, -0.006],
    [1.31, 0.155, 0.1, -0.012],    // chest
    [1.37, 0.163, 0.098, -0.01],
    [1.42, 0.158, 0.088, -0.002],
    [1.46, 0.14, 0.078, 0.01],     // trapezius: a full, rounded slope from the shoulders...
    [1.49, 0.108, 0.072, 0.013],
    [1.52, 0.074, 0.066, 0.014],   // ...into the base of the neck,
    [1.56, 0.058, 0.059, 0.012],   // which leans forward as it rises
    [1.62, 0.054, 0.056, 0.004],
    [1.7, 0.054, 0.056, -0.01],    // top of the neck, inside the head
  ], w, 1.5));
}

function torsoMuscles() {
  const m = [
    // Neck and collarbones.
    blob({ angle: 0, y: 1.48, amp: -0.008, width: 0.014, height: 0.014 }),         // notch between the collarbones
    blob({ angle: 0, y: 1.515, amp: -0.003, width: 0.014, height: 0.03 }),         // hollow between the two SCMs
    // Chest and back.
    ridge({ from: [0, 1.27], to: [0, 1.43], amp: -0.004, width: 0.012 }),          // breastbone groove
    // Trapezius on the back: a kite shape from the base of the skull down to
    // the middle of the back.
    blob({ angle: Math.PI, y: 1.4, amp: 0.006, width: 0.08, height: 0.1 }),
    ridge({ from: [Math.PI, 1.08], to: [Math.PI, 1.38], amp: -0.005, width: 0.012 }), // spine
    blob({ angle: 0, y: 1.135, amp: -0.004, width: 0.008, height: 0.008 }),        // navel
  ];
  for (const s of [-1, 1]) {
    m.push(
      // Sternocleidomastoid: from behind the ear, diagonally round the neck
      // to the top of the breastbone.
      ridge({ from: [s * 0.2, 1.478], to: [s * 1.9, 1.64], amp: 0.009, width: 0.012 }),
      blob({ angle: s * 1.7, y: 1.53, amp: -0.005, width: 0.02, height: 0.035 }), // hollow behind the SCM
      // Upper trapezius: the muscle mass sloping from the back of the neck to
      // the shoulder, with a ridge along its top edge...
      // (Mostly on top of the shoulders, so the back of the neck flows smoothly
      // down into the shoulder blades without a hump.)
      blob({ angle: s * 1.9, y: 1.465, amp: 0.012, width: 0.06, height: 0.04 }),
      ridge({ from: [s * 2.5, 1.6], to: [s * 1.45, 1.455], amp: 0.007, width: 0.025 }),
      // ...its lower edges, running from the shoulder blades to the middle of the back...
      ridge({ from: [s * 2.2, 1.44], to: [Math.PI, 1.2], amp: 0.005, width: 0.02 }),
      // ...and the hollow above the collarbone, between it and the neck.
      blob({ angle: s * 0.9, y: 1.475, amp: -0.005, width: 0.03, height: 0.015 }),
      ridge({ from: [s * 0.18, 1.468], to: [s * 1.15, 1.452], amp: 0.006, width: 0.009 }), // collarbone
      blob({ angle: s * 1.45, y: 1.448, amp: 0.004, width: 0.018, height: 0.014 }),       // acromion (bony point on top of the shoulder)
      ridge({ from: [s * 0.95, 1.45], to: [s * 1.2, 1.33], amp: -0.004, width: 0.011 }),  // groove between the deltoid and the pec
      blob({ angle: s * 0.42, y: 1.335, amp: 0.012, width: 0.055, height: 0.045 }),       // pectoral
      // Shoulder blade: a broad plate with a raised inner edge, the bony ridge
      // (scapular spine) running out towards the shoulder, and a point at the bottom.
      // The plate is covered by muscle above it too, so it rises smoothly into the neck.
      blob({ angle: s * 2.5, y: 1.37, amp: 0.013, width: 0.05, height: 0.09 }),
      ridge({ from: [s * 2.8, 1.43], to: [s * 2.75, 1.27], amp: 0.005, width: 0.012 }),
      ridge({ from: [s * 2.8, 1.42], to: [s * 1.9, 1.45], amp: 0.003, width: 0.015 }),
      blob({ angle: s * 2.7, y: 1.26, amp: 0.004, width: 0.02, height: 0.02 }),
      blob({ angle: s * 1.95, y: 1.3, amp: 0.008, width: 0.05, height: 0.08 }),           // lat
      blob({ angle: s * 1.4, y: 1.1, amp: 0.005, width: 0.05, height: 0.04 }),            // oblique
      // Glute: shaped like half an egg in profile -- a long, gentle slope down from
      // the lower back to its fullest point low down, then curving under onto the thigh.
      blob({ angle: s * 2.75, y: 1.0, amp: 0.01, width: 0.065, height: 0.14 }),
      blob({ angle: s * 2.75, y: 0.935, amp: 0.017, width: 0.065, height: 0.05 }),
    );
  }
  return m;
}

// Limbs hang down from their joint (y = 0) and close off at both ends.
function thigh(w, sign) {
  return {
    // Ends just past the knee with the knee's cross-section, overlapping the
    // shin, so the two meet without a ball-shaped joint (like the elbow).
    range: [-0.5, 0.06],
    shape: profile(scaled([
      [-0.5, 0.05, 0.055, 0], [-0.49, 0.05, 0.055, 0], [-0.44, 0.056, 0.058, 0],
      [-0.3, 0.07, 0.072, -0.005], [-0.12, 0.085, 0.09, 0], [0, 0.078, 0.082, 0.005],
      [0.03, 0.062, 0.068, 0.005], [0.05, 0.02, 0.02, 0.005], // (the top tucks inside the hips)
    ], w)),
    bumps: [
      blob({ angle: 0, y: -0.25, amp: 0.01, width: 0.05, height: 0.12 }),                // quadriceps
      blob({ angle: -sign * 0.6, y: -0.38, amp: 0.008, width: 0.03, height: 0.05 }),     // inner quad above the knee
      blob({ angle: sign * 1.5, y: -0.1, amp: 0.006, width: 0.05, height: 0.1 }),        // outer thigh
      blob({ angle: 0, y: -0.47, amp: 0.008, width: 0.02, height: 0.025 }),              // kneecap
      blob({ angle: 0, y: -0.37, amp: 0.012, width: 0.045, height: 0.075 }),             // lower quads, nearly flush with the kneecap
      // Bottom of the glute, curving under into a soft fold at the top of the back of the thigh.
      blob({ angle: sign * (Math.PI - 0.35), y: -0.065, amp: 0.03, width: 0.055, height: 0.062 }),
      blob({ angle: sign * (Math.PI - 0.3), y: -0.155, amp: -0.004, width: 0.05, height: 0.015 }),
      // Inner back of the top of the thigh, filled out so the two legs merge
      // below the seat the way fabric bridges across there (no deep gap).
      blob({ angle: -sign * 2.45, y: -0.075, amp: 0.02, width: 0.04, height: 0.06 }),
    ],
  };
}

function shin(w, sign) {
  return {
    range: [-0.47, 0.025],
    shape: profile(scaled([
      // From the front, a kite with rounded corners (like the forearm): widest
      // about a quarter of the way down, tapering in straight lines to the ankle.
      [-0.47, 0.015, 0.015, 0], [-0.44, 0.03, 0.032, 0], [-0.33, 0.0417, 0.04, 0.002],
      [-0.27, 0.048, 0.0469, 0.0033], [-0.2, 0.0554, 0.055, 0.005], [-0.1, 0.066, 0.062, 0.006],
      [-0.05, 0.059, 0.0605, 0.0045], [0, 0.049, 0.056, 0.002],
      [0.025, 0.049, 0.056, 0.002], // top: the knee's cross-section (no rounded cap)
    ], w)),
    bumps: [
      blob({ angle: Math.PI - sign * 0.35, y: -0.12, amp: 0.014, width: 0.035, height: 0.07 }), // inner calf
      blob({ angle: Math.PI + sign * 0.35, y: -0.11, amp: 0.012, width: 0.035, height: 0.07 }), // outer calf
      ridge({ from: [0, -0.05], to: [0, -0.4], amp: 0.003, width: 0.01 }),                     // shin bone
    ],
  };
}

function upperArm(w, sign) {
  return {
    // Ends just past the elbow with the elbow's cross-section (wider side to
    // side than front to back), overlapping the forearm, so the two meet
    // without a ball-shaped joint.
    range: [-0.285, 0.05],
    shape: profile(scaled([
      [-0.285, 0.036, 0.028, 0], [-0.27, 0.036, 0.028, 0], [-0.24, 0.036, 0.031, 0],
      [-0.2, 0.039, 0.037, 0], [-0.16, 0.043, 0.045, 0], [-0.08, 0.047, 0.048, 0], [0, 0.047, 0.049, 0],
      [0.025, 0.043, 0.045, 0], [0.05, 0.015, 0.015, 0], // top of the arm, tucked under the shoulder
    ], w)),
    bumps: [
      // Deltoid: three heads wrapping the shoulder -- front, middle and rear --
      // converging in a V to a point a third of the way down the outside of the arm.
      // (Tapering off gradually, so the arm's outline flows on down without a notch.)
      ridge({ from: [sign * 0.45, 0.03], to: [sign * 1.35, -0.18], amp: 0.006, width: 0.034 }),
      ridge({ from: [sign * 1.6, 0.045], to: [sign * 1.5, -0.19], amp: 0.005, width: 0.04 }), // (kept low so the shoulders aren't too broad)
      ridge({ from: [sign * 2.65, 0.03], to: [sign * 1.65, -0.18], amp: 0.006, width: 0.034 }),
      // Biceps and triceps: long, gentle masses overlapping the bottom of the
      // deltoid, taking over the arm's fullness as it tapers off.
      blob({ angle: 0, y: -0.15, amp: 0.007, width: 0.04, height: 0.085 }),          // biceps
      blob({ angle: Math.PI, y: -0.13, amp: 0.007, width: 0.045, height: 0.1 }),     // triceps
      // Brachialis: shows on the outer side between the biceps and triceps,
      // just below the deltoid, filling the outline down towards the elbow.
      blob({ angle: sign * 1.45, y: -0.2, amp: 0.005, width: 0.03, height: 0.06 }),
      // Above the elbow: the flat triceps tendon at the back, the biceps
      // narrowing into the front of the elbow, and the brachioradialis
      // starting on the outer side.
      blob({ angle: Math.PI, y: -0.215, amp: -0.003, width: 0.022, height: 0.03 }),
      blob({ angle: 0, y: -0.245, amp: -0.003, width: 0.02, height: 0.02 }),
      blob({ angle: sign * 1.0, y: -0.22, amp: 0.004, width: 0.02, height: 0.04 }),
      // Epicondyles: the bony knobs either side of the elbow (the inner one more prominent).
      blob({ angle: -sign * 1.57, y: -0.258, amp: 0.005, width: 0.013, height: 0.016 }),
      blob({ angle: sign * 1.57, y: -0.258, amp: 0.0025, width: 0.013, height: 0.016 }),
    ],
  };
}

// Oval in cross-section (wider side to side than front to back). Seen from the
// front it is a kite with rounded corners: widening from the elbow to its widest
// point about a quarter of the way down, then tapering in straight lines to the
// wrist. Seen from the side (the direction the elbow bends) it tapers gently.
function forearm(w, sign) {
  return {
    range: [-0.28, 0.035],
    shape: profile(scaled([
      [-0.28, 0.01, 0.01, 0],      // closes off at the wrist (inside the hand)
      [-0.26, 0.02, 0.0235, 0],    // wrist: turned to match the hand (wider front to back)
      [-0.24, 0.0227, 0.0245, 0],
      [-0.18, 0.031, 0.0272, 0],   // straight taper, the oval turning as it goes...
      [-0.12, 0.0392, 0.0297, 0],
      [-0.07, 0.046, 0.031, 0],    // ...from the widest point (rounded corner)
      [-0.02, 0.04, 0.03, 0],
      [0, 0.036, 0.028, 0],        // elbow: same cross-section as the end of the upper arm
      [0.015, 0.035, 0.027, 0],    // (overlaps the upper arm; no rounded cap)
    ], w)),
    bumps: [
      // Olecranon: the bony point at the back of the elbow.
      blob({ angle: Math.PI, y: 0.0, amp: 0.006, width: 0.014, height: 0.018 }),
      // Front of the elbow: a V of muscle -- the brachioradialis on the outer
      // side and the flexors on the inner side -- around a shallow hollow
      // (cubital fossa) where the biceps tendon goes in.
      ridge({ from: [sign * 0.8, 0.012], to: [sign * 1.15, -0.16], amp: 0.005, width: 0.018 }),
      blob({ angle: -sign * 0.75, y: -0.05, amp: 0.004, width: 0.02, height: 0.04 }),
      blob({ angle: 0, y: -0.012, amp: -0.004, width: 0.014, height: 0.02 }),
      // The shallow groove down the back of the forearm along the ulna.
      ridge({ from: [Math.PI, -0.02], to: [Math.PI, -0.22], amp: -0.002, width: 0.01 }),
    ],
  };
}

// --- Head and face -------------------------------------------------------

function buildHead(head, a, mats) {
  const R = BODY.headRadius;
  const centre = new THREE.Group(); // centre of the skull
  centre.position.y = 0.85 * R;
  head.add(centre);

  // The sculpted head (see headModel.js), with eyebrows and blush coloured on.
  const brow = new THREE.Color(a.hairColor).multiplyScalar(0.7);
  const skin = addFaceColour(toon(a.skinColor, SKIN_TOON_STEPS), brow, R, a.eyeSize);
  const headMesh = new THREE.Mesh(headGeometry(a.eyeSize, R), skin);
  headMesh.castShadow = true;
  // Its own outline, faded out around the eyes (the thin folds of the eyelids
  // would otherwise let it show through as specks).
  headMesh.add(new THREE.Mesh(headMesh.geometry, headOutlineMaterial(LINE_COLOR, OUTLINE_THICKNESS, R, a.eyeSize)));
  centre.add(headMesh);

  // Eyeballs, set in the sockets.
  const eyes = eyePlacement(a.eyeSize);
  for (const { sign, centre: [x, y, z] } of eyes.eyes) {
    const eyeball = new THREE.Mesh(
      new THREE.SphereGeometry(eyes.radius * R, 32, 24),
      eyeMaterial(toon('#ffffff', SKIN_TOON_STEPS), a.eyeColor, sign),
    );
    eyeball.position.set(x * R, y * R, z * R);
    eyeball.rotation.y = -sign * eyes.yaw; // turned outwards, wrapping round the head
    eyeball.scale.x = eyes.widen;
    centre.add(eyeball);
  }

  buildHair(centre, a.hairStyle, mats.hair);
}

// --- Hair ----------------------------------------------------------------
// A base layer of hair over the skull, and locks of hair shaped like ribbons:
// flat, the same width along their length until they taper to a point at the
// end, draping over the head under gravity with a gentle sway and twist.
// Everything here is in head radii (scaled by R at the end).

// The skull's shape (matches the cranium in headModel.js): an ellipsoid.
const SKULL = { centre: [0, 0.06, 0.06], radii: [0.88, 0.96, 1.02] };
const HAIR_SHELL = 1.07;  // the base layer, as a multiple of the skull's size
const LOCK_STEPS = 40;

function buildHair(centre, style, hairMat) {
  if (style === 'none') return;
  const R = BODY.headRadius;
  const hair = new THREE.Group();
  hair.scale.setScalar(R);
  centre.add(hair);

  // Base layer: the skull shape, covering the top and back of the head, tilted
  // back so the forehead shows and reaching down to the nape at the back.
  const cap = new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0, 1.75);
  cap.rotateX(0.45);
  cap.scale(...SKULL.radii.map((r) => r * HAIR_SHELL));
  cap.translate(...SKULL.centre);
  hair.add(part(smoothNormals(cap), hairMat));

  // Each lock is three ribbons, offset slightly from each other: the middle
  // one on top, the outer two slightly shorter and swaying differently. Together
  // they make the hair fuller.
  const lock = (options) => {
    for (const k of [-1, 1, 0]) {
      const o = { ...options, width: options.width * (k ? 0.95 : 1), length: options.length * (k ? 0.92 + 0.04 * k : 1) };
      o.sway = (options.sway ?? 0) + k * 0.03;
      o.twist = (options.twist ?? 0) * (1 + 0.25 * k);
      o.raise = k ? 0 : 0.02; // the middle ribbon lies on top
      if (o.from) {
        const side = normalizeV(crossV(o.dir, [0, 1, 0]));
        o.from = o.from.map((v, i) => v + side[i] * k * options.width * 0.45);
      } else {
        o.az += k * (options.width * 0.45 / Math.max(Math.sin(options.polar), 0.3)) * (180 / Math.PI);
        o.polar += Math.abs(k) * 0.03;
      }
      hair.add(part(ribbonLock(o), hairMat));
    }
  };

  // Bangs across the forehead: shorter in the middle, longer at the sides.
  const bangs = [
    { az: -60, length: 1.95 }, { az: -40, length: 1.75 }, { az: -20, length: 1.6 },
    { az: 0, length: 1.5 }, { az: 20, length: 1.62 }, { az: 40, length: 1.78 }, { az: 60, length: 1.95 },
  ];
  bangs.forEach((b, i) => lock({
    az: b.az, polar: 0.3, length: b.length, width: 0.3, sway: 0.1 * (i % 2 ? 1 : -1), twist: 0.5,
  }));

  // Strands framing the face, in front of the ears, down to the jaw.
  for (const az of [-72, 72]) lock({ az, polar: 0.6, length: 2.1, width: 0.26, sway: 0.1, twist: 0.6 });

  // Sides and back of the head.
  const long = style === 'long';
  for (let az = 95, i = 0; az <= 265; az += 17, i++) {
    lock({
      az, polar: 0.45, length: long ? 4.2 : 2.35, width: 0.36,
      sway: (long ? 0.16 : 0.1) * (i % 2 ? 1 : -1), twist: long ? 0.9 : 0.5,
    });
  }

  if (style === 'ponytail') {
    const tie = part(new THREE.SphereGeometry(0.2, 12, 10), hairMat);
    tie.position.set(0, 0.5, 1.12);
    hair.add(tie);
    lock({ from: [0, 0.5, 1.15], dir: [0, 0.2, 1], length: 3.2, width: 0.44, sway: 0.12, twist: 1.0 });
  } else if (style === 'twintails') {
    for (const sign of [-1, 1]) {
      const tie = part(new THREE.SphereGeometry(0.16, 12, 10), hairMat);
      tie.position.set(sign * 0.92, 0.45, 0.45);
      hair.add(tie);
      lock({ from: [sign * 0.96, 0.45, 0.48], dir: [sign * 0.8, 0.3, 0.5], length: 3.6, width: 0.44, sway: 0.12, twist: 1.0 });
    }
  }
}

// Pushes a point out of the hair shell (so locks lie on the base layer), and
// returns the outward direction there.
function onShell(p, lift) {
  const q = p.map((v, i) => (v - SKULL.centre[i]) / SKULL.radii[i]);
  const k = Math.hypot(...q);
  const shell = HAIR_SHELL + lift;
  if (k < shell) for (let i = 0; i < 3; i++) p[i] = SKULL.centre[i] + (q[i] / k) * shell * SKULL.radii[i];
  return normalizeV(q.map((v, i) => v / SKULL.radii[i]));
}

function normalizeV(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
function crossV(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

// One ribbon-like lock of hair.
//   az, polar: where it starts on the head (degrees round from the front; radians down from the top),
//              or from/dir: a start point and direction (for tails hanging from a tie)
//   length, width: in head radii
//   sway: how far it swings from side to side; twist: how much it turns about its length
function ribbonLock({ az, polar, from, dir, length, width, sway = 0, twist = 0, raise = 0 }) {
  const thickness = width * 0.14;
  const lift = thickness + raise; // how far its centre sits above the base layer
  let p, d;
  if (from) {
    p = [...from];
    d = normalizeV(dir);
  } else {
    const a = (az * Math.PI) / 180;
    const u = [Math.sin(polar) * Math.sin(a), Math.cos(polar), -Math.sin(polar) * Math.cos(a)];
    p = u.map((v, i) => SKULL.centre[i] + v * SKULL.radii[i] * HAIR_SHELL);
    // Start off heading down the scalp, away from the crown.
    d = normalizeV([u[0], -Math.max(Math.sin(polar), 0.3), u[2]].map((v, i) => (i === 1 ? v : v * Math.cos(polar))));
  }

  // Lay it down step by step: it keeps its direction, gravity bends it down,
  // and it's kept on (or outside) the base layer.
  const ds = length / LOCK_STEPS;
  const points = [];
  for (let i = 0; i <= LOCK_STEPS; i++) {
    const n = onShell(p, lift);
    points.push({ p: [...p], n });
    d = normalizeV([d[0], d[1] - 0.09, d[2]]);
    // Slide along the head rather than into it.
    const into = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    if (into < 0 && Math.hypot(...p.map((v, j) => (v - SKULL.centre[j]) / SKULL.radii[j])) <= HAIR_SHELL + lift + 1e-6) {
      d = normalizeV(d.map((v, j) => v - into * n[j]));
    }
    p = p.map((v, j) => v + d[j] * ds);
  }

  // Frames along it (width across, thickness outwards), with sway and twist.
  const frames = points.map((pt, i) => {
    const next = points[Math.min(i + 1, LOCK_STEPS)].p, prev = points[Math.max(i - 1, 0)].p;
    const T = normalizeV(next.map((v, j) => v - prev[j]));
    let N = normalizeV(pt.n.map((v, j) => v - (v * T[0] + 0) * 0));
    const dotNT = N[0] * T[0] + N[1] * T[1] + N[2] * T[2];
    N = normalizeV(N.map((v, j) => v - dotNT * T[j]));
    let B = crossV(T, N);
    const s = i / LOCK_STEPS;
    const tw = twist * s * s;
    const c = Math.cos(tw), sn = Math.sin(tw);
    const B2 = B.map((v, j) => v * c + N[j] * sn);
    const N2 = N.map((v, j) => -B[j] * sn + v * c);
    const offset = sway * Math.sin(Math.PI * 1.5 * s) * s;
    const centreP = pt.p.map((v, j) => v + B[j] * offset);
    onShell(centreP, lift);
    // Same width until the last third, then tapering to a point.
    const taper = s < 0.65 ? 1 : Math.max(1 - (s - 0.65) / 0.35, 0.03);
    const root = Math.min(1, 0.4 + s * 6); // slightly narrower where it leaves the head
    return { c: centreP, B: B2, N: N2, w: (width / 2) * Math.sqrt(taper) * root, h: (thickness / 2) * Math.max(taper, 0.3) };
  });

  // A flat cross-section with rounded edges (a superellipse), swept along the frames.
  const SIDES = 12;
  const positions = [];
  for (const f of frames) {
    for (let k = 0; k <= SIDES; k++) {
      const a = (2 * Math.PI * k) / SIDES;
      const cx = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** 0.45 * f.w;
      const cy = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** 0.45 * f.h;
      positions.push(...f.c.map((v, j) => v + f.B[j] * cx + f.N[j] * cy));
    }
  }
  const indices = [];
  const row = SIDES + 1;
  for (let i = 0; i < LOCK_STEPS; i++) {
    for (let k = 0; k < SIDES; k++) {
      const a = i * row + k, b = a + 1, c2 = a + row, d2 = c2 + 1;
      indices.push(a, c2, b, b, c2, d2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return smoothNormals(g);
}

// --- Geometry and material helpers ---------------------------------------

const toonGradients = new Map(); // one gradient texture per set of steps, shared by all models

// Cel-shading material: lighting falls into a few flat bands instead of a smooth gradient.
function toon(color, steps = TOON_STEPS) {
  let gradient = toonGradients.get(steps);
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
    toonGradients.set(steps, gradient);
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: gradient });
}

// Draws the back faces of a mesh pushed out along its normals, in a dark
// colour: this shows up as an outline around the mesh ("inverted hull").
// Drawn slightly behind the surface in depth, so it can't poke through hollows.
const outlineMaterial = new THREE.MeshBasicMaterial({
  color: LINE_COLOR, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
});
// (Written as a change to a built-in material so it also works on meshes bent by a skeleton.)
outlineMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed += normalize(normal) * ${OUTLINE_THICKNESS.toFixed(4)};`);
};

// A visible body part: a toon-shaded mesh with an outline.
function part(geometry, mat) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.castShadow = true;
  mesh.add(new THREE.Mesh(geometry, outlineMaterial));
  return mesh;
}

// Free the GPU memory used by a model that is being replaced.
function disposeTree(object) {
  object.traverse((child) => {
    if (child.isSkinnedMesh) child.skeleton.dispose();
    if (!child.isMesh || child.material === outlineMaterial || child.userData.sharedMaterial) return;
    if (!child.geometry.userData.cached) child.geometry.dispose();
    child.material.map?.dispose();
    child.material.dispose();
  });
}
