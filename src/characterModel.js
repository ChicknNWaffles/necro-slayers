// Character model: builds the player's 3D body from an appearance
// (see characterAppearance.js). Part of the renderer -- it only draws.
//
// Anime style: a sculpted body (see sculptedSurface.js), cel (toon) shading,
// dark outlines, large drawn eyes and hair made of individual pointed locks.
// The body is rebuilt whenever the appearance changes, so a character creator
// can edit it live. Limbs hang from named joints so they can be animated later.
import * as THREE from '../node_modules/three/build/three.module.js';
import { buildDepth } from './characterAppearance.js';
import {
  profile, blob, ridge, partDistance, smoothUnion, meshFromDistance, angleAround, smoothNormals,
} from './sculptedSurface.js';
import { createHand } from './handModel.js';
import { createFoot } from './footModel.js';
import { CharacterAnimator } from './characterAnimation.js';
import { ShieldEffect } from './shieldEffect.js';
import { createWeapon } from './weaponModel.js';
import { addSkeletonBones } from './skeletonModel.js';
import { headGeometry, eyePlacement, addFaceColour, eyeMaterial, headOutlineMaterial } from './headModel.js';
import { skirtGeometry, ROBE_SKIRT, sleeveGeometry, SkirtMotion, tunicSkirt, looseTube as looseTubeShape, fabricGeometry } from './clothingModel.js';
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
  // decay: makes the character undead -- rot, torn clothes and wounds (see
  //   decayModel.js). With decay.skeletal, they're a bare skeleton, in a torn shirt.
  // caster: whether they cast spells (their hands can glow, see handGlow) --
  //   true, or the kind of magic: 'holy' (golden, the default) or 'fire'.
  // weapons: the weapons they carry, e.g. ['sword', 'shield'] (see WEAPON_GRIP).
  constructor(appearance, { pose = 'stand', decay = null, caster = false, weapons = [] } = {}) {
    this.root = new THREE.Group(); // add this to the scene; its origin is at the feet
    this.body = null;
    this.joints = {};
    // (Armed, they stand ready with their weapons -- see POSES.)
    this.pose = pose === 'stand' && weapons.length ? weaponStance(weapons) ?? pose : pose;
    this.decay = decay;
    this.caster = caster;
    this.weaponNames = weapons;
    this.animator = new CharacterAnimator();
    this.setAppearance(appearance);
  }

  // Play the walk, run and jump animations (see characterAnimation.js), and
  // move loose clothes and hair with the body.
  animate(state, dt) {
    this.animator.update(this.joints, state, dt, this.height, this.armPose);
    openMouth(this.mouth, this.animator.mouthOpen);
    // A weapon in the right hand turns in the grip as a gesture swings it.
    for (const weapon of Object.values(this.weapons)) {
      const { grip } = this.animator;
      weapon.quaternion.setFromEuler(gripEuler.set(...weapon.userData.grip.rotation));
      if (!grip || weapon.userData.grip.joint !== 'rightElbow') continue;
      gripA.setFromEuler(gripEuler.set(...grip.from));
      gripB.setFromEuler(gripEuler.set(...grip.to));
      gripA.slerp(gripB, grip.f);
      weapon.quaternion.slerp(gripA, grip.weight);
    }
    for (const side of ['left', 'right']) {
      const wrist = this.joints[`${side}Wrist`];
      wrist.userData.bend.set(wrist.rotation.x, wrist.rotation.y, wrist.rotation.z);
    }
    // (A gesture can glow in another colour of its own, e.g. green for vines.)
    this.glow?.set(this.animator.handGlow, this.animator.bothHandsGlow, GLOWS[this.animator.glowKind ?? this.glowKind] ?? GLOWS.holy);
    const moving = this.animator.moving;
    for (const sleeve of this.sleeves) sleeve.morphTargetInfluences[0] = moving; // (drape for hanging arms)
    if (this.skirt) {
      this.body.updateMatrixWorld(true);
      const { weights, air } = this.animator;
      this.skirt.update(legSpheres(this.joints, Math.max(this.build, buildDepth(this.build)) * (this.loosePants ? 1.3 : 1)), {
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

  // Where the middle of the right palm is, in the world (e.g. for a beam
  // shining from it).
  palmPosition(target = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return this.joints.rightElbow.localToWorld(target.set(0, -BODY.forearmLength - 0.09, 0));
  }

  // Show or hide a weapon (e.g. a dagger, only drawn when it's in use).
  showWeapon(name, visible) {
    if (this.weapons[name]) this.weapons[name].visible = visible;
  }

  // Whether the crossbow has a bolt in it.
  setLoaded(loaded) {
    const bolt = this.weapons.crossbow?.userData.bolt;
    if (bolt) bolt.visible = loaded;
  }

  cancelGesture() {
    this.animator.cancelGesture();
  }

  // Raise (or lower) a shield to block.
  setBlocking(blocking) {
    this.animator.blocking = blocking;
  }

  // React to being hit.
  flinch() {
    this.animator.flinch();
  }

  // Fall down dead.
  die() {
    this.animator.die();
  }

  // Release a preview model when character creation finishes.
  dispose() {
    if (this.body) disposeTree(this.body);
    this.root.clear();
    this.body = null;
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
    this.glow = this.caster ? handGlow(joints, GLOWS[this.caster] ?? GLOWS.holy) : null;
    this.glowKind = this.caster;
    this.weapons = {};
    for (const name of this.weaponNames) {
      const grip = WEAPON_GRIP[name];
      const weapon = createWeapon(name, { part, toon });
      weapon.position.set(...grip.position);
      weapon.rotation.set(...grip.rotation);
      weapon.userData.grip = grip;
      joints[grip.joint].add(weapon);
      this.weapons[name] = weapon;
    }
    this.build = appearance.build * (1 + ((appearance.legWeight ?? 1) - 1) * 0.55);
    this.loosePants = appearance.pantsFit === 'loose';
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
const TUNIC_ARM_SPREAD = 0.15; // (and a little, to clear a tunic's hem)

// Other ways of standing, as extra joint rotations [x, y, z] (radians) for
// the right side (the left is mirrored). x swings a limb forwards; an elbow's
// x bends it.
const POSES = {
  stand: {},
  // Hands held together in front, at the waist.
  handsFolded: { shoulder: [0.25, 0.65, -0.05], elbow: [1.5, 0.8, 0] },
  // A zombie's arms reaching out in front, kept up even while walking.
  zombie: { shoulder: [1.3, 0, 0.02], elbow: [0.35, 0, 0], whileMoving: true },
  // Armed stances (see WEAPON_GRIP), kept while walking, with the arms
  // swinging less (armSwing). Poses can differ for each arm ('right', 'left').
  // Sword and shield: the sword held up in front, ready; the shield carried
  // forward on the left arm.
  swordAndShield: {
    right: { shoulder: [0.35, 0, 0.02], elbow: [0.45, 0, 0] },
    left: { shoulder: [0.3, 0, 0], elbow: [0.9, 0, 0] },
    whileMoving: true, armSwing: 0.35,
  },
  // Halberd: held in both hands, diagonally across the body, the head up by
  // the left shoulder.
  halberd: {
    right: { shoulder: [0.4, 0, 0], elbow: [1.0, 0, 0] },
    left: { shoulder: [0.7, 0.5, -0.25], elbow: [1.2, 0, 0] },
    whileMoving: true, armSwing: 0,
  },
  // A sword alone: held ready in the right hand, the left arm free.
  sword: {
    right: { shoulder: [0.35, 0, 0.02], elbow: [0.45, 0, 0] },
    whileMoving: true, armSwing: 0.5,
  },
  // Bow: carried in the left hand, forearm raised so it's held upright.
  bow: {
    left: { shoulder: [0.3, 0, 0.05], elbow: [1.1, 0, 0] },
    whileMoving: true, armSwing: 0.5,
  },
  // Crossbow: held low in front in both hands.
  crossbow: {
    right: { shoulder: [0.3, 0, 0.05], elbow: [1.1, 0, 0] },
    left: { shoulder: [0.45, 0.5, -0.1], elbow: [1.2, 0, 0] },
    whileMoving: true, armSwing: 0,
  },
};

// The stance for a set of weapons.
export function weaponStance(weapons) {
  if (weapons.includes('sword') && !weapons.includes('shield')) return 'sword';
  if (weapons.includes('crossbow')) return 'crossbow';
  if (weapons.includes('shortbow') || weapons.includes('longbow')) return 'bow';
  if (weapons.includes('halberd')) return 'halberd';
  if (weapons.includes('sword') || weapons.includes('shield')) return 'swordAndShield';
  return null;
}

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
  const outfit = outfitSpec(a);
  const w = a.build;
  const armW = w * (1 + ((a.armWeight ?? 1) - 1) * 0.55);
  const legW = w * (1 + ((a.legWeight ?? 1) - 1) * 0.55);
  const proportionKey = [a.chestWeight, a.bellyWeight, a.hipWeight, a.armWeight, a.legWeight].map(v => (v ?? 1).toFixed(3)).join(':');
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
  // (A skeleton's shirt hangs on bare bones: no breasts, whatever the body type.)
  const flatChest = Boolean(decay?.skeletal);
  const straightTunic = m === 1 && (outfit.robes || (outfit.tunic && !outfit.tunic.tied));
  const parts = [{ name: 'torso', bone: root, ...torso(w, m, flatChest, straightTunic, a) }];
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
      { name: 'upperArm', side, bone: shoulder, blend: BLEND.shoulder, ...upperArm(armW * sexMix(m, 'arms'), sign) },
      { name: 'forearm', side, bone: elbow, blend: BLEND.elbow, ...forearm(armW, sign) },
      { name: 'thigh', side, bone: hip, blend: BLEND.hip, ...thigh(legW, sign) },
      { name: 'shin', side, bone: knee, blend: BLEND.knee, ...shin(legW, sign) },
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
  const key = `${w.toFixed(3)}:${m}:${outfit.key}:${proportionKey}:${woundKey}:${flatChest}`;
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
  // (A skeleton keeps only the body's shirt, drawn from both sides as there's
  // no body inside it -- see clothedSkinMaterial.)
  const skeletal = Boolean(decay?.skeletal);
  const skin = new THREE.SkinnedMesh(geometry, clothedSkinMaterial(a, decay));
  const outline = new THREE.SkinnedMesh(geometry, skeletal ? shirtOutlineMaterial : outlineMaterial);
  for (const m of [skin, outline]) {
    m.frustumCulled = false;
    body.add(m);
  }
  skin.castShadow = true;
  // A mail shirt, over the body (see chainmailMaterial).
  const wearsMail = a.armor === 'chainmail' && !skeletal;
  const mail = wearsMail ? new THREE.SkinnedMesh(geometry, chainmailMaterial()) : null;
  if (mail) { mail.frustumCulled = false; body.add(mail); }
  body.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(Object.values(joints));
  skin.bind(skeleton);
  outline.bind(skeleton);
  mail?.bind(skeleton);

  // A skeleton's bones (see skeletonModel.js) in place of hands, feet and a head.
  if (skeletal) {
    const wrists = addSkeletonBones(joints, BODY, { part, toon });
    joints.leftWrist = wrists.left;
    joints.rightWrist = wrists.right;
  }

  // Hands (detailed, see handModel.js) and shoes, carried by their joints.
  for (const side of skeletal ? [] : ['left', 'right']) {
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
      // (A bare leg under a skirt; with boots, the boot's leather all the way up.)
      pantsColor: a.footwear === 'boots' ? a.shoeColor : outfit.pants === false ? a.skinColor : a.pantsColor,
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
  const hair = skeletal ? {} : buildHead(head, a, mats, decay);

  // Bones showing through wounds, carried by the limb's joint.
  for (const wound of decay?.wounds ?? []) {
    const sign = wound.side === 'left' ? -1 : 1;
    joints[`${wound.side}${WOUND_JOINT[wound.limb]}`].add(...woundBones(wound, sign, w, part, toon));
  }

  // Bend the sculpt into the standing pose.
  // The arms' rotations in the chosen pose ('rest') and hanging at the sides
  // ('moving'): the animations move between them (see characterAnimation.js).
  const armPose = { rest: {}, moving: {}, swing: 1 };
  const setArms = (which) => {
    for (const name of Object.keys(armPose[which])) joints[name].rotation.set(...armPose[which][name]);
    body.updateMatrixWorld(true);
  };
  const pose = POSES[poseName] ?? POSES.stand;
  armPose.swing = pose.armSwing ?? 1;
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? -1 : 1;
    const turn = ([x, y, z] = [0, 0, 0], base = 0) => [x, sign * y, sign * (z + base)];
    const armsOut = (outfit.skirt ? SKIRT_ARM_SPREAD : outfit.tunicSkirt ? TUNIC_ARM_SPREAD : STAND_POSE.shoulder) + Math.max(0, w - 1) * 0.2 + Math.max(0, (a.hipWeight ?? 1) - 1) * 0.12;
    const arm = pose[side] ?? pose;
    armPose.rest[`${side}Shoulder`] = turn(arm.shoulder, armsOut);
    armPose.rest[`${side}Elbow`] = turn(arm.elbow);
    armPose.moving[`${side}Shoulder`] = pose.whileMoving ? armPose.rest[`${side}Shoulder`] : turn(undefined, armsOut);
    armPose.moving[`${side}Elbow`] = pose.whileMoving ? armPose.rest[`${side}Elbow`] : turn();
    joints[`${side}Hip`].rotation.z = sign * STAND_POSE.hip;
  }
  setArms('rest');

  // Loose clothes (see clothingModel.js), hanging from the posed body.
  let skirt = null;
  if (outfit.skirt || outfit.tunicSkirt) {
    // (A dress's full skirt, or the hanging lower half of a tunic.)
    const spec = outfit.tunicSkirt ? tunicSkirt(outfit.tunicSkirt, outfit.tunic.tied) : outfit.robes ? ROBE_SKIRT : undefined;
    skirt = cached(`skirt:${proportionKey}:${w.toFixed(3)}:${m}:${outfit.tunicSkirt ?? outfit.key}:${flatChest}:${a.pantsFit}`, () => {
      const legsAndTorso = parts.filter((q) => ['torso', 'thigh', 'shin'].includes(q.name));
      return skirtGeometry((x, y, z) => {
        let d = legsAndTorso[0].distance(x, y, z);
        for (let i = 1; i < legsAndTorso.length; i++) {
          const looseAllowance = a.pantsFit === 'loose' && outfit.tunicSkirt ? 0.033 * w : 0;
          d = smoothUnion(d, legsAndTorso[i].distance(x, y, z) - looseAllowance, legsAndTorso[i].blend);
        }
        return d;
      }, w, spec);
    });
  }
  // (Each character moves its own copy of the skirt -- see SkirtMotion.)
  let skirtMotion = null;
  if (skirt) {
    const own = skirt.clone();
    own.userData = { skirt: skirt.userData.skirt };
    skirtMotion = new SkirtMotion(own);
    const mesh = part(own, mats.cloth);
    // (The mail shirt's lower half, over the skirt and moving with it.)
    if (wearsMail) mesh.add(new THREE.Mesh(own, chainmailMaterial(true)));
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
      const sleeve = part(sleeveGeometry(downs[side].rest, armW, downs[side].moving, outfit.robes), mats.cloth);
      joints[`${side}Elbow`].add(sleeve);
      sleeves.push(sleeve, sleeve.children[0]); // (and its outline)
    }
  }

  // A tunic's loose parts, trousers, boots and leather armour.
  const onSkirt = [];
  addTunicAndGear(a, outfit, { joints, root, parts, mats, w, skeletal, skirt, onSkirt });

  // A braid hangs from the back of the head down over the back (and skirt).
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

const gripEuler = new THREE.Euler(), gripA = new THREE.Quaternion(), gripB = new THREE.Quaternion();

// Where each weapon is held: by which joint, and where and how it sits in
// that joint's frame (see weaponModel.js for the weapons' own frames). The
// sword and halberd are gripped in the right hand; the shield is strapped to
// the outside of the left forearm.
// (The halberd is held tilted, so that in its stance it lies across the
// body; the shield is strapped across the forearm, as for blocking.)
const WEAPON_GRIP = {
  sword: { joint: 'rightElbow', position: [-0.005, -BODY.forearmLength - 0.1, -0.005], rotation: [-0.3, 0, 0] },
  halberd: { joint: 'rightElbow', position: [-0.005, -BODY.forearmLength - 0.1, 0], rotation: [-1.0, 0, 0.6] },
  shield: { joint: 'leftElbow', position: [-0.05, -0.14, 0], rotation: [-1.89, 0, 0] },
  // Bows in the left hand, the grip in the palm; the crossbow and dagger in the right.
  shortbow: { joint: 'leftElbow', position: [0, -BODY.forearmLength - 0.09 + 0.08, 0], rotation: [0, 0, 0] },
  longbow: { joint: 'leftElbow', position: [0, -BODY.forearmLength - 0.09 + 0.09, 0], rotation: [0, 0, 0] },
  crossbow: { joint: 'rightElbow', position: [0, -BODY.forearmLength - 0.09, 0], rotation: [-1.5708, 0, 0] },
  dagger: { joint: 'rightElbow', position: [-0.005, -BODY.forearmLength - 0.1, -0.005], rotation: [-0.3, 0, 0] },
};

// A glow round the hands, for casting spells: a bright core, a soft halo and
// a warm light that lights up the character (and anything near). Always there
// (dark when not in use), so the scene's lighting doesn't change. Usually just
// the right hand glows; some spells light up both.
// Returns { set(amount, both) } -- amount 0 (off) to 1 (full).
const GLOWS = {
  holy: { color: '#ffd45c', core: '#fff4c2', size: 0.3, light: 0.35 },
  fire: { color: '#ff7a1f', core: '#ffe0a0', size: 0.34, light: 0.5 },
  nature: { color: '#6fdc4a', core: '#e2ffc4', size: 0.32, light: 0.45 },
  arcane: { color: '#9a7cff', core: '#ece6ff', size: 0.34, light: 0.45 },
  earth: { color: '#d68a3c', core: '#ffe2b8', size: 0.32, light: 0.4 },
  toxic: { color: '#a8e03a', core: '#efffc0', size: 0.32, light: 0.45 },
};

function handGlow(joints, GLOW) {
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
  const hands = ['rightElbow', 'leftElbow'].map((joint) => {
    const glow = new THREE.Group();
    glow.position.y = -BODY.forearmLength - 0.09; // (the middle of the hand)
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color: GLOW.core, ...additive }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: GLOW.color, ...additive }));
    const light = new THREE.PointLight(GLOW.color, 0, 0.8, 2);
    glow.add(core, halo, light);
    joints[joint].add(glow);
    return { core, halo, light };
  });
  return {
    set(amount = 0, both = false, colors = GLOW) {
      hands.forEach(({ core, halo, light }, i) => {
        core.material.color.set(colors.core);
        halo.material.color.set(colors.color);
        light.color.set(colors.color);
        const a = i === 0 || both ? amount : 0;
        core.visible = halo.visible = a > 0.01;
        core.material.opacity = 0.8 * a;
        halo.material.opacity = a;
        halo.scale.setScalar(GLOW.size * (0.6 + 0.4 * a));
        light.intensity = GLOW.light * a;
      });
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

// --- Tunics, trousers, boots and armour ---------------------------------------

const CORD_COLOR = '#d8c69c'; // (the lacing at a tunic's neck)

// Where the surface of a body part is: marching in from `from` (a point
// outside it) in direction `dir` until it's reached. Returns a Vector3 (in the
// part's coordinates), or null.
function surfaceAlong(distance, from, dir) {
  const p = new THREE.Vector3(...from);
  for (let step = 0; step < 90; step++) {
    const d = distance(p.x, p.y, p.z);
    if (d < 0.0006) return p;
    p.addScaledVector(dir, Math.max(d * 0.8, 0.0008));
    if (p.length() > 3) return null;
  }
  return null;
}

// The torso's surface at a height, in the direction `angle` round it (0 =
// front), pushed out by `off`.
function torsoPoint(torsoDistance, y, angle, off = 0) {
  const dir = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)); // (inwards)
  const p = surfaceAlong(torsoDistance, [Math.sin(angle) * 0.5, y, -Math.cos(angle) * 0.5], dir);
  return p && p.addScaledVector(dir, -off);
}

// A cord, strap or belt: a tube along points (Vector3s), flattened across
// (squash < 1) if it's a band rather than a cord.
function cordGeometry(points, radius, { closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed);
  return smoothNormals(new THREE.TubeGeometry(curve, Math.max(points.length * 6, 12), radius, 6, closed));
}

function addTunicAndGear(a, outfit, { joints, root, parts, mats, w, skeletal, skirt, onSkirt }) {
  const torsoDistance = parts[0].local;
  // (Loose tubes round the limbs are as wide as the build makes the limbs.)
  const armW = w * (1 + ((a.armWeight ?? 1) - 1) * 0.55);
  const legW = w * (1 + ((a.legWeight ?? 1) - 1) * 0.55);
  const looseTube = (shape, options, size = armW) => looseTubeShape(shape.map(([s, rx, rz]) => [s, rx * size, rz * buildDepth(size)]), options);
  const cloth = mats.cloth;
  const tunic = outfit.tunic;
  if (outfit.robes) {
    // Loose upper sleeves meet the flowing forearm sections at the elbow.
    for (const side of ['left', 'right']) {
      const upper = looseTube([[0, 0.001, 0.001], [0.035, 0.056, 0.058], [0.09, 0.066, 0.066], [0.2, 0.06, 0.06], [0.33, 0.052, 0.051]], { top: 0.065, folds: 0.015 });
      joints[side + 'Shoulder'].add(part(upper, cloth));
    }
    const sash = toon(CORD_COLOR);
    const band = [];
    for (let i = 0; i <= 8; i++) {
      const y = 1.205 - i * 0.014, ring = [];
      for (let j = 0; j < 64; j++) {
        const angle = j / 64 * Math.PI * 2;
        const p = torsoPoint(torsoDistance, y, angle, 0.026);
        ring.push({ p: p.toArray(), inward: [-Math.sin(angle), 0, Math.cos(angle)] });
      } band.push(ring);
    }
    root.add(part(fabricGeometry(band, [0, -1, 0]), sash));
    const knot = part(new THREE.SphereGeometry(0.035, 16, 12).scale(1.5, 0.85, 0.5), sash);
    knot.position.copy(torsoPoint(torsoDistance, 1.15, 0.2, 0.052)); root.add(knot);
    // The front opening continues above the sash as overlapping fabric edges.
    const seam = [];
    for (let i = 0; i <= 20; i++) seam.push(torsoPoint(torsoDistance, 1.46 - i * 0.013, 0, 0.004));
    root.add(part(cordGeometry(seam, 0.003), toon(new THREE.Color(a.shirtColor).multiplyScalar(0.7))));
    const skirtMesh = new THREE.Mesh(skirt, new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
    const ray = new THREE.Raycaster();
    for (const side of [-1, 1]) {
      const rows = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16, y = 1.155 - t * (side < 0 ? 0.23 : 0.29), row = [];
        for (const edge of [-1, 1]) {
          const angle = 0.2 + side * 0.13 * t + edge * 0.07;
          const dir = new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle));
          const p = torsoPoint(torsoDistance, y, angle, 0.04);
          ray.set(dir.clone().multiplyScalar(1).setY(y), dir.clone().negate());
          const hit = ray.intersectObject(skirtMesh)[0];
          if (hit && hit.point.dot(dir) + 0.018 > p.dot(dir)) p.copy(hit.point).addScaledVector(dir, 0.018);
          row.push({p:p.toArray(),inward:dir.clone().negate().toArray()});
        } rows.push(row);
      }
      const geometry = fabricGeometry(rows, [0,-1,0], false);
      root.add(part(geometry, sash)); onSkirt.push(new SkirtFollower(geometry));
    }
    skirtMesh.material.dispose();
  }
  if (tunic) {
    // Lacing across the V at the front of the neck: cords crossing in X's
    // from one side of the V to the other, not tied -- their ends hanging
    // loose out of the top corners.
    const edgeAt = (y) => {
      // (The angle round from the front where the V's edge is at height y.)
      let lo = 0, hi = TUNIC_V.width;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (outfit.neckline(mid) < y) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const top = outfit.neckline(TUNIC_V.width) - 0.001, bottom = outfit.neckline(0) + 0.012;
    const rows = 4;
    const edge = (side, k) => {
      const y = top - ((top - bottom) * k) / rows;
      return torsoPoint(torsoDistance, y, side * (edgeAt(y) + 0.02), 0.004);
    };
    const cord = toon(CORD_COLOR);
    for (let k = 0; k < rows; k++) {
      for (const side of [-1, 1]) {
        const a0 = edge(side, k), a1 = edge(-side, k + 1);
        if (!a0 || !a1) continue;
        const mid = a0.clone().lerp(a1, 0.5);
        mid.z -= 0.006; // (standing off the chest a little where it crosses)
        root.add(part(cordGeometry([a0, mid, a1], 0.0045), cord));
      }
    }
    for (const side of [-1, 1]) {
      // The loose ends, hanging down from the top corners.
      const start = edge(side, 0);
      if (!start) continue;
      const hang = [start];
      for (let k = 1; k <= 8; k++) {
        const t = k / 8;
        const p = torsoPoint(torsoDistance, start.y - 0.15 * t,
          side * (TUNIC_V.width + 0.02 + 0.11 * Math.sin(t * Math.PI * 0.8)), 0.012);
        if (p) hang.push(p);
      }
      root.add(part(cordGeometry(hang, 0.0045), cord));
    }

    // Wide sleeves: a loose tube down the upper arm (just to below the
    // armpit when short), and for long sleeves, on down the forearm too.
    for (const side of ['left', 'right']) {
      const upper = tunic.long
        ? looseTube([[0, 0.001, 0.001], [0.035, 0.056, 0.058], [0.06, 0.062, 0.062], [0.2, 0.058, 0.056], [0.3, 0.052, 0.05]], { top: 0.065 })
        : looseTube([[0, 0.001, 0.001], [0.035, 0.058, 0.06], [0.06, 0.066, 0.066], [0.15, 0.072, 0.07]], { top: 0.065 });
      joints[`${side}Shoulder`].add(part(upper, cloth));
      if (tunic.long) {
        const lower = looseTube([[0, 0.048, 0.044], [0.1, 0.05, 0.042], [0.2, 0.046, 0.04], [0.25, 0.046, 0.042]], { top: 0.02 });
        joints[`${side}Elbow`].add(part(lower, cloth));
      }
    }

    if (tunic.tied) {
      // A rope belt round the waist, knotted off-centre, its ends hanging;
      // and above it, the tunic bunching out over the belt.
      const beltY = 1.125;
      const ring = [];
      for (let k = 0; k < 24; k++) {
        const p = torsoPoint(torsoDistance, beltY, (k / 24) * Math.PI * 2, 0.018);
        if (p) ring.push(p);
      }
      const beltColor = toon(CORD_COLOR);
      root.add(part(cordGeometry(ring, 0.009, { closed: true }), beltColor));
      const knotAngle = 0.48;
      const front = torsoPoint(torsoDistance, beltY, knotAngle, 0.03);
      if (front) {
        const knot = part(new THREE.SphereGeometry(0.018, 12, 10).scale(1.1, 1.25, 0.8), beltColor);
        knot.position.copy(front);
        root.add(knot);
        const skirtMesh = skirt ? new THREE.Mesh(skirt, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })) : null;
        const ray = new THREE.Raycaster();
        for (const side of [-1, 1]) {
          const tail = [front.clone()];
          for (let k = 1; k <= 20; k++) {
            const t = k / 20, y = beltY - (side < 0 ? 0.19 : 0.23) * t;
            const angle = knotAngle + side * 0.12 * Math.sin(t * 2);
            const dir = new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle));
            const p = torsoPoint(torsoDistance, y, angle, 0.022) ?? front.clone().setY(y);
            if (skirtMesh) {
              ray.set(dir.clone().multiplyScalar(0.6).setY(y), dir.clone().negate());
              const hit = ray.intersectObject(skirtMesh)[0];
              if (hit && hit.point.dot(dir) + 0.018 > p.dot(dir)) p.copy(hit.point).addScaledVector(dir, 0.018);
            }
            // Below a short hem the rope hangs freely instead of following
            // the body's inward contour and curling underneath the fabric.
            const previous = tail[tail.length - 1];
            const hangingRadius = Math.hypot(previous.x, previous.z);
            if (p.dot(dir) < hangingRadius) p.copy(dir).multiplyScalar(hangingRadius).setY(y);
            tail.push(p);
          }
          const geometry = cordGeometry(tail, 0.007);
          root.add(part(geometry, beltColor));
          if (skirt) onSkirt.push(new SkirtFollower(geometry));
        }
        skirtMesh?.material.dispose();
      }
      // (The bunched cloth: a band of tunic round the body just above the
      // belt, bulging out beyond the belt's edge.)
      const bandRows = [];
      const heights = 32, around = 48;
      for (let i = 0; i < heights; i++) {
        const t = i / (heights - 1);
        const y = 1.34 - 0.225 * t;
        // Keep the upper transition scooped inward: the outward offset
        // accelerates toward the gather instead of rounding out early.
        // Only the bottom of the bulge rolls back into the rope belt.
        const rise = Math.pow(Math.min(t / 0.82, 1), 3);
        const tuck = 1 - THREE.MathUtils.smootherstep(t, 0.78, 1);
        const bulge = rise * tuck;
        const row = [];
        for (let j = 0; j < around; j++) {
          const angle = (j / around) * Math.PI * 2;
          // (Bunched unevenly: in soft folds round the body.)
          const folds = 1 + 0.16 * Math.sin(7 * angle + 0.5) * Math.sin(3 * angle + 1.3);
          const p = torsoPoint(torsoDistance, y, angle, -0.004 + 0.05 * bulge * folds) ?? new THREE.Vector3();
          row.push({ p: p.toArray(), inward: [-Math.sin(angle), 0, Math.cos(angle)] });
        }
        bandRows.push(row);
      }
      root.add(part(fabricGeometry(bandRows, [0, -1, 0]), cloth));
    }
  }

  // Trousers cut loose rather than fitted: a loose tube down each leg (to
  // just above the ankle, or tucked into boots).
  const boots = a.footwear === 'boots';
  if (a.pantsFit === 'loose' && outfit.pants !== false && !skeletal) {
    const pants = toon(a.pantsColor, SKIN_TOON_STEPS);
    for (const side of ['left', 'right']) {
      // One continuous leg, with weights blended across the knee instead
      // of two overlapping tubes with separate hems at the joint.
      const hip = joints[`${side}Hip`], knee = joints[`${side}Knee`];
      const end = boots ? 0.61 : 0.89;
      const geometry = looseTube([[0, 0.1, 0.1], [0.15, 0.106, 0.108],
        [0.35, 0.094, 0.097], [0.47, 0.088, 0.09], [0.58, 0.08, 0.082],
        [end, 0.072, 0.074]], { rows: 52, top: 0, folds: 0.025 }, legW);
      const indices = [], weights = [];
      for (let v = 0; v < geometry.attributes.position.count; v++) {
        const down = -geometry.attributes.position.getY(v);
        const bend = THREE.MathUtils.smootherstep(down, BODY.thighLength - 0.09, BODY.thighLength + 0.09);
        indices.push(0, 1, 0, 0);
        weights.push(1 - bend, bend, 0, 0);
      }
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      const skeleton = new THREE.Skeleton([hip, knee]);
      for (const material of [pants, outlineMaterial]) {
        const mesh = new THREE.SkinnedMesh(geometry, material);
        mesh.frustumCulled = false;
        hip.add(mesh);
        root.updateMatrixWorld(true);
        mesh.bind(skeleton);
      }
    }
  }
  // Boots: a leather shaft up the shin to just below the knee, with a
  // rolled top; the foot is the boot's leather too (see createFoot).
  if (boots && !skeletal) {
    const leather = toon(a.shoeColor, SKIN_TOON_STEPS);
    for (const side of ['left', 'right']) {
      joints[`${side}Knee`].add(part(looseTube([[0, 0.088, 0.09], [0.03, 0.084, 0.086], [0.12, 0.072, 0.072], [0.26, 0.058, 0.058], [0.33, 0.052, 0.054]], { top: -0.12, folds: 0.015 }, legW), leather));
    }
  }

  // Leather armour: a pauldron on each shoulder -- a curved plate over the
  // top of the arm with a second, smaller plate under it -- held on by a
  // strap round the arm and a strap round the chest; and a bracer on each
  // forearm.
  if (a.armor === 'leather' && !skeletal) {
    const leather = toon(a.leatherColor, SKIN_TOON_STEPS).clone();
    leather.side = THREE.DoubleSide; // (the undersides of the pauldrons show when the arms lift)
    const strap = toon(new THREE.Color(a.leatherColor).multiplyScalar(0.75).getStyle());
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? -1 : 1;
      const shoulder = joints[`${side}Shoulder`];
      // (Two overlapping plates, the lower one further out and down the arm.)
      for (const [radius, x, y, tilt] of [[0.1, 0.012, -0.02, 0.45], [0.09, 0.035, -0.07, 0.8]]) {
        const plate = part(new THREE.SphereGeometry(radius * armW, 24, 12, 0, Math.PI * 2, 0, 1.35).scale(1, 0.8, 1.12 * buildDepth(armW) / armW), leather);
        plate.position.set(sign * x * w, y, 0);
        plate.rotation.z = -sign * tilt;
        shoulder.add(plate);
      }
      const band = part(new THREE.TorusGeometry(0.062 * armW, 0.007, 6, 24).rotateX(Math.PI / 2).scale(1, 1, buildDepth(armW) / armW), strap);
      band.position.y = -0.14;
      shoulder.add(band);
      // The bracer: stiff leather round the forearm (over a long sleeve), with a band at each end.
      // (Over a long sleeve, a little wider -- the sleeve's folds tucked in under it.)
      const over = tunic?.long ? [[0, 0.056, 0.05], [0.07, 0.054, 0.048], [0.15, 0.052, 0.046]] : [[0, 0.048, 0.04], [0.07, 0.044, 0.036], [0.15, 0.036, 0.032]];
      const elbow = joints[`${side}Elbow`];
      elbow.add(part(looseTube(over, { top: -0.07, folds: 0 }), leather));
      for (const [y, [, r, rz]] of [[-0.075, over[0]], [-0.215, over[2]]]) {
        const cuff = part(new THREE.TorusGeometry(r * armW + 0.002, 0.005, 6, 20).rotateX(Math.PI / 2).scale(1, 1, rz / r * buildDepth(armW) / armW), strap);
        cuff.position.y = y;
        elbow.add(cuff);
      }
    }
    // The chest strap: round the body under the arms, over the tunic, with a
    // strap from each pauldron down to it, front and back.
    const strapY = 1.34;
    const loop = [];
    for (let k = 0; k < 28; k++) {
      const p = torsoPoint(torsoDistance, strapY, (k / 28) * Math.PI * 2, 0.012);
      if (p) loop.push(p);
    }
    root.add(part(cordGeometry(loop, 0.009, { closed: true }), strap));
    for (const sign of [-1, 1]) {
      for (const angle of [0.75, Math.PI - 0.75]) {
        const down = [];
        for (let k = 0; k <= 5; k++) {
          const y = 1.47 - (1.47 - strapY) * (k / 5);
          const p = torsoPoint(torsoDistance, y, sign * (angle + (1 - k / 5) * 0.35 * (angle < 1 ? 1 : -1)), 0.012);
          if (p) down.push(p);
        }
        if (down.length > 1) root.add(part(cordGeometry(down, 0.008), strap));
      }
    }
  }

  // Metal armour: a chest plate following the torso (over everything else),
  // pauldrons of overlapping metal plates strapped round the arm, and a plate
  // curved over the front of each thigh, tied on with leather straps.
  if (a.armor === 'plate' && !skeletal) {
    const metal = toon(METAL_COLOR, METAL_TOON_STEPS).clone();
    metal.side = THREE.DoubleSide; // (the insides of the plates show at their edges)
    const strap = toon(new THREE.Color(a.leatherColor).multiplyScalar(0.75).getStyle());
    const depth = buildDepth(w) / w;
    const key = ['plate', a.bodyType, w, a.chestWeight, a.bellyWeight, a.hipWeight, tunic ? `${tunic.tied}` : outfit.key].join(':');
    const chest = cached(key, () => chestPlateGeometry(torsoDistance));
    root.add(part(chest, metal));
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? -1 : 1;
      const shoulder = joints[`${side}Shoulder`];
      // (Three overlapping plates, each lower one further out and down the arm.)
      for (const [radius, x, y, tilt] of [[0.1, 0.01, 0.005, 0.35], [0.092, 0.024, -0.031, 0.52], [0.084, 0.034, -0.065, 0.7]]) {
        const plate = part(new THREE.SphereGeometry(radius * armW, 28, 12, 0, Math.PI * 2, 0, 1.25).scale(1, 0.8, 1.12 * buildDepth(armW) / armW), metal);
        plate.position.set(sign * x * w, y, 0);
        plate.rotation.z = -sign * tilt;
        shoulder.add(plate);
      }
      const band = part(new THREE.TorusGeometry(0.063 * armW, 0.007, 6, 24).rotateX(Math.PI / 2).scale(1, 1, buildDepth(armW) / armW), strap);
      band.position.y = -0.15;
      shoulder.add(band);
      // The thigh plate: curved round the front of the thigh (over loose
      // trousers, if worn), with a strap round the thigh at its top and bottom.
      const hip = joints[`${side}Hip`];
      const room = a.pantsFit === 'loose' ? 0.03 : 0.01;
      const [top, bottom] = [-0.1, -0.34];
      const thighAt = (y) => 0.085 + (0.072 - 0.085) * ((y - top) / (bottom - top)); // (the thigh narrows towards the knee)
      const plateGeometry = new THREE.CylinderGeometry((thighAt(top) + room) * legW, (thighAt(bottom) + room) * legW, top - bottom, 24, 6, true, Math.PI - 0.8, 1.6);
      plateGeometry.scale(1, 1, buildDepth(legW) / legW * 1.05);
      // (Curving out a little at the top and bottom edges.)
      const pos = plateGeometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getY(i) / (top - bottom) + 0.5; // 0 at the bottom, 1 at the top
        const flare = 1 + 0.08 * (Math.abs(t - 0.5) * 2) ** 3;
        pos.setX(i, pos.getX(i) * flare);
        pos.setZ(i, pos.getZ(i) * flare);
      }
      plateGeometry.computeVertexNormals();
      const plate = part(plateGeometry, metal);
      plate.position.set(0, (top + bottom) / 2, -0.004);
      hip.add(plate);
      for (const y of [top - 0.035, bottom + 0.035]) {
        const r = (thighAt(y) + room) * legW + 0.002;
        const tie = part(new THREE.TorusGeometry(r, 0.006, 6, 28).rotateX(Math.PI / 2).scale(1, 1, buildDepth(legW) / legW * 1.05), strap);
        tie.position.y = y;
        hip.add(tie);
      }
    }
  }
}

