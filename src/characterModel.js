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
import { CharacterAnimator } from './characterAnimation.js';
import { ShieldEffect } from './shieldEffect.js';
import { headGeometry, eyePlacement, addFaceColour, eyeMaterial, headOutlineMaterial } from './headModel.js';
import { skirtGeometry, sleeveGeometry, SkirtMotion } from './clothingModel.js';
import { braidGeometry } from './braidModel.js';
import {
  WOUND_JOINT, woundCut, woundDistance, woundBones, addRot, DECAY_GLSL, DECAY_COLORS, EYELID_DROOP,
} from './decayModel.js';

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
const CLOTH_TOON_STEPS = [178, 222, 255];      // loose clothes: a little stronger than skin, so folds show

export class CharacterModel {
  // pose: how the character stands (see POSES), e.g. 'handsFolded' for an NPC.
  // decay: makes the character undead -- rot, torn clothes and wounds (see decayModel.js).
  // caster: whether they cast spells (their right hand can glow, see handGlow).
  constructor(appearance, { pose = 'stand', decay = null, caster = false } = {}) {
    this.root = new THREE.Group(); // add this to the scene; its origin is at the feet
    this.body = null;
    this.joints = {};
    this.pose = pose;
    this.decay = decay;
    this.caster = caster;
    this.animator = new CharacterAnimator();
    this.setAppearance(appearance);
  }

  // Play the walk, run and jump animations (see characterAnimation.js), and
  // move loose clothes and hair with the body.
  animate(state, dt) {
    this.animator.update(this.joints, state, dt, this.height, this.armPose);
    openMouth(this.mouth, this.animator.mouthOpen);
    for (const side of ['left', 'right']) {
      const wrist = this.joints[`${side}Wrist`];
      wrist.userData.bend.set(wrist.rotation.x, wrist.rotation.y, wrist.rotation.z);
    }
    this.glow?.set(this.animator.handGlow);
    const moving = this.animator.moving;
    for (const sleeve of this.sleeves) sleeve.morphTargetInfluences[0] = moving; // (drape for hanging arms)
    if (this.skirt) {
      this.body.updateMatrixWorld(true);
      const { weights, air } = this.animator;
      this.skirt.update(legSpheres(this.joints, this.build), {
        trail: Math.min(weights.run + weights.runBack, 1),
        billow: air * Math.min(Math.max(-(state.verticalSpeed ?? 0), 0), 1),
      });
      for (const follower of this.onSkirt) follower.update(this.skirt);
    }
  }

  // Play a gesture, e.g. 'follow' or 'dismiss' (see characterAnimation.js).
  gesture(name) {
    this.animator.gesture(name);
  }

  // Shield of Faith's membrane over the whole model: amount 0 (none) to 1.
  setShield(amount, time) {
    if (amount > 0) this.shield ??= new ShieldEffect(this);
    this.shield?.set(amount, time);
  }

  // React to being hit.
  flinch() {
    this.animator.flinch();
  }

  // Fall down dead.
  die() {
    this.animator.die();
  }