// A chest plate: a shell round the torso, from the waist up to just below the
// neck (scooped a little lower at the front). It's traced from the torso's
// surface, then smoothed and bridged over any hollows (between the breasts,
// say), so it's one stiff, convex plate -- with a ridge down the front, and
// flaring out at the bottom edge.
function chestPlateGeometry(torsoDistance) {
  const rows = 22, columns = 48, bottom = 1.15, clearance = 0.02;
  const top = (angle) => 1.425 - 0.03 * Math.exp(-((angle / 0.55) ** 2));
  // Distance out from the middle of the torso, row by row, round each height.
  const radius = [], heights = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1), ring = [], ys = [];
    for (let j = 0; j < columns; j++) {
      const angle = (j / columns) * Math.PI * 2 - Math.PI;
      const y = bottom + (top(angle) - bottom) * t;
      const p = torsoPoint(torsoDistance, y, angle, clearance);
      ring.push(p ? Math.hypot(p.x, p.z) : 0.15);
      ys.push(y);
    }
    radius.push(ring);
    heights.push(ys);
  }
  // Bridge hollows round each height: nothing goes in from the average of its
  // neighbours. Then smooth it up and down a little (never going inside the
  // torso), so it still narrows to the waist.
  const traced = radius.map((r) => [...r]);
  for (let pass = 0; pass < 10; pass++) {
    for (const r of radius) for (let j = 0; j < columns; j++) {
      r[j] = Math.max(r[j], (r[(j + columns - 1) % columns] + r[(j + 1) % columns]) / 2);
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const before = radius.map((r) => [...r]);
    for (let i = 1; i < rows - 1; i++) for (let j = 0; j < columns; j++) {
      radius[i][j] = Math.max(traced[i][j], (before[i - 1][j] + 2 * before[i][j] + before[i + 1][j]) / 4);
    }
  }
  const positions = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    for (let j = 0; j < columns; j++) {
      const angle = (j / columns) * Math.PI * 2 - Math.PI;
      const ridge = 0.005 * Math.exp(-((angle / 0.16) ** 2)) * THREE.MathUtils.smoothstep(t, 0.05, 0.4);
      const r = radius[i][j] + ridge + 0.014 * (1 - t) ** 4; // (the flare at the bottom)
      positions.push(Math.sin(angle) * r, heights[i][j], -Math.cos(angle) * r);
    }
  }
  const indices = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < columns; j++) {
    const a = i * columns + j, b = i * columns + ((j + 1) % columns), c = a + columns, d = b + columns;
    indices.push(a, b, c, b, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
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
    // Sample the actual profile: fixed 0.2 bounds clipped fuller chests.
    let radius = 0;
    for (let i = 0; i <= 80; i++) {
      const y = part.range[0] + (part.range[1] - part.range[0]) * i / 80;
      const { rx, rz, cz } = part.shape(y);
      radius = Math.max(radius, rx, rz + Math.abs(cz));
    }
    radius += 0.09; // room for muscle detail and smooth unions
    for (const y of part.range) for (const x of [-radius, radius]) for (const z of [-radius, radius]) {
      v.set(x, y, z).applyMatrix4(part.bone.matrixWorld);
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], v.getComponent(i));
        max[i] = Math.max(max[i], v.getComponent(i));
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
  const mailField = new Float32Array(count); // where a mail shirt covers (see MAIL), whatever the outfit
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
    const bodyMail = clampField(Math.min(MAIL.neckline(angleAround(x, z, 0)) - y, y - MAIL.hem));
    const influence = new Map();
    let shirt = 0, pants = 0, mail = 0;
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
        mail += share * bodyMail;
        // The top of the neck turns with the head.
        const withHead = THREE.MathUtils.smoothstep(y, 1.56, 1.66);
        addInfluence(influence, joints.root, share * (1 - withHead));
        addInfluence(influence, joints.head, share * withHead);
        return;
      }
      const bare = -FIELD_LIMIT;
      // (Mail has no sleeves; on the legs it follows the same rule as the torso.)
      mail += share * (part.name === 'thigh' || part.name === 'shin' ? bodyMail : bare);
      // (A wide neckline can reach out over the top of the arm, so the
      // sleeve also stops at the neckline's height.)
      if (part.name === 'upperArm') { shirt += share * clampField(Math.min(CLOTHES.sleeve - along, CLOTHES.shoulderEdge ? neck(x, y, z) : FIELD_LIMIT)); pants += share * bare; }
      if (part.name === 'forearm') { shirt += share * (CLOTHES.cuff ? clampField(CLOTHES.cuff - along) : bare); pants += share * bare; }
      // (No sleeve at all.)
      if (part.name === 'thigh' || part.name === 'shin') { shirt += share * bodyShirt; pants += share * (CLOTHES.pants === false ? bare : -bare); }
      addInfluence(influence, part.bone, share);
    });
    shirtField[v] = shirt;
    pantsField[v] = pants;
    mailField[v] = mail;

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
  geometry.setAttribute('mailField', new THREE.Float32BufferAttribute(mailField, 1));
}

function addInfluence(map, bone, weight) {
  map.set(bone, (map.get(bone) ?? 0) + weight);
}

// Where each outfit covers the body (heights in units). The fitted parts are
// painted onto the body in the shirt and pants colours; loose parts (a skirt,
// flowing sleeves) are separate meshes in the shirt colour (see clothingModel.js).
const OUTFITS = {
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
// What an appearance's outfit covers (and what loose parts it has): a dress
// (above), or a tunic and trousers. The tunic has a round neck with a laced V
// at the front; wide sleeves, short or long; and either a belt at the waist,
// or no belt (when it hangs a little longer).
function outfitSpec(a) {
  if (a.outfit === 'robes') return { ...OUTFITS.dress, shoulderEdge: undefined, neckline: () => 1.47, robes: true, key: 'robes' };
  if (a.outfit === 'dress') return { ...OUTFITS.dress, key: 'dress' };
  const long = a.tunicSleeves === 'long', tied = a.tunicBelt === 'tied';
  const hem = tied ? 0.99 : 0.94; // short hip-length hems; untied hangs slightly lower
  return {
    key: `tunic-${a.tunicSleeves}-${a.tunicBelt}`,
    neckline: (angle) => 1.482 - 0.02 * Math.cos(angle) - TUNIC_V.depth * Math.max(0, 1 - Math.abs(angle) / TUNIC_V.width),
    hem: hem + 0.03,  // the painted part ends just inside its hanging lower half
    waist: 1.115,     // top of the pants (under the tunic)
    sleeve: long ? 1 : 0.13,
    cuff: long ? 0.25 : 0,
    tunicSkirt: hem,
    tunic: { long, tied },
  };
}

// The V at the front of a tunic's neck: how deep, and how wide (radians round
// from the front).
const TUNIC_V = { depth: 0.11, width: 0.34 };

const FIELD_LIMIT = 0.05; // coverage values are capped so blends between parts stay local

function clampField(value) {
  return Math.min(Math.max(value, -FIELD_LIMIT), FIELD_LIMIT);
}

// A mail shirt: shaped like a short-sleeved tunic (the same neckline, laced V
// and all, down to the same hem) but with no sleeves at all. It's worn over
// everything else, so its hanging lower half goes over whatever skirt is worn.
const MAIL = {
  neckline: (angle) => 1.482 - 0.02 * Math.cos(angle) - TUNIC_V.depth * Math.max(0, 1 - Math.abs(angle) / TUNIC_V.width),
  hem: 0.94,
  lift: 0.004,      // how far it sits out from what's under it
  rings: 56,        // rings round the body
  radius: 0.15,     // (the body's rough radius, for the rings' size up and down)
};
const METAL_COLOR = '#b3b9bf';
const METAL_TOON_STEPS = [105, 150, 205, 255]; // (strong shading, so the plates' curves read as metal)

// Chainmail: rings of metal painted on a copy of the surface under it, lifted
// just off it, and see-through between the rings. `onSkirt`: it's over a
// skirt (whose shape changes as it moves), so it covers down to the hem by
// height rather than following the body's mailField.
function chainmailMaterial(onSkirt = false) {
  const mat = toon(METAL_COLOR, SKIN_TOON_STEPS);
  mat.side = onSkirt ? THREE.DoubleSide : THREE.FrontSide;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = `${onSkirt ? '' : 'attribute float mailField;'}
varying float vMail;
varying vec3 vMailPos;
${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vMail = ${onSkirt ? `position.y - ${MAIL.hem.toFixed(3)}` : 'mailField'};
  vMailPos = position;
  transformed += normalize(normal) * ${MAIL.lift.toFixed(4)};`)}`;
    shader.fragmentShader = `varying float vMail;