  // Rebuild the body to match a new appearance.
  setAppearance(appearance) {
    if (this.body) {
      this.root.remove(this.body);
      disposeTree(this.body);
    }
    const { body, joints, armPose, skirt, sleeves, onSkirt, mouth } = buildBody(appearance, this.pose, this.decay);
    this.shield = null; // (made again for the new body when needed)
    this.mouth = mouth;
    this.body = body;
    this.joints = joints;
    this.armPose = armPose;
    this.skirt = skirt;
    this.sleeves = sleeves;
    this.onSkirt = onSkirt;
    this.glow = this.caster ? handGlow(joints) : null;
    this.build = appearance.build;
    this.height = appearance.height;
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
const SKIRT_ARM_SPREAD = 0.22; // in a skirt, the arms hang a little further out, so the hands stay clear of it

// Other ways of standing, as extra joint rotations [x, y, z] (radians) for
// the right side (the left is mirrored). x swings a limb forwards; an elbow's
// x bends it.
const POSES = {
  stand: {},
  // Hands held together in front, at the waist.
  handsFolded: { shoulder: [0.25, 0.65, -0.05], elbow: [1.5, 0.8, 0] },
  // A zombie's arms reaching out in front, kept up even while walking.
  zombie: { shoulder: [1.3, 0, 0.02], elbow: [0.35, 0, 0], whileMoving: true },
};

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

function buildBody(a, poseName = 'stand', decay = null) {
  const mats = {
    skin:  toon(a.skinColor, SKIN_TOON_STEPS),
    shoes: toon(a.shoeColor),
    hair:  toon(a.hairColor),
    hairTie: toon(a.shirtColor),
    cloth: toon(a.shirtColor, CLOTH_TOON_STEPS), // loose clothes
  };
  const outfit = OUTFITS[a.outfit] ?? OUTFITS.casual;
  const w = a.build; // widens the torso, limbs and stance
  const m = a.bodyType === 'male' ? 1 : 0; // 0 female, 1 male (see SEX_SHAPE)

  // Skeleton, in the sculpting pose.
  const bone = (parent, x, y, z) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent?.add(b);
    return b;
  };
  const root = bone(null, 0, 0, 0);
  const joints = { root, head: bone(root, 0, BODY.neckTop, -0.025) }; // head forward, over the leaning neck
  const parts = [{ name: 'torso', bone: root, ...torso(w, m) }];
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? -1 : 1; // the character's left is -X
    const shoulder = bone(root, sign * BODY.shoulderSpread * w * sexMix(m, 'shoulders'), BODY.shoulderHeight, 0);
    const elbow = bone(shoulder, 0, -BODY.upperArmLength, 0);
    const hip = bone(root, sign * BODY.hipSpread * w * sexMix(m, 'hipSpread'), BODY.hipHeight, 0);
    const knee = bone(hip, 0, -BODY.thighLength, 0);
    const ankle = bone(knee, 0, -BODY.shinLength, 0);
    shoulder.rotation.z = sign * SCULPT_POSE.shoulder;
    hip.rotation.z = sign * SCULPT_POSE.hip;
    Object.assign(joints, {
      [`${side}Shoulder`]: shoulder, [`${side}Elbow`]: elbow,
      [`${side}Hip`]: hip, [`${side}Knee`]: knee, [`${side}Ankle`]: ankle,
    });
    parts.push(
      { name: 'upperArm', side, bone: shoulder, blend: BLEND.shoulder, ...upperArm(w * sexMix(m, 'arms'), sign) },
      { name: 'forearm', side, bone: elbow, blend: BLEND.elbow, ...forearm(w, sign) },
      { name: 'thigh', side, bone: hip, blend: BLEND.hip, ...thigh(w, sign) },
      { name: 'shin', side, bone: knee, blend: BLEND.knee, ...shin(w, sign) },
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
    // A wound: a band of the limb's flesh cut away (see decayModel.js).
    part.wound = decay?.wounds?.find((wd) => wd.limb === part.name && wd.side === part.side);
    if (part.wound) {
      const whole = local, wound = part.wound;
      local = (x, y, z) => Math.max(whole(x, y, z), woundCut(wound, y));
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
  const woundKey = (decay?.wounds ?? []).map((wd) => `${wd.side}${wd.limb}`).sort().join(',');
  const key = `${w.toFixed(3)}:${m}:${a.outfit}:${woundKey}`;
  let geometry = sculptCache.get(key);
  if (!geometry) {
    geometry = meshFromDistance(bodyDistance, sculptBounds(parts), SCULPT_DETAIL);
    // (A neckline's sides are placed relative to the shoulders, which vary with build and body type.)
    const shoulderEdge = outfit.shoulderEdge && outfit.shoulderEdge * w * sexMix(m, 'shoulders');
    addSkinWeightsAndClothes(geometry, parts, joints, { ...outfit, shoulderEdge });
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
  const skin = new THREE.SkinnedMesh(geometry, clothedSkinMaterial(a, decay));
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
    if (decay) addRot(hand.material, decay.seed + 3.1 * sign);
    hand.position.y = -BODY.forearmLength; // the hand's origin is the wrist
    hand.scale.set(...scale);
    joints[`${side}Elbow`].add(hand);
    // The wrist: its rotation bends the hand (see animate). (It isn't part of
    // the skeleton that bends the body, so it's added after that's made.)
    const wristJoint = new THREE.Object3D();
    wristJoint.userData.bend = hand.userData.wristBend;
    joints[`${side}Wrist`] = wristJoint;

    // Feet (see footModel.js), blended into the bottom of the legs.
    const footWidth = 1 + (w - 1) * 0.4; // build widens the feet a little
    const shinPart = parts.find((q) => q.name === 'shin' && q.bone === joints[`${side}Knee`]);
    const foot = createFoot({
      sign,
      material: toon(a.shoeColor, SKIN_TOON_STEPS), // shaded like the body, so the trouser leg matches
      pantsColor: outfit.pants === false ? a.skinColor : a.pantsColor, // (a bare leg under a skirt)
      skinColor: a.skinColor,
      sandals: a.footwear === 'sandals',
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
  const hair = buildHead(head, a, mats, decay);

  // Bones showing through wounds, carried by the limb's joint.
  for (const wound of decay?.wounds ?? []) {
    const sign = wound.side === 'left' ? -1 : 1;
    joints[`${wound.side}${WOUND_JOINT[wound.limb]}`].add(...woundBones(wound, sign, w, part, toon));
  }

  // Bend the sculpt into the standing pose.
  // The arms' rotations in the chosen pose ('rest') and hanging at the sides
  // ('moving'): the animations move between them (see characterAnimation.js).
  const armPose = { rest: {}, moving: {} };
  const setArms = (which) => {
    for (const name of Object.keys(armPose[which])) joints[name].rotation.set(...armPose[which][name]);
    body.updateMatrixWorld(true);
  };
  const pose = POSES[poseName] ?? POSES.stand;
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? -1 : 1;
    const turn = ([x, y, z] = [0, 0, 0], base = 0) => [x, sign * y, sign * (z + base)];
    const armsOut = outfit.skirt ? SKIRT_ARM_SPREAD : STAND_POSE.shoulder;
    armPose.rest[`${side}Shoulder`] = turn(pose.shoulder, armsOut);
    armPose.rest[`${side}Elbow`] = turn(pose.elbow);
    armPose.moving[`${side}Shoulder`] = pose.whileMoving ? armPose.rest[`${side}Shoulder`] : turn(undefined, armsOut);
    armPose.moving[`${side}Elbow`] = pose.whileMoving ? armPose.rest[`${side}Elbow`] : turn();
    joints[`${side}Hip`].rotation.z = sign * STAND_POSE.hip;
  }
  setArms('rest');

  // Loose clothes (see clothingModel.js), hanging from the posed body.
  let skirt = null;
  if (outfit.skirt) {
    skirt = cached(`skirt:${w.toFixed(3)}:${m}`, () => {
      const legsAndTorso = parts.filter((q) => ['torso', 'thigh', 'shin'].includes(q.name));
      return skirtGeometry((x, y, z) => {
        let d = legsAndTorso[0].distance(x, y, z);
        for (let i = 1; i < legsAndTorso.length; i++) d = smoothUnion(d, legsAndTorso[i].distance(x, y, z), legsAndTorso[i].blend);
        return d;
      }, w);
    });
  }
  // (Each character moves its own copy of the skirt -- see SkirtMotion.)
  let skirtMotion = null;
  if (skirt) {
    const own = skirt.clone();
    own.userData = { skirt: skirt.userData.skirt };
    skirtMotion = new SkirtMotion(own);
    const mesh = part(own, mats.cloth);
    mesh.traverse((o) => { o.frustumCulled = false; });
    root.add(mesh);
  }
  const sleeves = [];
  if (outfit.looseSleeves) {
    // Which way is down, as seen from each forearm (the sleeve drapes that
    // way), in the pose and with the arms hanging.
    const q = new THREE.Quaternion();
    const downs = {};
    for (const which of ['moving', 'rest']) {
      setArms(which);
      for (const side of ['left', 'right']) {
        (downs[side] ??= {})[which] = new THREE.Vector3(0, -1, 0)
          .applyQuaternion(joints[`${side}Elbow`].getWorldQuaternion(q).invert()).toArray();
      }
    }
    for (const side of ['left', 'right']) {
      const sleeve = part(sleeveGeometry(downs[side].rest, w, downs[side].moving), mats.cloth);
      joints[`${side}Elbow`].add(sleeve);
      sleeves.push(sleeve, sleeve.children[0]); // (and its outline)
    }
  }

  // A braid hangs from the back of the head down over the back (and skirt).
  const onSkirt = [];
  if (hair.braid) {
    const R = BODY.headRadius;
    const toBody = ([x, y, z]) => {
      const p = new THREE.Vector3(x * R, y * R + 0.85 * R, z * R);
      return head.localToWorld(p).applyMatrix4(body.matrixWorld.clone().invert()).toArray();
    };
    const skirtBack = skirt ? backProfile(skirt) : () => -Infinity;
    const { braid, endTie } = braidGeometry({
      start: toBody(hair.braid.start),
      endY: BODY.hipHeight - BODY.thighLength - 0.02, // down to the knees
      width: hair.braid.width * R * a.headSize,
      backOf: (y, x) => Math.max(backReach(parts[0].distance, y, x), skirtBack(y, x)),
    });
    root.add(part(braid, mats.hair), part(endTie, mats.hairTie));
    // Where the braid lies over the skirt, it moves with it.
    if (skirtMotion) onSkirt.push(new SkirtFollower(braid), new SkirtFollower(endTie));
  }

  return { body, joints, armPose, skirt: skirtMotion, sleeves, onSkirt, mouth: hair.mouth };
}

// Keeps something lying on a skirt (a braid) on its surface as the skirt moves.
class SkirtFollower {
  constructor(geometry) {
    this.geometry = geometry;
    this.rest = Float32Array.from(geometry.attributes.position.array);
  }

  update(skirt) {
    const pos = this.geometry.attributes.position.array, rest = this.rest;
    for (let v = 0; v < rest.length; v += 3) {
      const [dx, dy, dz] = skirt.offsetAt(rest[v], rest[v + 1], rest[v + 2]);
      pos[v] = rest[v] + dx;
      pos[v + 1] = rest[v + 1] + dy;
      pos[v + 2] = rest[v + 2] + dz;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}

// The legs as chains of spheres, in the root joint's coordinates (the
// skirt's): what a skirt has to stay outside of. (The arms are held out
// clear of a skirt instead -- see SKIRT_ARM_SPREAD.)
const LIMB_SPHERES = [
  // [joint, from, to, radius at start, radius at end, count] (points in the joint's coordinates)
  // (A little fuller than the sculpted legs, with their muscles, so they're safely covered.)
  ['Hip', [0, -0.05, 0], [0, -BODY.thighLength, 0], 0.092, 0.074, 9],
  ['Knee', [0, 0, 0], [0, -0.15, 0], 0.072, 0.07, 4],      // knee and calf
  ['Knee', [0, -0.2, 0], [0, -BODY.shinLength, 0], 0.062, 0.04, 5],
  ['Ankle', [0, -0.045, -0.02], [0, -0.05, -0.11], 0.042, 0.035, 3], // foot
];
const sphereList = [];
const limbPoint = new THREE.Vector3();
const toRoot = new THREE.Matrix4();

function legSpheres(joints, build) {
  const rootInverse = joints.root.matrixWorld.clone().invert();
  let n = 0;
  for (const side of ['left', 'right']) {
    for (const [joint, from, to, r0, r1, count] of LIMB_SPHERES) {
      toRoot.multiplyMatrices(rootInverse, joints[`${side}${joint}`].matrixWorld);
      for (let k = 0; k < count; k++) {
        const t = count > 1 ? k / (count - 1) : 0;
        limbPoint.set(...from.map((f, c) => f + (to[c] - f) * t)).applyMatrix4(toRoot);
        const s = (sphereList[n++] ??= {});
        s.x = limbPoint.x; s.y = limbPoint.y; s.z = limbPoint.z;
        s.r = (r0 + (r1 - r0) * t) * (joint === 'Hip' || joint === 'Knee' ? build : 1);
      }
    }
  }
  sphereList.length = n;
  return sphereList;
}

// A glow round the right hand, for casting spells: a bright core, a soft halo
// and a warm light that lights up the character (and anything near). Always
// there (dark when not in use), so the scene's lighting doesn't change.
// Returns { set(amount) } -- amount 0 (off) to 1 (full).
const GLOW = { color: '#ffd45c', core: '#fff4c2', size: 0.3, light: 0.35 };

function handGlow(joints) {
  const glow = new THREE.Group();
  glow.position.y = -BODY.forearmLength - 0.09; // (the middle of the hand)
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color: GLOW.core, ...additive }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: GLOW.color, ...additive }));
  const light = new THREE.PointLight(GLOW.color, 0, 0.8, 2);
  glow.add(core, halo, light);
  joints.rightElbow.add(glow);
  return {
    set(amount = 0) {
      core.visible = halo.visible = amount > 0.01;
      core.material.opacity = 0.8 * amount;
      halo.material.opacity = amount;
      halo.scale.setScalar(GLOW.size * (0.6 + 0.4 * amount));
      light.intensity = GLOW.light * amount;
    },
  };
}

// A soft round spot of light, fading out from the middle (for glows).
let glowMap = null;
export function glowTexture() {
  if (!glowMap) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    glowMap = new THREE.CanvasTexture(canvas);
    glowMap.colorSpace = THREE.SRGBColorSpace;
  }
  return glowMap;
}

// Reuses geometry that takes a while to make (e.g. while a character creator
// changes colours).
const geometryCache = new Map();
function cached(key, make) {
  let g = geometryCache.get(key);
  if (!g) {
    g = make();
    g.userData.cached = true;
    geometryCache.set(key, g);
    if (geometryCache.size > SCULPT_CACHE_SIZE * 2) {
      const [oldestKey, oldest] = geometryCache.entries().next().value;
      geometryCache.delete(oldestKey);
      oldest.dispose();
    }
  }
  return g;
}

// How far back (+z) a distance-function surface reaches at a height, at a
// sideways position x (-Infinity if it isn't there).
function backReach(distance, y, x) {
  let z = 0.4;
  for (let step = 0; step < 80 && z > -0.2; step++) {
    const d = distance(x, y, z);
    if (d < 0.0005) return z;
    z -= Math.max(d * 0.8, 0.001);
  }
  return -Infinity;
}

// The same for a mesh (the skirt): the furthest-back points of its surface,
// in bands of height.
function backProfile(geometry) {
  const pos = geometry.attributes.position;
  const band = 0.02;
  const bands = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getY(i) / band);
    if (!bands.has(k)) bands.set(k, []);
    bands.get(k).push([pos.getX(i), pos.getZ(i)]);
  }
  return (y, x) => {
    const list = bands.get(Math.round(y / band));
    if (!list) return -Infinity;
    let best = -Infinity;
    for (const [px, pz] of list) if (Math.abs(px - x) < 0.03) best = Math.max(best, pz);
    return best;
  };
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
function addSkinWeightsAndClothes(geometry, parts, joints, CLOTHES) {
  const bones = Object.values(joints);
  const pos = geometry.attributes.position;
  const count = pos.count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const shirtField = new Float32Array(count);
  const pantsField = new Float32Array(count);
  const woundField = new Float32Array(count).fill(1); // distance from a wound's cut faces (see decayModel.js)
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
    // Above the neckline is bare -- but for a neckline with sides (see
    // shoulderEdge), only between them.
    const neck = (px, py, pz) => {
      const below = CLOTHES.neckline(angleAround(px, pz, 0)) - py;
      if (!CLOTHES.shoulderEdge) return below;
      // (Rounded where the sides meet the front and back, rather than a sharp corner.)
      const side = Math.abs(px) - CLOTHES.shoulderEdge, k = 0.035;
      const h = Math.min(Math.max(0.5 + (0.5 * (side - below)) / k, 0), 1);
      return below + (side - below) * h + k * h * (1 - h);
    };
    const bodyShirt = clampField(Math.min(neck(x, y, z), y - CLOTHES.hem));
    const bodyPants = CLOTHES.pants === false ? -FIELD_LIMIT : clampField(CLOTHES.waist - y);
    const influence = new Map();
    let shirt = 0, pants = 0;
    parts.forEach((part, i) => {
      const share = weights[i] / total;
      if (share < 0.001) return;
      local.set(x, y, z).applyMatrix4(part.toPart);
      const along = -local.y; // distance down the limb from its joint
      if (part.wound && share > 0.3 && Math.hypot(local.x, local.z) < 0.1) {
        woundField[v] = Math.min(woundField[v], woundDistance(part.wound, local.y));
      }
      if (part.name === 'torso') {
        shirt += share * bodyShirt;
        pants += share * bodyPants;
        // The top of the neck turns with the head.
        const withHead = THREE.MathUtils.smoothstep(y, 1.56, 1.66);
        addInfluence(influence, joints.root, share * (1 - withHead));
        addInfluence(influence, joints.head, share * withHead);
        return;
      }
      const bare = -FIELD_LIMIT;
      // (A wide neckline can reach out over the top of the arm, so the
      // sleeve also stops at the neckline's height.)
      if (part.name === 'upperArm') { shirt += share * clampField(Math.min(CLOTHES.sleeve - along, neck(x, y, z))); pants += share * bare; }
      if (part.name === 'forearm') { shirt += share * (CLOTHES.cuff ? clampField(CLOTHES.cuff - along) : bare); pants += share * bare; }
      if (part.name === 'thigh' || part.name === 'shin') { shirt += share * bodyShirt; pants += share * (CLOTHES.pants === false ? bare : -bare); }
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
  geometry.setAttribute('woundField', new THREE.Float32BufferAttribute(woundField, 1));
}

function addInfluence(map, bone, weight) {
  map.set(bone, (map.get(bone) ?? 0) + weight);
}

// Where each outfit covers the body (heights in units). The fitted parts are
// painted onto the body in the shirt and pants colours; loose parts (a skirt,
// flowing sleeves) are separate meshes in the shirt colour (see clothingModel.js).
const OUTFITS = {
  // A T-shirt (its neckline dipping at the front) and trousers.
  casual: {
    neckline: (angle) => 1.482 - 0.02 * Math.cos(angle),
    hem: 1.06,     // bottom of the shirt
    waist: 1.115,  // top of the pants (under the shirt)
    sleeve: 0.15,  // sleeve length down the upper arm (ends below the armpit)
  },
  // A dress: a fitted bodice with a boat neck (a wide, shallow neckline
  // running straight across just below the collarbones, front and back, with
  // its sides at the edges of the shoulders -- where the top of the shoulder
  // curves down into the arm -- so it sits almost off them),
  // long sleeves opening out from the elbows, and a flowing calf-length skirt
  // (bare legs below it).
  dress: {
    neckline: (angle) => 1.44 - 0.004 * Math.cos(angle),
    shoulderEdge: 0.186, // how far out the neckline's sides are (at default build)
    hem: 0.6,      // the bodice's painted cloth ends here, hidden under the skirt
    pants: false,
    sleeve: 1,     // the whole upper arm...
    cuff: 0.1,     // ...and the top of the forearm (inside the loose sleeve, which ends mid-forearm)
    skirt: true,
    looseSleeves: true,
  },
};
const FIELD_LIMIT = 0.05; // coverage values are capped so blends between parts stay local

function clampField(value) {
  return Math.min(Math.max(value, -FIELD_LIMIT), FIELD_LIMIT);
}

// Skin-toned toon material that paints the shirt and pants onto the body, with
// crisp edges and a thin line along each hem.
// With `decay` (see decayModel.js), the skin rots in patches, the clothes are
// torn (ragged hems, rips, and torn away round wounds), and wounds' cut faces
// are raw flesh with blood spattered round them.
function clothedSkinMaterial(a, decay = null) {
  const mat = toon('#ffffff', SKIN_TOON_STEPS);
  const uniforms = {
    skinColor: { value: new THREE.Color(a.skinColor) },
    shirtColor: { value: new THREE.Color(a.shirtColor) },
    pantsColor: { value: new THREE.Color(a.pantsColor) },
    lineColor: { value: new THREE.Color(LINE_COLOR) },
    decaySeed: { value: decay?.seed ?? 0 },
    fleshColor: { value: DECAY_COLORS.flesh },
    bloodColor: { value: DECAY_COLORS.blood },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float shirtField;
attribute float pantsField;
attribute float woundField;
varying float vShirt;
varying float vPants;
varying float vWound;
varying vec3 vDecayPos;
${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vShirt = shirtField;
  vPants = pantsField;
  vWound = woundField;
  vDecayPos = position;`)}`;
    shader.fragmentShader = `uniform vec3 skinColor;
uniform vec3 shirtColor;
uniform vec3 pantsColor;
uniform vec3 lineColor;
uniform float decaySeed;
uniform vec3 fleshColor;
uniform vec3 bloodColor;
varying float vShirt;
varying float vPants;
varying float vWound;
varying vec3 vDecayPos;
${decay ? DECAY_GLSL : ''}
${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    float shirtV = vShirt, pantsV = vPants;
    vec3 skin = skinColor;
${decay ? `
    // Torn clothes: ragged hems, rips, and torn away round wounds.
    float ragged = (decayNoise(vDecayPos * 45.0 + decaySeed) - 0.5) * 0.03;
    float torn = min(-decayRip(vDecayPos, decaySeed) * 0.5, vWound - 0.035);
    shirtV = min(shirtV + ragged, torn);
    pantsV = min(pantsV + ragged, torn);
    skin = decaySkin(skin, vDecayPos, decaySeed);` : ''}
    // Edges are measured in pixels, so they stay crisp at any distance. The
    // hem lines are the same thickness on the body as the outlines, thinning
    // with distance like them (but never quite vanishing).
    float shirtW = fwidth(shirtV) + 1e-6, pantsW = fwidth(pantsV) + 1e-6;
    float shirt = smoothstep(-0.5, 0.5, shirtV / shirtW);
    float pants = smoothstep(-0.5, 0.5, pantsV / pantsW) * (1.0 - shirt);
    vec3 cloth = mix(mix(skin, pantsColor, pants), shirtColor, shirt);
    float halfLine = ${(OUTLINE_THICKNESS / 2).toFixed(5)};
    float shirtLine = 1.0 - smoothstep(-0.5, 0.5, (abs(shirtV) - max(halfLine, shirtW * 0.3)) / shirtW);
    float pantsLine = 1.0 - smoothstep(-0.5, 0.5, (abs(pantsV) - max(halfLine, pantsW * 0.3)) / pantsW);
    float edge = max(shirtLine, pantsLine * (1.0 - shirt));
${decay ? `
    // Wounds: raw flesh on the cut faces, and blood spattered round them.
    cloth = mix(cloth, bloodColor, decaySpatter(vDecayPos, vWound, decaySeed));
    float cutFace = 1.0 - smoothstep(0.0015, 0.004, vWound);
    cloth = mix(cloth, fleshColor, cutFace);
    edge *= 1.0 - cutFace;` : ''}
    diffuseColor.rgb *= mix(cloth, lineColor, edge);
  }`)}`;
  };
  mat.customProgramCacheKey = () => (decay ? 'clothed-skin-decay' : 'clothed-skin');
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

// Female and male body shapes: multipliers of the base sculpt's widths
// (female, male). Female: wider hips, narrower waist, narrower shoulders;
// male: wider shoulders and chest, narrower hips, a thicker neck.
const SEX_SHAPE = {
  hips: [1.06, 0.92],       // torso width around the hips
  waist: [0.96, 1.04],
  chest: [0.98, 1.08],
  shoulders: [0.96, 1.16],  // the trapezius slope, and how far apart the arms are
  neck: [0.96, 1.1],
  hipSpread: [1.06, 0.92],  // how far apart the legs are
  arms: [0.97, 1.06],       // upper arm thickness
};

function sexMix(m, key) {
  const [f, male] = SEX_SHAPE[key];
  return f + (male - f) * m;
}

// Width multiplier for the torso at a given height.
function torsoSexScale(y, m) {
  const zones = [[0.86, 'hips'], [1.08, 'hips'], [1.17, 'waist'], [1.33, 'chest'], [1.46, 'shoulders'], [1.54, 'neck']];
  if (y <= zones[0][0]) return sexMix(m, 'hips');
  for (let i = 1; i < zones.length; i++) {
    if (y <= zones[i][0]) {
      const [y0, k0] = zones[i - 1], [y1, k1] = zones[i];
      const t = (y - y0) / (y1 - y0);
      return sexMix(m, k0) * (1 - t) + sexMix(m, k1) * t;
    }
  }
  return sexMix(m, 'neck');
}

function torso(w, m) {
  return { shape: torsoShape(w, m), bumps: torsoMuscles(m), range: [0.86, 1.7] };
}

function torsoShape(w, m) {
  const keys = scaled([
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
  ], w, 1.5);
  // Female / male widths (the chest and neck deepen a little too).
  return profile(keys.map(([y, rx, rz, cz]) => {
    const k = torsoSexScale(y, m);
    const deep = y > 1.2 ? 1 + (k - 1) * 0.5 : 1;
    return [y, rx * k, rz * deep, cz];
  }));
}

function torsoMuscles(sex) {
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
  // Breasts (female): two rounded forms on the chest, joined by a fill
  // between them -- a single smooth shape, as they are when clothed.
  if (sex < 1) {
    const f = 1 - sex;
    m.push(
      // (Broad, overlapping shapes, so they're rounded rather than pointed.)
      blob({ angle: -0.42, y: 1.295, amp: 0.02 * f, width: 0.075, height: 0.07 }),
      blob({ angle: 0.42, y: 1.295, amp: 0.02 * f, width: 0.075, height: 0.07 }),
      blob({ angle: -0.4, y: 1.285, amp: 0.008 * f, width: 0.05, height: 0.045 }),
      blob({ angle: 0.4, y: 1.285, amp: 0.008 * f, width: 0.05, height: 0.045 }),
      blob({ angle: 0, y: 1.29, amp: 0.017 * f, width: 0.06, height: 0.06 }),
      blob({ angle: 0, y: 1.345, amp: 0.01 * f, width: 0.12, height: 0.05 }), // softening the top edge into the chest
    );
  }
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
      blob({ angle: s * 1.9, y: 1.465, amp: 0.012 + 0.006 * sex, width: 0.06, height: 0.04 }),
      ridge({ from: [s * 2.5, 1.6], to: [s * 1.45, 1.455], amp: 0.007, width: 0.025 }),
      // ...its lower edges, running from the shoulder blades to the middle of the back...
      ridge({ from: [s * 2.2, 1.44], to: [Math.PI, 1.2], amp: 0.005, width: 0.02 }),
      // ...and the hollow above the collarbone, between it and the neck.
      blob({ angle: s * 0.9, y: 1.475, amp: -0.005, width: 0.03, height: 0.015 }),
      ridge({ from: [s * 0.18, 1.468], to: [s * 1.15, 1.452], amp: 0.006, width: 0.009 }), // collarbone
      blob({ angle: s * 1.45, y: 1.448, amp: 0.004, width: 0.018, height: 0.014 }),       // acromion (bony point on top of the shoulder)
      ridge({ from: [s * 0.95, 1.45], to: [s * 1.2, 1.33], amp: -0.004, width: 0.011 }),  // groove between the deltoid and the pec
      blob({ angle: s * 0.42, y: 1.335, amp: 0.006 + 0.012 * sex, width: 0.055, height: 0.045 }), // pectoral (stronger on the male)
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

function buildHead(head, a, mats, decay = null) {
  const R = BODY.headRadius;
  const centre = new THREE.Group(); // centre of the skull
  centre.position.y = 0.85 * R;
  head.add(centre);

  // The sculpted head (see headModel.js), with eyebrows and blush coloured on.
  const brow = new THREE.Color(a.hairColor).multiplyScalar(0.7);
  let skin = addFaceColour(toon(a.skinColor, SKIN_TOON_STEPS), brow, R, a.eyeSize, { blush: a.blush, freckles: a.freckles });
  if (decay) skin = addRot(skin, decay.seed + 7.7);
  const headMesh = new THREE.Mesh(headGeometry(a.eyeSize, R, a.bodyType === 'male' ? 1 : 0, decay ? EYELID_DROOP : 0), skin);
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
      eyeMaterial(toon('#ffffff', SKIN_TOON_STEPS), a.eyeColor, sign, { glints: !decay }),
    );
    eyeball.position.set(x * R, y * R, z * R);
    eyeball.rotation.y = -sign * eyes.yaw; // turned outwards, wrapping round the head
    eyeball.scale.x = eyes.widen;
    centre.add(eyeball);
  }

  // The open mouth (hidden while it's closed): a dark opening over the line
  // between the lips, which opens up and down (see openMouth).
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), mouthMaterial);
  mouth.position.set(0, MOUTH.y * R, MOUTH.z * R);
  mouth.userData = { size: MOUTH.size.map((v) => v * R), baseY: MOUTH.y * R, sharedMaterial: true };
  mouth.visible = false;
  mouth.renderOrder = 1;
  centre.add(mouth);

  return { ...buildHair(centre, a.hairStyle, mats), mouth };
}

// Where the mouth opens, in head radii (on the line between the lips; see
// mouthDistance in headModel.js), and its size fully open [half width, half
// height, depth].
const MOUTH = { y: -0.835, z: -0.845, size: [0.1, 0.075, 0.03] };
const mouthMaterial = new THREE.MeshBasicMaterial({
  color: '#4a1b25', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

// open: 0 (closed) to 1 (wide open). Opens mostly downwards, like a jaw.
function openMouth(mouth, open = 0) {
  if (!mouth) return;
  mouth.visible = open > 0.03;
  if (!mouth.visible) return;
  const [w, h, d] = mouth.userData.size;
  mouth.scale.set(w * (0.75 + 0.25 * open), h * open, d);
  mouth.position.y = mouth.userData.baseY - h * open * 0.35;
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

// Returns what the rest of the body needs to know about the hair: for a braid,
// where it starts (see braidedHair).
function buildHair(centre, style, mats) {
  const hairMat = mats.hair;
  if (style === 'none') return {};
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
      o.raise = (options.raise ?? 0) + (k ? 0 : 0.02); // the middle ribbon lies on top
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

  if (style === 'braid') return braidedHair(hair, lock, hairMat, mats.hairTie);

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
  return {};
}

// Braided: parted off-centre (on the left), with the bangs swept across the
// forehead to the other side, and everything else drawn back to the nape, where the
// hair bunches out over a tie ("muffin-topping" it) and goes into a thick braid.
// The braid itself hangs over the body, so it's made with the body (see
// braidModel.js); this returns where it starts and how wide it is.
const PART_X = -0.3;                   // where the parting is (on a unit sphere): left of centre
const BRAID_GATHER = [0, -0.66, 0.94]; // where the hair is drawn back to (head radii), inside the bunch over the tie
const BRAID_TIE = { y: -0.93, z: 0.95, radius: 0.24 };

function braidedHair(hair, lock, hairMat, tieMat) {
  // A point on the hair's base layer, above (x, z) on a unit sphere.
  const onScalp = (x, z) => {
    const y = Math.sqrt(Math.max(1 - x * x - z * z, 0));
    return [x, y, z].map((v, i) => SKULL.centre[i] + v * SKULL.radii[i] * HAIR_SHELL);
  };
  const back = { target: BRAID_GATHER, steer: 0.14, closedRoot: true };

  // Bangs: from the front of the parting, swept across the forehead to the
  // other temple, the front ones reaching lowest (over the edge of that eye).
  const away = -Math.sign(PART_X); // the direction the bangs sweep
  [[-0.92, -0.32], [-0.84, -0.22], [-0.74, -0.12], [-0.62, -0.02]].forEach(([z, endY], i) => lock({
    from: onScalp(PART_X, z), dir: [away, -0.2, -0.3], length: 3, width: 0.36, sway: 0.06 * (i % 2 ? 1 : -1), twist: 0.3,
    target: [away * 1.1, endY - 0.1, -0.36], steer: 0.07, closedRoot: true, // (the tips lift off past the temple)
  }));
  // The rest of the larger side, from the parting back to the nape.
  for (const z of [-0.5, -0.3, -0.1, 0.1, 0.3]) {
    lock({ from: onScalp(PART_X, z), dir: [away, -0.1, 0.35], length: 4, width: 0.4, ...back });
  }
  // The smaller side of the parting.
  for (const z of [-0.9, -0.68, -0.45, -0.2, 0.05, 0.3]) {
    lock({ from: onScalp(PART_X - away * 0.03, z), dir: [-away, -0.25, 0.3], length: 4, width: 0.36, ...back });
  }
  // Along the sides of the face and back over the ears (standing off the
  // head a little so the ears stay covered), and the back of the head.
  for (const sign of [-1, 1]) {
    lock({ from: onScalp(sign * 0.9, -0.38), dir: [0, -0.35, 1], length: 3.5, width: 0.4, raise: 0.07, ...back, steer: 0.2 });
    lock({ from: onScalp(sign * 0.93, -0.1), dir: [0, -0.3, 1], length: 3.5, width: 0.4, raise: 0.05, ...back, steer: 0.2 });
    lock({ from: onScalp(sign * 0.75, 0.25), dir: [0, -0.5, 1], length: 3.5, width: 0.4, ...back });
    lock({ from: onScalp(sign * 0.4, 0.65), dir: [0, -0.8, 0.6], length: 3, width: 0.4, ...back });
  }
  lock({ from: onScalp(0, 0.7), dir: [0, -0.8, 0.5], length: 3, width: 0.42, ...back });

  // Gathered at the nape: the hair bunches out above the tie and over it.
  const bunch = [[0, -0.72, 0.98, 0.42, 0.29, 0.31], [-0.22, -0.78, 0.92, 0.27, 0.25, 0.29], [0.22, -0.78, 0.92, 0.27, 0.25, 0.29]];
  for (const [x, y, z, rx, ry, rz] of bunch) {
    const g = new THREE.SphereGeometry(1, 24, 16);
    g.scale(rx, ry, rz);
    g.translate(x, y, z);
    hair.add(part(smoothNormals(g), hairMat));
  }
  // The hair going through the tie, and the tie.
  const gathered = new THREE.SphereGeometry(1, 20, 14);
  gathered.scale(0.23, 0.16, 0.23);
  gathered.translate(0, BRAID_TIE.y - 0.04, BRAID_TIE.z);
  hair.add(part(smoothNormals(gathered), hairMat));
  const tie = new THREE.TorusGeometry(BRAID_TIE.radius, 0.07, 10, 28);
  tie.rotateX(Math.PI / 2);
  tie.translate(0, BRAID_TIE.y, BRAID_TIE.z);
  hair.add(part(smoothNormals(tie), tieMat));

  return { braid: { start: [0, BRAID_TIE.y - 0.1, BRAID_TIE.z], width: 0.74 } };
}

// Evenly spaced points along a path of points ({ p, n }), by distance.
function resamplePath(points, count) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(...points[i].p.map((v, j) => v - points[i - 1].p[j])));
  const total = lengths[lengths.length - 1];
  const out = [];
  let k = 1;
  for (let i = 0; i < count; i++) {
    const s = (total * i) / (count - 1);
    while (k < points.length - 1 && lengths[k] < s) k++;
    const a = points[k - 1], b = points[k];
    const t = Math.min(Math.max((s - lengths[k - 1]) / (lengths[k] - lengths[k - 1] || 1), 0), 1);
    out.push({ p: a.p.map((v, j) => v + (b.p[j] - v) * t), n: normalizeV(a.n.map((v, j) => v + (b.n[j] - v) * t)) });
  }
  return out;
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
//   target, steer: a point it is drawn towards (instead of falling), and how strongly
//   closedRoot: taper the start to a point too (for locks that start in plain view, e.g. at a parting)
function ribbonLock({ az, polar, from, dir, length, width, sway = 0, twist = 0, raise = 0, target, steer = 0, closedRoot = false }) {
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
  let points = [];
  for (let i = 0; i <= LOCK_STEPS; i++) {
    const n = onShell(p, lift);
    points.push({ p: [...p], n });
    if (target) {
      // Drawn towards the target, ending when it gets there.
      const to = target.map((v, j) => v - p[j]);
      const dist = Math.hypot(...to);
      if (dist < ds) break;
      // (Turning harder close to it, so it can't circle round it.)
      const k = Math.min(1, Math.max(steer, (1.5 * ds) / dist));
      d = normalizeV(d.map((v, j) => v * (1 - k) + (to[j] / dist) * k));
    } else {
      d = normalizeV([d[0], d[1] - 0.09, d[2]]);
    }
    // Slide along the head rather than into it.
    const into = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    if (into < 0 && Math.hypot(...p.map((v, j) => (v - SKULL.centre[j]) / SKULL.radii[j])) <= HAIR_SHELL + lift + 1e-6) {
      d = normalizeV(d.map((v, j) => v - into * n[j]));
    }
    p = p.map((v, j) => v + d[j] * ds);
  }
  // (A lock that ended early is spread back over the full number of steps.)
  if (points.length < LOCK_STEPS + 1) points = resamplePath(points, LOCK_STEPS + 1);

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
    const root = closedRoot ? Math.sqrt(Math.min(1, 0.002 + s * 8)) : Math.min(1, 0.4 + s * 6); // slightly narrower where it leaves the head
    return { c: centreP, B: B2, N: N2, w: (width / 2) * Math.sqrt(taper) * root, h: (thickness / 2) * Math.max(taper, 0.3) * (closedRoot ? root : 1) };
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