varying vec3 vMailPos;
uniform vec3 mailLineColor;
${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    float mailW = fwidth(vMail) + 1e-6;
    if (vMail / mailW < -0.5) discard; // (not covered)
    // Rings in rows round the body (measured in rings), every other row
    // offset by half a ring, each ring overlapping its neighbours.
    vec2 uv = vec2(atan(vMailPos.x, -vMailPos.z) / 6.28318 * ${MAIL.rings.toFixed(1)},
      vMailPos.y / (6.28318 * ${MAIL.radius.toFixed(3)} / ${MAIL.rings.toFixed(1)}));
    vec2 a = uv - floor(uv + 0.5), b = uv - floor(uv) - 0.5;
    float r = 0.42, t = 0.1;
    float d = min(abs(length(a) - r), abs(length(b) - r));
    // (Measured from two angles with their seams on opposite sides, so there's no seam.)
    float turn = min(fwidth(atan(vMailPos.x, -vMailPos.z)), fwidth(atan(-vMailPos.x, vMailPos.z)));
    float fw = max(turn / 6.28318 * ${MAIL.rings.toFixed(1)}, fwidth(uv.y)) + 1e-6;
    float ring = 1.0 - smoothstep(t - fw, t + fw, d);
    // (Too small to see the rings, far away: a solid mesh of metal.)
    float far = smoothstep(0.25, 0.5, fw);
    if (mix(ring, 1.0, far) < 0.5) discard;
    float shine = mix(0.55 + 0.6 * (1.0 - d / t), 0.8, far);
    // A dark line along the edges, like the clothes' hems.
    float edge = 1.0 - smoothstep(-0.5, 0.5, (abs(vMail) - max(${(OUTLINE_THICKNESS / 2).toFixed(5)}, mailW * 0.3)) / mailW);
    diffuseColor.rgb = mix(diffuseColor.rgb * shine, mailLineColor, edge);
  }`)}`;
    shader.uniforms.mailLineColor = { value: new THREE.Color(LINE_COLOR) };
  };
  mat.customProgramCacheKey = () => (onSkirt ? 'chainmail-skirt' : 'chainmail');
  return mat;
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
${decay?.skeletal ? `
    // A skeleton: nothing but the shirt (the rest is bones -- see skeletonModel.js).
    if (shirt < 0.5 && shirtLine < 0.5) discard;` : ''}
    diffuseColor.rgb *= mix(cloth, lineColor, edge);
  }`)}`;
  };
  if (decay?.skeletal) mat.side = THREE.DoubleSide;
  mat.customProgramCacheKey = () => (decay?.skeletal ? 'clothed-skeleton' : decay ? 'clothed-skin-decay' : 'clothed-skin');
  return mat;
}

// --- Body sculpting ------------------------------------------------------
// Shapes are keyframes of [height, half width, half depth, forward offset];
// muscles use surface angles (0 = front, +π/2 = the character's right side,
// π = back). For limbs, `sign` mirrors the muscles onto the correct side.

// Build changes width and depth; the neck changes less than the torso.
function scaled(keys, w, neckFrom = Infinity) {
  return keys.map(([y, rx, rz, cz]) => {
    const s = y >= neckFrom ? 1 + (w - 1) * 0.4 : w;
    return [y, rx * s, rz * buildDepth(s), cz];
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

// flatChest: leave out the breasts (e.g. for a skeleton's shirt).
function torso(w, m, flatChest = false, straightTunic = false, proportions = {}) {
  return { shape: torsoShape(w, m, straightTunic, proportions), bumps: torsoMuscles(m, flatChest), range: [0.86, 1.7] };
}

function torsoShape(w, m, straightTunic = false, proportions = {}) {
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
    // The clothed torso of a man's untied tunic hangs from the chest,
    // bridging the natural waist instead of following its hourglass curve.
    const drape = straightTunic
      ? THREE.MathUtils.smoothstep(y, 1.0, 1.11) * (1 - THREE.MathUtils.smoothstep(y, 1.24, 1.37))
      : 0;
    const maleRobe = m === 1 && proportions.outfit === 'robes';
    const upperFullness = maleRobe ? 1 + 0.08 * Math.exp(-Math.pow((y - 1.36) / 0.11, 2)) : 1;
    const waistFloor = maleRobe ? 0.163 : 0.153;
    const width = (rx * k + drape * Math.max(0, waistFloor * w - rx * k)) * upperFullness;
    const depth = rz * deep + drape * Math.max(0, 0.096 * w - rz * deep);
    // Blend regional fullness smoothly into neighbouring body areas.
    const zone = (center, spread) => Math.exp(-Math.pow((y - center) / spread, 2));
    const chest = ((proportions.chestWeight ?? 1) - 1) * zone(1.36, 0.115);
    const belly = ((proportions.bellyWeight ?? 1) - 1) * zone(1.16, 0.14);
    const hips = ((proportions.hipWeight ?? 1) - 1) * zone(1.0, 0.11);
    const fullness = Math.max(0, w - 1) * zone(1.15, 0.18);
    const regional = chest + belly + hips;
    return [y, width * (1 + regional * 0.5 + fullness * 0.3),
      depth * (1 + regional * 0.85 + fullness * 0.65),
      cz - belly * 0.035 - fullness * 0.025 + hips * 0.025];
  }));
}

function torsoMuscles(sex, flatChest = false) {
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
  if (sex < 1 && !flatChest) {
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

  return { ...buildHair(centre, a.hairStyle, mats, headMesh.geometry, a.bangs), mouth };
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
function addBangs(hair, lock, hairMat, style) {
 if (style === 'straight') {   // Bangs across the forehead: shorter in the middle, longer at the sides.
  const bangs = [
    { az: -60, length: 1.95 }, { az: -40, length: 1.75 }, { az: -20, length: 1.6 },
    { az: 0, length: 1.5 }, { az: 20, length: 1.62 }, { az: 40, length: 1.78 }, { az: 60, length: 1.95 },
  ];
  bangs.forEach((b, i) => lock({
    az: b.az, polar: 0.3, length: b.length, width: 0.3, sway: 0.1 * (i % 2 ? 1 : -1), twist: 0.5,
  }));

 }
 else if (style === 'sideSwept') {
 const onScalp = (x, z) => [x, Math.sqrt(Math.max(1-x*x-z*z,0)), z].map((v,i)=>SKULL.centre[i]+v*SKULL.radii[i]*HAIR_SHELL);
   // Bangs: from the front of the parting, swept across the forehead to the
  // other temple, the front ones reaching lowest (over the edge of that eye).
  const away = -Math.sign(PART_X); // the direction the bangs sweep
  [[-0.92, -0.32], [-0.84, -0.22], [-0.74, -0.12], [-0.62, -0.02]].forEach(([z, endY], i) => lock({
    from: onScalp(PART_X, z), dir: [away, -0.2, -0.3], length: 3, width: 0.36, sway: 0.06 * (i % 2 ? 1 : -1), twist: 0.3,
    target: [away * 1.1, endY - 0.1, -0.36], steer: 0.07, closedRoot: true, // (the tips lift off past the temple)
  }));
  // The smaller side of the parting, at the front: combed the other way,
  // down over that temple and back above the ear.
  [-0.9, -0.68, -0.45].forEach((z, i) => lock({
    from: onScalp(PART_X - away * 0.03, z), dir: [-away, -0.25, 0.15], length: 3, width: 0.36, sway: 0.04 * (i % 2 ? 1 : -1),
    target: [-away * 1.02, -0.12 - 0.06 * i, 0.05 + 0.12 * i], steer: 0.12, closedRoot: true,
  }));

 } else if (style === 'fringe') {   // The fringe lifts at the roots, rolls forwards, then falls in a short
  // swept fringe. Explicit curves keep the lift separate from the tips.
  for (let i = 0; i < 9; i++) {
    const x = (i - 4) * 0.145;
    const z = -Math.sqrt(Math.max(0.3, 1 - x * x));
    hair.add(part(ribbonLock({ length: 1.3, width: 0.25, twist: 0.2,
      path: [[x - 0.12, 0.68, z * 0.65], [x - 0.1, 0.98, z * 0.85],
        [x + 0.01, 0.7, z * 1.12], [x + 0.12, 0.1 + 0.065 * (i % 3), z * 1.1]],
    }), hairMat));
  }
 } else if (style === 'blowout') {
  // Blown out, from an off-centre parting. On the larger side the hair springs
  // up from the parting in a cowlick, makes a bump above the forehead, comes
  // back down over the temple, flares out away from the face, then curls back
  // in towards it, ending at mid-cheek. The smaller side follows the same
  // curve, without the bump: straight down, out, and back in.
  const onScalp = (x, z) => [x, Math.sqrt(Math.max(1 - x * x - z * z, 0)), z].map((v, i) => SKULL.centre[i] + v * SKULL.radii[i] * HAIR_SHELL);
  const away = -Math.sign(PART_X); // the larger side
  const X = (x) => x * away;
  // Behind the bump, hair fills in the space down to the head, so the base
  // layer doesn't show behind it.
  const fill = new THREE.SphereGeometry(1, 32, 20);
  fill.scale(0.45, 0.3, 0.42);
  fill.translate(X(0.1), 0.78, -0.3);
  hair.add(part(smoothNormals(fill), hairMat));
  [-0.84, -0.74, -0.62, -0.48, -0.34].forEach((z, i) => {
    const back = i * 0.07; // (the locks further back on the parting lie further back)
    hair.add(part(ribbonLock({ length: 3, width: 0.38, twist: 0.2 * (i % 2 ? 1 : -1), closedRoot: true,
      path: [onScalp(PART_X, z), [X(-0.1 + 0.08 * i), 1.1 - 0.02 * i, -0.9 + back], [X(0.3 + 0.06 * i), 1.06 - 0.03 * i, -0.96 + back],
        [X(0.6), 0.62, -0.92 + back], [X(0.74), 0.2, -0.8 + back], [X(1.08), -0.14, -0.56 + back],
        [X(1.04), -0.44, -0.46 + back], [X(0.92), -0.58, -0.47 + back], [X(0.74), -0.62, -0.5 + back]],
    }), hairMat));
  });
  // The front hairline is combed up too, so the base layer's edge doesn't
  // show across the forehead: up into the bump on the larger side, and into
  // the curve on the smaller side.
  const shell = SKULL.radii.map((r) => r * HAIR_SHELL);
  // The hairline leans towards a widow's peak: lowest in the middle of the
  // forehead, rising towards the temples (which it leaves clear, so the curves
  // of the bangs show there).
  const hairline = (x, y = 0.4 + 0.12 * Math.min(1, Math.abs(x) / 0.55) ** 1.3) => {
    const q = 1 - (x / shell[0]) ** 2 - ((y - SKULL.centre[1]) / shell[1]) ** 2;
    return [x, y, SKULL.centre[2] - shell[2] * Math.sqrt(Math.max(q, 0)) - 0.02];
  };
  for (let x = -0.22; x <= 0.56; x += 0.13) {
    const [hx, hy, hz] = hairline(X(x));
    hair.add(part(ribbonLock({ length: 1.4, width: 0.3, twist: 0.1, closedRoot: true,
      path: [[hx, hy, hz], [hx, hy + 0.3, hz - 0.08], [X(x * 0.7 + 0.08), 0.95, -0.98], [X(x * 0.4 + 0.2), 1.06, -0.82]],
    }), hairMat));
  }
  for (let x = -0.3; x >= -0.56; x -= 0.13) {
    const [hx, hy, hz] = hairline(X(x));
    hair.add(part(ribbonLock({ length: 1.6, width: 0.3, twist: -0.1, closedRoot: true,
      path: [[hx, hy, hz], [hx * 1.02, hy + 0.2, hz - 0.06], [X(-0.72), 0.5, -0.86], [X(-0.84), 0.22, -0.78], [X(-1.08), -0.1, -0.54]],
    }), hairMat));
  }
  [-0.84, -0.7, -0.54, -0.38].forEach((z, i) => {
    const back = i * 0.07;
    hair.add(part(ribbonLock({ length: 2.6, width: 0.38, twist: -0.2 * (i % 2 ? 1 : -1), closedRoot: true,
      path: [onScalp(PART_X - away * 0.03, z), [X(-0.62), 0.86, -0.8 + back], [X(-0.8), 0.3, -0.8 + back],
        [X(-1.1), -0.12, -0.52 + back], [X(-1.04), -0.44, -0.44 + back], [X(-0.92), -0.58, -0.46 + back], [X(-0.74), -0.62, -0.5 + back]],
    }), hairMat));
  });
 }
}

function buildHair(centre, style, mats, headGeometry, bangsStyle = ({ braid: 'sideSwept', manBun: 'fringe' }[style] ?? 'straight')) {
  const hairMat = mats.hair;
  if (style === 'none') return {};
  const R = BODY.headRadius;
  const hair = new THREE.Group();
  hair.scale.setScalar(R);
  centre.add(hair);

  // Base layer: the skull shape, covering the top and back of the head, tilted
  // back so the forehead shows and reaching down to the nape at the back.
  const cap = new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0, 1.75);
  cap.rotateX(bangsStyle === 'blowout' ? 0.8 : 0.45); // (further back when the hair is combed up off the forehead)
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

  addBangs(hair, lock, hairMat, bangsStyle);
  if (style === 'ponytail' || style === 'twintails') return tiedBackHair(hair, lock, hairMat, mats.hairTie, headGeometry, style);
  if (style === 'braid') return braidedHair(hair, lock, hairMat, mats.hairTie, bangsStyle);
  if (style === 'manBun') return manBun(hair, lock, hairMat, mats.hairTie, headGeometry);
  if (style === 'short') return shortHair(hair, lock, hairMat, headGeometry);

  // Strands framing the face, in front of the ears, down to the jaw.
  for (const az of [-72, 72]) lock({ az, polar: 0.6, length: 2.1, width: 0.26, sway: 0.1, twist: 0.6 });

  // Sides and back of the head.
  const long = style === 'long';
  for (let az = 95, i = 0; az <= 265; az += 17, i++) {
    lock({
      az, polar: 0.45, length: long ? 4.2 : 2.35, width: 0.36,
      sway: (long ? 0.08 : 0.1) * (i % 2 ? 1 : -1), twist: long ? 0.6 : 0.5, hang: long ? 0.2 : 0,
    });
  }

  return {};
}

function tiedBackHair(hair, lock, hairMat, tieMat, headGeometry, style) {
  hair.add(part(napeHair(headGeometry), hairMat));
  const twin = style === 'twintails';
  const scalp = (az, polar) => {
    const a = az * Math.PI / 180;
    return [Math.sin(polar)*Math.sin(a), Math.cos(polar), -Math.sin(polar)*Math.cos(a)].map((v,i)=>SKULL.centre[i]+v*SKULL.radii[i]*HAIR_SHELL);
  };
  for (const sign of (twin ? [-1,1] : [1])) {
    const target = twin ? [sign*0.98,0.48,0.55] : [0,0.5,1.15];
    // Ribbons start at the hairline and converge into the tie, rather than hanging as a bob.
    for (let az = twin ? 8 : -170; az <= (twin ? 172 : 170); az += 18) {
      const angle = twin ? az*sign : az;
      const polar = Math.abs(angle)<65 ? 0.75 : Math.abs(angle)<105 ? 1.4 : 1.85;
      const from = scalp(angle,polar);
      lock({from,dir:target.map((v,i)=>v-from[i]),length:3.3,width:0.28,raise:0.025,target,steer:0.32,closedRoot:true});
    }
    for (const az of (twin ? [sign*35,sign*95,sign*150] : [-100,0,100,180])) {
      const from=scalp(az,0.3);
      lock({from,dir:target.map((v,i)=>v-from[i]),length:3,width:0.3,target,steer:0.3,closedRoot:true});
    }
    const bunch=part(new THREE.SphereGeometry(0.21,20,14),hairMat);bunch.position.set(...target);hair.add(bunch);
    const dir=new THREE.Vector3(twin?sign*0.8:0,0.2,twin?0.5:1).normalize();
    const tie=part(new THREE.TorusGeometry(0.18,0.045,10,28),tieMat);
    tie.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),dir);
    tie.position.set(...target).addScaledVector(dir,0.13);hair.add(tie);
    // The tail: a bundle of locks leaving the tie together, drooping under
    // their own weight, the outer ones a little shorter and fanning slightly.
    const exit=target.map((v,i)=>v+dir.getComponent(i)*0.15);
    const across=new THREE.Vector3(0,1,0).cross(dir).normalize(), up=dir.clone().cross(across).normalize();
    for(let k=0;k<6;k++){
      const a=(k/6)*Math.PI*2, off=across.clone().multiplyScalar(Math.cos(a)*0.09).addScaledVector(up,Math.sin(a)*0.07);
      const d=dir.clone().addScaledVector(off,1.2).setY(dir.y-0.35);
      lock({from:exit.map((v,i)=>v+off.getComponent(i)),dir:d.toArray(),length:(twin?3.4:3.1)*(0.88+0.06*(k%3)),width:0.3,sway:0.08*(k%2?1:-1),twist:0.6});
    }
    lock({from:exit,dir:dir.clone().setY(dir.y-0.3).toArray(),length:twin?3.6:3.3,width:0.34,sway:0.1,twist:0.8});
  }
  return {};
}

// Short: close to the head at the back and sides (with sideburns), and
// fluffy on top -- short locks that lift off the scalp before falling. None of
// it comes down past the tops of the ears. (A pixie cut, on a woman.)
function shortHair(hair, lock, hairMat, headGeometry) {
  hair.add(part(napeHair(headGeometry), hairMat));
  for (const sign of [-1, 1]) hair.add(part(sideburn(headGeometry, sign), hairMat));
  // Rings of locks round the crown: [how far down from the top, how many,
  // length, how much they lift off the scalp]. The fluff is on top; lower
  // down the locks lie close to the head.
  const rings = [[0.12, 5, 0.8, 0.55], [0.4, 10, 0.8, 0.3], [0.68, 15, 0.6, 0.05]];
  rings.forEach(([polar, count, length, lift], r) => {
    for (let k = 0; k < count; k++) {
      const a = ((k + r * 0.5) / count) * Math.PI * 2;
      const front = Math.cos(a); // 1 at the front of the head
      if (r === 2 && front > 0.5) continue; // (the bangs frame the face)
      const u = [Math.sin(polar) * Math.sin(a), Math.cos(polar), -Math.sin(polar) * Math.cos(a)];
      const from = u.map((v, i) => SKULL.centre[i] + v * SKULL.radii[i] * HAIR_SHELL);
      // Heading down the scalp, and lifting off it: the fluff.
      const down = normalizeV([Math.sin(a) * Math.cos(polar), -Math.sin(polar), -Math.cos(a) * Math.cos(polar)]);
      const uneven = 1 + 0.15 * Math.sin(k * 2.4 + r); // (so the ends don't all line up)
      lock({
        from, dir: down.map((v, i) => v + u[i] * lift), length: length * uneven * (front > 0.5 ? 0.8 : 1), width: 0.34,
        raise: 0.015 + 0.04 * (2 - r), sway: 0.06 * (k % 2 ? 1 : -1), twist: 0.4,
      });
    }
  });
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

function braidedHair(hair, lock, hairMat, tieMat, bangsStyle) {
  // A point on the hair's base layer, above (x, z) on a unit sphere.
  const onScalp = (x, z) => {
    const y = Math.sqrt(Math.max(1 - x * x - z * z, 0));
    return [x, y, z].map((v, i) => SKULL.centre[i] + v * SKULL.radii[i] * HAIR_SHELL);
  };
  const back = { target: BRAID_GATHER, steer: 0.14, closedRoot: true };

  const away = -Math.sign(PART_X);
  // The rest of the larger side, from the parting back to the nape.
  for (const z of [-0.5, -0.3, -0.1, 0.1, 0.3]) {
    lock({ from: onScalp(PART_X, z), dir: [away, -0.1, 0.35], length: 4, width: 0.4, ...back });
  }
  // The smaller side of the parting (its front is part of the side-swept or
  // blown-out bangs, when they're worn).
  for (const z of [-0.9, -0.68, -0.45, -0.2, 0.05, 0.3]) {
    if ((bangsStyle === 'sideSwept' || bangsStyle === 'blowout') && z < -0.4) continue;
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

// A man bun: short, uneven bangs falling across the forehead, sideburns in
// front of the ears, and the rest of the hair drawn up and back into a bun
// high on the back of the head.
const BUN = { centre: [0, 0.8, 0.98], radius: 0.3 };

function manBun(hair, lock, hairMat, tieMat, headGeometry) {
  hair.add(part(napeHair(headGeometry), hairMat));
  // Sideburns, down in front of the ears.
  for (const sign of [-1, 1]) hair.add(part(sideburn(headGeometry, sign), hairMat));
  // The sides and back, swept up into the bun: each lock starts at the
  // hairline and heads straight for the bun, lying along the head.
  const onScalp = (az, polar) => {
    const a = (az * Math.PI) / 180;
    const u = [Math.sin(polar) * Math.sin(a), Math.cos(polar), -Math.sin(polar) * Math.cos(a)];
    return u.map((v, i) => SKULL.centre[i] + v * SKULL.radii[i] * HAIR_SHELL);
  };
  const toBun = (az, polar, width) => {
    const from = onScalp(az, polar);
    lock({ from, dir: BUN.centre.map((v, i) => v - from[i]), length: 3, width, raise: 0.02, target: BUN.centre, steer: 0.35, closedRoot: true });
  };
  for (const az of [-66, -48, 48, 66]) toBun(az, 0.55, 0.38);
  for (const az of [-100, -82, 82, 100]) toBun(az, 1.0, 0.4);
  for (let az = 120; az <= 240; az += 24) toBun(az, 1.9, 0.42); // (from the lower hairline)
  for (let az = 140; az <= 220; az += 40) toBun(az, 0.95, 0.4);
  // The bun itself: a knot of hair (a few lumps together), with a tie round its base.
  const [x, y, z] = BUN.centre, r = BUN.radius;
  for (const [dx, dy, dz, s] of [[0, 0.02, 0.06, 1], [-0.12, -0.02, 0, 0.72], [0.12, 0.03, 0.02, 0.72], [0.02, 0.14, -0.02, 0.62]]) {
    const g = new THREE.SphereGeometry(r * s, 20, 14);
    g.scale(1, 0.9, 0.95);
    g.translate(x + dx, y + dy, z + dz);
    hair.add(part(smoothNormals(g), hairMat));
  }
  const tie = new THREE.TorusGeometry(r * 0.62, 0.05, 8, 24);
  tie.rotateX(Math.PI / 2 - 0.8); // (round the base of the bun, where it meets the head)
  tie.translate(x, y - 0.15, z - 0.12);
  hair.add(part(smoothNormals(tie), tieMat));
  // Loose ends fall from the bottom of the knot, then curl outwards.
  for (const sign of [-1, 1]) for (let i = 0; i < 3; i++) {
    hair.add(part(ribbonLock({ length: 1, width: 0.16, twist: sign * 0.5,
      path: [[sign * 0.12, y - 0.08, z + 0.22],
        [sign * 0.14, y - 0.3 - i * 0.035, z + 0.3],
        [sign * (0.3 + i * 0.025), y - 0.48 - i * 0.045, z + 0.4],
        [sign * (0.52 + i * 0.025), y - 0.48 - i * 0.045, z + 0.45]],
    }), hairMat));
  }
  return {};
}

// Where a ray along an axis, coming from far out on the `side` (+1 or -1) of
// it, first meets a geometry: its coordinate on that axis (or undefined if it
// misses). (a, b) are the ray's other two coordinates, in axis order. Much
// faster than a Raycaster on the dense head sculpt: the triangles are sorted
// into a grid over the other two axes once, so each ray only tests a few.
const surfaceGrids = new WeakMap();

function meshSurfaceAlong(geometry, axis, side, a, b) {
  let grids = surfaceGrids.get(geometry);
  if (!grids) surfaceGrids.set(geometry, (grids = []));
  const grid = grids[axis] ?? (grids[axis] = projectionGrid(geometry, axis));
  const { min, cell, size, cells, tris } = grid;
  const ci = Math.floor((a - min[0]) / cell[0]), cj = Math.floor((b - min[1]) / cell[1]);
  if (ci < 0 || cj < 0 || ci >= size || cj >= size) return undefined;
  let best;
  for (const t of cells[ci * size + cj]) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris[t];
    // Barycentric coordinates of (a, b) in the triangle's projection.
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-14) continue;
    const l1 = ((by - cy) * (a - cx) + (cx - bx) * (b - cy)) / det;
    const l2 = ((cy - ay) * (a - cx) + (ax - cx) * (b - cy)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const depth = l1 * az + l2 * bz + l3 * cz;
    if (best === undefined || depth * side > best * side) best = depth;
  }
  return best;
}

function projectionGrid(geometry, axis) {
  const [u, v] = [0, 1, 2].filter((k) => k !== axis);
  const pos = geometry.attributes.position, index = geometry.index;
  const count = index ? index.count : pos.count;
  const tris = [];
  for (let t = 0; t < count; t += 3) {
    const tri = [];
    for (let k = 0; k < 3; k++) {
      const i = index ? index.getX(t + k) : t + k;
      const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      tri.push(p[u], p[v], p[axis]);
    }
    tris.push(tri);
  }
  const size = 64;
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const t of tris) for (let k = 0; k < 9; k += 3) {
    min[0] = Math.min(min[0], t[k]); max[0] = Math.max(max[0], t[k]);
    min[1] = Math.min(min[1], t[k + 1]); max[1] = Math.max(max[1], t[k + 1]);
  }
  const cell = [(max[0] - min[0]) / size || 1, (max[1] - min[1]) / size || 1];
  const cells = Array.from({ length: size * size }, () => []);
  const clampCell = (x, d) => Math.min(size - 1, Math.max(0, Math.floor((x - min[d]) / cell[d])));
  tris.forEach((t, n) => {
    const i0 = clampCell(Math.min(t[0], t[3], t[6]), 0), i1 = clampCell(Math.max(t[0], t[3], t[6]), 0);
    const j0 = clampCell(Math.min(t[1], t[4], t[7]), 1), j1 = clampCell(Math.max(t[1], t[4], t[7]), 1);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) cells[i * size + j].push(n);
  });
  return { min, cell, size, cells, tris };
}

// Close-fitting hair down the back of the head and upper neck. Sample the
// sculpt so the lower hairline follows the nape instead of floating off it.
function napeHair(headGeometry) {
  const rows = 24, columns = 25, positions = [], indices = [];
  const R = BODY.headRadius;
  const earPlane = 0.1; // never let the nape surface wrap forward onto the jaw
  // The first surface seen looking forwards from behind, if it's behind the ear plane.
  const backHit = (x, y) => {
    const z = meshSurfaceAlong(headGeometry, 2, 1, x * R, y * R);
    return z !== undefined && z >= earPlane * R ? z : undefined;
  };
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1), y = -0.18 - 1.42 * t;
    let lo = 0, hi = 1.02;
    // Find the rear head/neck silhouette at this height. The old fixed
    // width allowed a ray to miss the nape and hit the jaw farther forward.
    for (let step = 0; step < 16; step++) {
      const x = (lo + hi) / 2;
      if (backHit(x, y) !== undefined && backHit(-x, y) !== undefined) lo = x; else hi = x;
    }
    const halfWidth = lo * 0.985;
    for (let j = 0; j < columns; j++) {
      const u = j / (columns - 1), x = (u * 2 - 1) * halfWidth;
      const hit = backHit(x, y);
      const z = hit !== undefined ? hit / R : earPlane;
      positions.push(x, y, z + 0.025 + 0.04 * Math.sin(Math.PI * u) * (1 - t));
    }
    // Wrap the last strip onto each side of the neck, ending exactly at
    // the ear plane. This closes the triangular gap left by rear-only rays.
    for (const [j, sign] of [[0, -1], [columns - 1, 1]]) {
      const hit = meshSurfaceAlong(headGeometry, 0, sign, y * R, earPlane * R);
      if (hit !== undefined) {
        const v = (i * columns + j) * 3;
        positions[v] = hit / R + sign * 0.018;
        positions[v + 2] = earPlane + 0.008;
      }
    }
  }
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < columns - 1; j++) {
    const a = i * columns + j, b = a + 1, c = a + columns, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return smoothNormals(geometry);
}

// A sideburn: a thin layer of hair lying on the side of the face (found by
// casting rays at the head) in front of the ear, from the hairline down to
// about the bottom of the ear, narrowing as it goes. In head radii.
const SIDEBURN = { top: 0.4, bottom: -0.52, front: [-0.3, -0.2], back: [0.02, -0.04], thickness: 0.035 };

function sideburn(headGeometry, sign) {
  const rows = 10, columns = 7;
  const rings = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const y = SIDEBURN.top + (SIDEBURN.bottom - SIDEBURN.top) * t;
    const front = SIDEBURN.front[0] + (SIDEBURN.front[1] - SIDEBURN.front[0]) * t;
    const back = SIDEBURN.back[0] + (SIDEBURN.back[1] - SIDEBURN.back[0]) * t;
    const outer = [], inner = [];
    for (let j = 0; j < columns; j++) {
      const s = j / (columns - 1);
      const z = front + (back - front) * s;
      // (The head's geometry is in metres; this is in head radii.)
      const R = BODY.headRadius;
      const hit = meshSurfaceAlong(headGeometry, 0, sign, y * R, z * R);
      const x = hit !== undefined ? hit / R : sign * 0.8;
      // (Thickest in the middle, thinning to nothing at the edges and the bottom.)
      const thick = SIDEBURN.thickness * Math.sqrt(Math.sin(Math.PI * s)) * (1 - 0.4 * t) * Math.min(1, (1 - t) * 8);
      outer.push([x + sign * (0.006 + thick), y, z]);
      inner.push([x - sign * 0.02, y, z]);
    }
    rings.push([...outer, ...inner.reverse()]);
  }
  const positions = rings.flat().flat();
  const n = 2 * columns, indices = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + ((j + 1) % n), c = a + n, d = b + n;
      indices.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  // (Facing outwards.)
  const mid = Math.floor(rows / 2) * n + Math.floor(columns / 2);
  if (g.attributes.normal.getX(mid) * sign < 0) {
    const index = g.index.array;
    for (let k = 0; k < index.length; k += 3) [index[k + 1], index[k + 2]] = [index[k + 2], index[k + 1]];
    g.computeVertexNormals();
  }
  return g;
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
//   hang: how quickly it straightens to hang plumb below the head (0 to 1)
function ribbonLock({ az, polar, from, dir, length, width, sway = 0, twist = 0, raise = 0, target, steer = 0, closedRoot = false, path, hang = 0 }) {
  const thickness = width * 0.14;
  const lift = thickness + raise; // how far its centre sits above the base layer
  let p, d;
  if (path) {
    p = [...path[0]];
    d = normalizeV(path[1].map((v, i) => v - p[i]));
  } else if (from) {
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
      // (Below the widest part of the head, `hang` straightens it towards
      // falling plumb, rather than carrying on outwards.)
      const straighten = p[1] < SKULL.centre[1] - 0.2 ? 1 - hang : 1;
      d = normalizeV([d[0] * straighten, d[1] - 0.09, d[2] * straighten]);
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
  if (path) {
    const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)));
    points = curve.getSpacedPoints(LOCK_STEPS).map((point) => {
      const p = point.toArray();
      return { p, n: onShell(p, lift) };
    });
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

// A skeleton's shirt's outline: the same, but only round the shirt.
const shirtOutlineMaterial = new THREE.MeshBasicMaterial({
  color: LINE_COLOR, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
});
shirtOutlineMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = `attribute float shirtField;
varying float vShirtOutline;
${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vShirtOutline = shirtField;
  transformed += normalize(normal) * ${OUTLINE_THICKNESS.toFixed(4)};`)}`;
  shader.fragmentShader = `varying float vShirtOutline;
${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  if (vShirtOutline < 0.0) discard;`)}`;
};
shirtOutlineMaterial.customProgramCacheKey = () => 'shirt-outline';

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
    if (!child.isMesh || child.material === outlineMaterial || child.material === shirtOutlineMaterial || child.userData.sharedMaterial) return;
    if (!child.geometry.userData.cached) child.geometry.dispose();
    child.material.map?.dispose();
    child.material.dispose();
  });
}
