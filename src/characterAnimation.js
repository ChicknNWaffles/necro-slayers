import { COMMAND_CALL, mouthOpening } from './voice.js';

// Character animation: procedural walk and run cycles, played on the
// character's skeleton (see characterModel.js). Part of the renderer.
//
// The cycles advance with the distance actually travelled, so the feet keep
// pace with the ground at any speed (and play backwards when moving backwards).
// Walking and running blend smoothly into each other and back to standing.

// Distance covered by one full cycle (two steps), at default height. Set so
// walking (8 units/s) plays about 1.5 cycles a second and running (14 units/s)
// about 1.6 -- a natural cadence at the game's movement speeds.
const STRIDE = { walk: 5.4, run: 8.8 };
const BLEND_RATE = 8; // how quickly the character eases between standing, walking and running
const JUMP_BLEND_RATE = 14; // how quickly the jump pose comes in and out
const LANDING_TIME = 0.25;  // seconds the landing crouch lasts

// Joint angles in radians. Positive hip/shoulder swing moves the limb forwards;
// knees bend backwards (negative), elbows bend forwards (positive).
const POSES = {
  walk: {
    hipSwing: 0.42, kneeBend: 0.75, kneeBase: 0.06, shoulderSwing: 0.4, elbowBase: 0.15, elbowSwing: 0.15,
    bob: 0.018, lean: 0.03, sway: 0.03,
  },
  run: {
    hipSwing: 0.7, hipForward: 0.12, kneeBend: 1.35, kneeBase: 0.3, shoulderSwing: 0.6, shoulderBack: 0.25, elbowBase: 1.35,
    elbowSwing: 0.2, bob: 0.045, lean: 0.14, sway: 0.05,
  },
  // Running backwards: very upright, leaning slightly back, and looking back
  // over the shoulder (turn: body turned slightly; look: head turned).
  runBack: {
    hipSwing: 0.55, hipForward: -0.05, kneeBend: 1.2, kneeBase: 0.25, shoulderSwing: 0.45, shoulderBack: 0.1,
    elbowBase: 1.3, elbowSwing: 0.2, bob: 0.04, lean: -0.06, sway: 0.04, turn: 0.2, look: 0.95,
  },
};

// Gestures: short one-off movements of the right arm (and head), played over
// whatever else the character is doing. Keyframes are [time (seconds),
// shoulder [x, y, z], elbow [x, y, z], head [x, y]] -- absolute rotations of
// the right side (x swings the arm forwards/up; z lifts it out to the side;
// the elbow's x bends it, its y turns the forearm). The gesture eases in from
// and back out to the arm's normal movement. A gesture with `speech` (see
// voice.js) also moves the mouth in time with it.
const GESTURES = {
  // "Follow me!": the arm swings up and sweeps forwards, pointing the way,
  // twice, while the head glances back towards whoever is being called and
  // the character calls out the order.
  follow: {
    duration: 1.4,
    speech: COMMAND_CALL,
    keys: [
      [0.0, [2.6, 0, 0.3], [0.6, 0, 0], [0, 0]],
      [0.28, [2.6, 0, 0.3], [0.6, 0, 0], [-0.05, 0.35]],
      [0.58, [1.45, 0, 0.12], [0.1, 0, 0], [0, 0.15]],
      [0.8, [2.4, 0, 0.28], [0.7, 0, 0], [-0.05, 0.35]],
      [1.1, [1.45, 0, 0.12], [0.1, 0, 0], [0, 0]],
      [1.4, [1.45, 0, 0.12], [0.1, 0, 0], [0, 0]],
    ],
  },
  // "You can stay": the hand comes up, palm facing out (away from the
  // body), and waves gently from side to side, with a small shake of the head.
  dismiss: {
    duration: 1.5,
    keys: [
      // (The upper arm turning about its length swings the raised forearm like a wiper.)
      [0.0, [0.9, -0.1, 0.45], [1.5, 1.3, 0], [0, 0]],
      [0.3, [0.9, -0.1, 0.45], [1.5, 1.3, 0], [0, 0]],
      [0.5, [0.9, 0.15, 0.45], [1.5, 1.3, 0], [0, 0.12]],
      [0.7, [0.9, -0.35, 0.45], [1.5, 1.3, 0], [0, -0.12]],
      [0.9, [0.9, 0.15, 0.45], [1.5, 1.3, 0], [0, 0.1]],
      [1.1, [0.9, -0.3, 0.45], [1.5, 1.3, 0], [0, -0.05]],
      [1.5, [0.9, -0.1, 0.45], [1.5, 1.3, 0], [0, 0]],
    ],
  },
};
// The moment a smite's blow lands (seconds into the gesture).
export const SMITE_IMPACT = 0.42;
// The moment an invocation calls down its spell (seconds into the gesture).
export const INVOKE_IMPACT = 0.6;
// The moment the beam of Cleansing Light shoots out.
export const BEAM_IMPACT = 0.45;
// The moment a fireball leaves the hands.
export const FIREBALL_RELEASE = 0.42;
// The moment the vines of Vine Trap burst from the ground.
export const VINES_RISE = 0.55;
// The moment a Power Shove is pushed out.
export const SHOVE_RELEASE = 0.3;
// The moment a leech is slapped onto its victim (Leach Bomb).
export const LEECH_PLANT = 0.32;
// The moment a healing touch (on someone else, or on one's own chest) takes effect.
export const HEAL_IMPACT = 0.75;
// The moments a zombie's scratch and bite connect (seconds into the gesture).
export const SCRATCH_IMPACT = 0.36;
export const BITE_IMPACT = 0.5;

// Fighting moves (see game.js). Keyframes are as for any gesture; `grip` is
// how the weapon in the right hand sits in the grip ([time, [x, y, z]] keys:
// its full rotation in the hand -- see WEAPON_GRIP in characterModel.js --
// blended smoothly as a turn, not axis by axis),
// `twist` how far the body turns (radians, + to the left), and the left-arm
// columns carry the shield or the halberd's other hand.
export const STAB_IMPACT = 0.3;
export const SLASH_IMPACT = 0.38;
export const BASH_IMPACT = 0.3;
export const AXE_IMPACT = 0.5;
export const HAMMER_IMPACT = 0.62;
const SWORD_ARM = [[0.35, 0, 0.12], [0.45, 0, 0]];            // (the sword-and-shield stance, right arm)
const SHIELD_ARM = [[0.3, 0, 0.1], [0.9, 0, 0]];              // (...and left arm)
const HALBERD_ARMS = [[0.4, 0, 0.1], [1.0, 0, 0], [0.7, 0.5, -0.15], [1.2, 0, 0]];
export const BLOCK_ARM = [[0.8, 1.57, 0], [1.9, -0.7, 0]];    // the shield raised in front of the chest

// Archery. The moments an arrow (or bolt) is loosed, and how long reloading a
// crossbow takes.
export const SHORTBOW_RELEASE = 0.45;
export const LONGBOW_RELEASE = 0.72;
export const CROSSBOW_RELEASE = 0.2;
export const CROSSBOW_RELOAD = 2.0;
const BOW_REST = [[0.1, 0, 0.1], [0.1, 0, 0], [0, 0], [0.3, 0, 0.05], [1.1, 0, 0]]; // (the bow stance: right arm, head, left arm)
const BOW_AIM = [[0.3, 0, 0.1], [0.3, 0, 0], [0, 0], [1.5, 0, 0], [0.05, 0, 0]];   // (the bow held out, the right hand going to the string)
const BOW_DRAWN = [[1.5, 0.6, 0], [2.3, 0, 0], [0, 0], [1.5, 0, 0], [0.05, 0, 0]];  // (the string drawn back to the cheek)
const BOW_LOOSED = [[1.35, 0.9, 0.25], [1.5, 0, 0], [0, 0], [1.5, 0, 0], [0.05, 0, 0]]; // (the hand flicking back as it lets go)
const CROSSBOW_REST = [[0.3, 0, 0.05], [1.1, 0, 0], [0, 0], [0.45, 0.5, -0.1], [1.2, 0, 0]];
const CROSSBOW_AIM = [[1.5, 0, 0.05], [0.1, 0, 0], [0.05, 0], [1.4, 0.4, -0.1], [0.6, 0, 0]];
const CROSSBOW_KICK = [[1.65, 0, 0.05], [0.15, 0, 0], [0, 0], [1.55, 0.4, -0.1], [0.65, 0, 0]];

// Gestures can also have tracks of [time, value] keys for:
//   glow: how brightly the right hand glows (0-1), e.g. for a spell
//   lean: how far the body leans forwards (radians)
//   mouth: how wide the mouth opens (0-1)
//   wrist: how the right hand bends at the wrist ([time, [x, y, z]] keys; x
//          bends it towards the palm, z sideways)
// and keyframes can carry the left arm too: [time, shoulder, elbow, head,
// left shoulder, left elbow] (given as for the right side; they're mirrored).
// ease: [in, out] seconds to blend into and out of it (see GESTURE_EASE).
Object.assign(GESTURES, {
  // Smite (a spell): the hand lights up as the arm swings up and back over
  // the shoulder, then whacks down and forwards onto the target (the moment
  // of the hit is SMITE_IMPACT), leaning into the blow, and the glow fades.
  smite: {
    duration: 0.95,
    keys: [
      [0.0, [0.3, 0, 0.25], [0.4, 0, 0], [0, 0]],
      [0.3, [2.8, 0, 0.35], [1.3, 0, 0], [-0.08, 0]],
      [0.42, [1.25, 0, 0.2], [0.15, 0, 0], [0.1, 0]],
      [0.55, [0.8, 0, 0.2], [0.2, 0, 0], [0.12, 0]],
      [0.95, [0.4, 0, 0.25], [0.3, 0, 0], [0, 0]],
    ],
    glow: [[0, 0], [0.12, 0.35], [0.3, 1], [0.5, 1], [0.85, 0]],
    lean: [[0, 0], [0.3, -0.06], [0.44, 0.2], [0.6, 0.15], [0.95, 0]],
  },
  // Invoking (a spell called down from the sky, e.g. Divine Blade): the arm
  // reaches straight up, hand glowing, the head tipped back to look up, and
  // then sweeps down to point at where the spell will fall (at INVOKE_IMPACT).
  invoke: {
    duration: 1.2,
    keys: [
      [0.0, [0.3, 0, 0.25], [0.3, 0, 0], [0, 0]],
      [0.35, [3.0, 0, 0.12], [0.1, 0, 0], [-0.3, 0]],
      [0.5, [3.05, 0, 0.1], [0.05, 0, 0], [-0.3, 0]],
      [0.62, [1.5, 0, 0.1], [0.05, 0, 0], [0.05, 0]],
      [0.9, [1.45, 0, 0.1], [0.05, 0, 0], [0.05, 0]],
      [1.2, [0.4, 0, 0.25], [0.3, 0, 0], [0, 0]],
    ],
    glow: [[0, 0], [0.2, 0.6], [0.4, 1], [0.75, 1], [1.1, 0]],
    lean: [[0, 0], [0.4, -0.08], [0.62, 0.06], [1.2, 0]],
  },
  // Healing someone (Divine Restoration): reaching out and resting the
  // glowing hand on them, holding it there a moment while the light flows
  // in (from HEAL_IMPACT), head bowed a little.
  healTouch: {
    duration: 1.5,
    keys: [
      [0.0, [0.3, 0, 0.2], [0.3, 0, 0], [0, 0]],
      [0.45, [1.2, -0.25, 0.05], [0.35, 0.9, 0], [-0.1, 0]],
      [1.15, [1.2, -0.25, 0.05], [0.35, 0.9, 0], [-0.15, 0]],
      [1.5, [0.3, 0, 0.2], [0.3, 0, 0], [0, 0]],
    ],
    glow: [[0, 0], [0.3, 0.5], [0.7, 1], [1.15, 0.9], [1.45, 0]],
    lean: [[0, 0], [0.45, 0.1], [1.15, 0.1], [1.5, 0]],
  },
  // Healing oneself: laying the glowing hand flat on one's own chest, head
  // bowed, for a moment.
  healSelf: {
    duration: 1.5,
    keys: [
      [0.0, [0.3, 0, 0.2], [0.3, 0, 0], [0, 0]],
      // (The forearm turned so the palm faces the chest, the fingers towards
      // the other shoulder; the elbow brought forwards so the forearm passes
      // in front of the breast; and the wrist bent back so the hand lies along
      // its curve.)
      [0.45, [0.35, 0.95, 0], [1.95, -0.4, 0], [-0.25, 0]],
      [1.15, [0.35, 0.95, 0], [1.95, -0.4, 0], [-0.3, 0]],
      [1.5, [0.3, 0, 0.2], [0.3, 0, 0], [0, 0]],
    ],
    glow: [[0, 0], [0.3, 0.4], [0.7, 0.7], [1.15, 0.6], [1.45, 0]], // (softer, so close to the body)
    wrist: [[0, [0, 0, 0]], [0.45, [0, 0, -0.7]], [1.15, [0, 0, -0.7]], [1.5, [0, 0, 0]]],
  },
  // Stab (sword): the arm draws back, the blade levelling, then drives
  // straight forward (at STAB_IMPACT), leaning into it.
  stab: {
    duration: 0.65,
    ease: [0.08, 0.2],
    keys: [
      [0.0, ...SWORD_ARM, [0, 0]],
      [0.16, [0.7, 0, 0.3], [1.9, 0, 0], [0, 0]],
      [0.3, [1.5, 0, 0.05], [0.05, 0, 0], [0.05, 0]],
      [0.42, [1.45, 0, 0.05], [0.1, 0, 0], [0.05, 0]],
      [0.65, ...SWORD_ARM, [0, 0]],
    ],
    grip: [[0, [-0.3, 0, 0]], [0.16, [-1.6, 0, 0]], [0.3, [-1.65, 0, 0]], [0.42, [-1.65, 0, 0]], [0.65, [-0.3, 0, 0]]],
    lean: [[0, 0], [0.16, -0.05], [0.3, 0.15], [0.45, 0.12], [0.65, 0]],
  },
  // Slash (sword): the sword raised high by the right shoulder, then cut down
  // and across the front to the left (at SLASH_IMPACT), the body turning with it.
  slash: {
    duration: 0.75,
    ease: [0.08, 0.22],
    keys: [
      [0.0, ...SWORD_ARM, [0, 0]],
      [0.2, [2.4, 0, 0.7], [1.3, 0, 0], [-0.05, 0.1]],
      [0.38, [1.3, -0.5, -0.2], [0.2, 0, 0], [0.05, -0.1]],
      [0.5, [0.8, -0.7, -0.35], [0.35, 0, 0], [0.05, -0.15]],
      [0.75, ...SWORD_ARM, [0, 0]],
    ],
    grip: [[0, [-0.3, 0, 0]], [0.2, [-0.7, 0, 0]], [0.38, [-1.5, 0, 0]], [0.5, [-1.3, 0, 0]], [0.75, [-0.3, 0, 0]]],
    twist: [[0, 0], [0.2, -0.35], [0.38, 0.25], [0.5, 0.35], [0.75, 0]],
    lean: [[0, 0], [0.38, 0.12], [0.75, 0]],
  },
  // Shield bash: the shield brought up in front, then shoved forward hard
  // (at BASH_IMPACT), the body driving in behind it.
  bash: {
    duration: 0.7,
    ease: [0.08, 0.22],
    keys: [
      [0.0, ...SWORD_ARM, [0, 0], ...SHIELD_ARM],
      [0.18, ...SWORD_ARM, [0, 0], [0.7, 1.57, 0], [2.1, -0.7, 0]],
      [0.3, ...SWORD_ARM, [0.05, 0], [1.35, 1.57, 0], [1.1, -0.7, 0]],
      [0.42, ...SWORD_ARM, [0.05, 0], [1.3, 1.57, 0], [1.2, -0.7, 0]],
      [0.7, ...SWORD_ARM, [0, 0], ...SHIELD_ARM],
    ],
    lean: [[0, 0], [0.18, -0.08], [0.3, 0.22], [0.45, 0.18], [0.7, 0]],
    twist: [[0, 0], [0.18, 0.25], [0.3, -0.1], [0.7, 0]],
  },
  // Axe slash (halberd): wound back over the right shoulder, the body turned
  // away, then swept round and across in a wide, flat arc (at AXE_IMPACT).
  axeSlash: {
    duration: 1.0,
    ease: [0.1, 0.25],
    keys: [
      [0.0, ...HALBERD_ARMS.slice(0, 2), [0, 0], ...HALBERD_ARMS.slice(2)],
      [0.3, [1.2, 0.6, 0.6], [1.2, 0, 0], [0, 0.2], [1.3, 0.6, -0.3], [1.4, 0, 0]],
      [0.5, [1.45, -0.3, 0.1], [0.4, 0, 0], [0.05, -0.1], [1.4, -0.4, 0.3], [0.5, 0, 0]],
      [0.66, [1.3, -0.6, -0.1], [0.5, 0, 0], [0.05, -0.2], [1.2, -0.7, 0.4], [0.6, 0, 0]],
      [1.0, ...HALBERD_ARMS.slice(0, 2), [0, 0], ...HALBERD_ARMS.slice(2)],
    ],
    // (Grip angles worked out so the shaft points back over the right
    // shoulder, then straight ahead at the hit, then off to the left, with the
    // blade's edge leading.)
    grip: [[0, [-1.0, 0, 0.6]], [0.3, [-2.11, 0.27, -2.0]], [0.5, [-0.03, 1.86, 3.14]], [0.66, [2.15, 0.75, 0.63]], [1.0, [-1.0, 0, 0.6]]],
    twist: [[0, 0], [0.3, -0.7], [0.5, 0.2], [0.66, 0.55], [1.0, 0]],
    lean: [[0, 0], [0.5, 0.1], [1.0, 0]],
  },
  // Hammer blow (halberd): heaved up high overhead, the head turned so the
  // hammer faces forward, then brought crashing down in front (at HAMMER_IMPACT).
  hammer: {
    duration: 1.15,
    ease: [0.1, 0.25],
    keys: [
      [0.0, ...HALBERD_ARMS.slice(0, 2), [0, 0], ...HALBERD_ARMS.slice(2)],
      [0.38, [2.7, 0, 0.2], [0.8, 0, 0], [-0.25, 0], [2.6, 0.1, -0.1], [0.7, 0, 0]],
      [0.62, [1.1, 0, 0.1], [0.3, 0, 0], [0.2, 0], [1.1, 0.2, -0.1], [0.4, 0, 0]],
      [0.8, [0.9, 0, 0.1], [0.3, 0, 0], [0.2, 0], [0.9, 0.2, -0.1], [0.4, 0, 0]],
      [1.15, ...HALBERD_ARMS.slice(0, 2), [0, 0], ...HALBERD_ARMS.slice(2)],
    ],
    // (The shaft up and back overhead, then down in front at the hit, the
    // hammer's face leading.)
    grip: [[0, [-1.0, 0, 0.6]], [0.38, [0.24, -0.17, 3.04]], [0.62, [-2.88, -3.09, -0.08]], [0.8, [-2.88, -3.09, -0.08]], [1.15, [-1.0, 0, 0.6]]],
    lean: [[0, 0], [0.38, -0.12], [0.62, 0.3], [0.8, 0.28], [1.15, 0]],
  },
  // Shooting a short bow: the bow raised out in front on the left arm, the
  // string drawn back to the cheek, and loosed (at SHORTBOW_RELEASE).
  shortbowShot: {
    duration: 0.65,
    ease: [0.08, 0.15],
    keys: [[0, ...BOW_REST], [0.18, ...BOW_AIM], [0.4, ...BOW_DRAWN], [0.47, ...BOW_LOOSED], [0.65, ...BOW_REST]],
  },
  // A long bow: the same, but a longer, harder draw, held a moment to aim.
  longbowShot: {
    duration: 0.95,
    ease: [0.08, 0.15],
    keys: [[0, ...BOW_REST], [0.22, ...BOW_AIM], [0.55, ...BOW_DRAWN], [0.7, ...BOW_DRAWN], [0.75, ...BOW_LOOSED], [0.95, ...BOW_REST]],
    lean: [[0, 0], [0.55, -0.04], [0.7, -0.04], [0.95, 0]],
  },
  // A crossbow: brought up to the shoulder, fired (at CROSSBOW_RELEASE) with a
  // kick, and lowered.
  crossbowShot: {
    duration: 0.55,
    ease: [0.06, 0.15],
    keys: [[0, ...CROSSBOW_REST], [0.16, ...CROSSBOW_AIM], [0.2, ...CROSSBOW_AIM], [0.26, ...CROSSBOW_KICK], [0.4, ...CROSSBOW_AIM], [0.55, ...CROSSBOW_REST]],
    lean: [[0, 0], [0.2, 0], [0.26, -0.06], [0.45, 0], [0.55, 0]],
  },
  // Reloading a crossbow (CROSSBOW_RELOAD seconds): pointed at the ground,
  // the left hand hauls the string back to the latch, and a bolt is set.
  crossbowReload: {
    duration: CROSSBOW_RELOAD,
    ease: [0.2, 0.25],
    keys: [
      [0, ...CROSSBOW_REST],
      [0.35, [0.1, 0, 0.1], [0.6, 0, 0], [0.3, 0], [0.5, 0.3, -0.15], [1.2, 0, 0]],
      [0.9, [0.1, 0, 0.1], [0.6, 0, 0], [0.3, 0], [0.9, 0.3, -0.15], [2.0, 0, 0]],
      [1.3, [0.1, 0, 0.1], [0.6, 0, 0], [0.3, 0], [0.4, 0.3, -0.15], [1.4, 0, 0]],
      [1.6, [0.1, 0, 0.1], [0.6, 0, 0], [0.25, 0], [0.5, 0.2, -0.1], [1.6, 0, 0]],
      [2.0, ...CROSSBOW_REST],
    ],
    lean: [[0, 0], [0.35, 0.12], [1.6, 0.12], [2.0, 0]],
  },
  // Throwing a fireball: both hands drawn in together by the chest as the fire
  // gathers between them, then thrust out forwards, palms first, loosing it
  // (at FIREBALL_RELEASE).
  fireball: {
    duration: 0.85,
    ease: [0.08, 0.2],
    bothHands: true,
    keys: [
      [0.0, [0.2, 0, 0.1], [0.2, 0, 0], [0, 0], [0.2, 0, 0.1], [0.2, 0, 0]],
      [0.28, [0.55, 0.55, 0.1], [1.9, 0, 0], [0.08, 0], [0.55, 0.55, 0.1], [1.9, 0, 0]],
      [0.42, [1.45, -0.2, 0.05], [0.15, 0, 0], [0, 0], [1.45, -0.2, 0.05], [0.15, 0, 0]],
      [0.6, [1.4, -0.2, 0.05], [0.2, 0, 0], [0, 0], [1.4, -0.2, 0.05], [0.2, 0, 0]],
      [0.85, [0.2, 0, 0.1], [0.2, 0, 0], [0, 0], [0.2, 0, 0.1], [0.2, 0, 0]],
    ],
    wrist: [[0, [0, 0, 0]], [0.28, [0.3, 0, 0]], [0.42, [1.0, 0, 0]], [0.6, [1.0, 0, 0]], [0.85, [0, 0, 0]]],
    glow: [[0, 0], [0.2, 0.7], [0.4, 1], [0.5, 0.6], [0.7, 0]],
    lean: [[0, 0], [0.28, -0.06], [0.42, 0.12], [0.6, 0.08], [0.85, 0]],
  },
  // Power Shove: the right hand drawn back to the shoulder, crackling violet,
  // then shoved out hard, palm first (at SHOVE_RELEASE), the body driving in
  // behind it.
  shove: {
    duration: 0.7,
    ease: [0.06, 0.2],
    glowKind: 'arcane',
    keys: [
      [0.0, [0.2, 0, 0.1], [0.2, 0, 0], [0, 0]],
      [0.2, [1.0, 0, 0.35], [1.7, 0, 0], [0, 0]],
      [0.3, [1.5, 0, 0.1], [0.05, 0, 0], [0, 0]],
      [0.45, [1.5, 0, 0.1], [0.08, 0, 0], [0, 0]],
      [0.7, [0.2, 0, 0.1], [0.2, 0, 0], [0, 0]],
    ],
    wrist: [[0, [0, 0, 0]], [0.2, [0.4, 0, 0]], [0.3, [1.1, 0, 0]], [0.45, [1.1, 0, 0]], [0.7, [0, 0, 0]]],
    glow: [[0, 0], [0.15, 0.8], [0.3, 1], [0.45, 0.5], [0.6, 0]],
    lean: [[0, 0], [0.2, -0.08], [0.3, 0.15], [0.45, 0.1], [0.7, 0]],
    twist: [[0, 0], [0.2, -0.25], [0.3, 0.1], [0.7, 0]],
  },
  // Summoning vines (Vine Trap): both hands swept down low towards the ground
  // at the target, glowing green, then raised sharply, palms up, as if
  // pulling the vines up out of the earth (at VINES_RISE).
  vineTrap: {
    duration: 1.0,
    ease: [0.1, 0.25],
    bothHands: true,
    glowKind: 'nature',
    keys: [
      [0.0, [0.2, 0, 0.1], [0.2, 0, 0], [0, 0], [0.2, 0, 0.1], [0.2, 0, 0]],
      [0.35, [0.7, 0, 0.35], [0.2, 0, 0], [0.2, 0], [0.7, 0, 0.35], [0.2, 0, 0]],
      [0.55, [1.5, 0, 0.35], [0.5, 0, 0], [-0.05, 0], [1.5, 0, 0.35], [0.5, 0, 0]],
      [0.75, [1.45, 0, 0.35], [0.5, 0, 0], [-0.05, 0], [1.45, 0, 0.35], [0.5, 0, 0]],
      [1.0, [0.2, 0, 0.1], [0.2, 0, 0], [0, 0], [0.2, 0, 0.1], [0.2, 0, 0]],
    ],
    wrist: [[0, [0, 0, 0]], [0.35, [-0.5, 0, 0]], [0.55, [-0.9, 0, 0]], [0.75, [-0.9, 0, 0]], [1.0, [0, 0, 0]]],
    glow: [[0, 0], [0.25, 0.6], [0.5, 1], [0.7, 0.8], [0.95, 0]],
    lean: [[0, 0], [0.35, 0.18], [0.55, -0.06], [0.75, -0.04], [1.0, 0]],
  },
  // Casting a beam (Cleansing Light): the hand draws back to the shoulder,
  // lighting up, then thrusts straight out, palm forwards and fingers up, and
  // holds there while the beam shines from it (from BEAM_IMPACT).
  beam: {
    duration: 1.5,
    keys: [
      [0.0, [0.3, 0, 0.2], [0.3, 0, 0], [0, 0]],
      [0.33, [1.1, 0, 0.3], [1.5, 0, 0], [0.05, 0]],
      [0.45, [1.5, 0, 0.1], [0.1, 0, 0], [0, 0]],
      [1.2, [1.5, 0, 0.1], [0.1, 0, 0], [0, 0]],
      [1.5, [0.3, 0, 0.2], [0.3, 0, 0], [0, 0]],
    ],
    wrist: [[0, [0, 0, 0]], [0.33, [0.5, 0, 0]], [0.45, [1.1, 0, 0]], [1.2, [1.1, 0, 0]], [1.5, [0, 0, 0]]],
    glow: [[0, 0], [0.3, 0.8], [0.45, 1], [1.2, 1], [1.45, 0]],
    lean: [[0, 0], [0.33, -0.06], [0.45, 0.08], [1.2, 0.06], [1.5, 0]],
  },
  // Shielding someone (Shield of Faith) is cast the same way as healing: a
  // touch, or a hand on one's own chest (set below).
  // A zombie's scratch: the arm rears up and out, then rakes down and across
  // in front of it (at SCRATCH_IMPACT), lunging a little into it.
  scratch: {
    duration: 0.8,
    ease: [0.12, 0.25],
    keys: [
      [0.0, [1.3, 0, 0.1], [0.35, 0, 0], [0, 0]],
      [0.25, [2.4, 0.2, 0.55], [1.1, 0, 0], [-0.1, 0.1]],
      [0.36, [1.4, -0.1, -0.05], [0.3, 0, 0], [0.1, -0.1]],
      [0.5, [0.7, -0.2, -0.35], [0.4, 0, 0], [0.1, -0.15]],
      [0.8, [1.3, 0, 0.1], [0.35, 0, 0], [0, 0]],
    ],
    lean: [[0, 0], [0.25, -0.05], [0.38, 0.18], [0.8, 0]],
  },
  // A zombie's bite: it rears back, then lunges in with its jaws wide open,
  // both hands grabbing at its victim, and bites down (at BITE_IMPACT).
  bite: {
    duration: 1.0,
    ease: [0.15, 0.3],
    keys: [
      [0.0, [1.3, 0, 0.1], [0.35, 0, 0], [0, 0], [1.3, 0, 0.1], [0.35, 0, 0]],
      [0.3, [1.7, 0, 0.35], [0.2, 0, 0], [-0.25, 0], [1.7, 0, 0.35], [0.2, 0, 0]],
      [0.5, [1.35, 0.1, -0.2], [1.0, 0, 0], [0.3, 0], [1.35, 0.1, -0.2], [1.0, 0, 0]],
      [0.72, [1.35, 0.1, -0.2], [1.0, 0, 0], [0.25, 0], [1.35, 0.1, -0.2], [1.0, 0, 0]],
      [1.0, [1.3, 0, 0.1], [0.35, 0, 0], [0, 0], [1.3, 0, 0.1], [0.35, 0, 0]],
    ],
    lean: [[0, 0], [0.3, -0.12], [0.5, 0.3], [0.72, 0.28], [1.0, 0]],
    mouth: [[0, 0], [0.25, 0.6], [0.45, 1], [0.52, 0.1], [0.7, 0.15], [0.9, 0]],
  },
});
// Puzzled (a zombie at a wall): the head turning one way, then the other,
// then back -- the arms kept reaching out as they are.
GESTURES.lookAround = {
  duration: 1.3,
  ease: [0.15, 0.2],
  keys: [
    [0.0, [1.3, 0, 0.02], [0.35, 0, 0], [0, 0]],
    [0.3, [1.2, 0.1, 0.02], [0.4, 0, 0], [0.1, 0.6]],
    [0.75, [1.2, -0.1, 0.02], [0.4, 0, 0], [0.1, -0.6]],
    [1.1, [1.3, 0, 0.02], [0.35, 0, 0], [0.05, 0.2]],
    [1.3, [1.3, 0, 0.02], [0.35, 0, 0], [0, 0]],
  ],
  twist: [[0, 0], [0.3, 0.2], [0.75, -0.2], [1.1, 0.05], [1.3, 0]],
};

// Planting a leech (Leach Bomb): a quick reach, hand glowing a sickly green,
// slapping it onto the victim (at LEECH_PLANT), then snatching the hand back.
GESTURES.plantLeech = {
  duration: 0.75,
  ease: [0.06, 0.2],
  glowKind: 'toxic',
  keys: [
    [0.0, [0.2, 0, 0.1], [0.2, 0, 0], [0, 0]],
    [0.18, [0.9, -0.1, 0.25], [1.2, 0.8, 0], [0.05, 0]],
    [0.32, [1.35, -0.2, 0.05], [0.25, 0.9, 0], [0.1, 0]],
    [0.45, [1.3, -0.2, 0.05], [0.3, 0.9, 0], [0.1, 0]],
    [0.75, [0.2, 0, 0.1], [0.2, 0, 0], [0, 0]],
  ],
  glow: [[0, 0], [0.12, 0.8], [0.32, 1], [0.45, 0.3], [0.6, 0]],
  lean: [[0, 0], [0.32, 0.15], [0.5, -0.05], [0.75, 0]],
};

// Setting the ground alight (Burning Ground): the same sweep down and heave
// up as summoning vines, the hands glowing with fire.
GESTURES.igniteGround = { ...GESTURES.vineTrap, glowKind: 'fire' };

// Raising a wall (Wall of Earth): the same heave upwards as summoning vines,
// but with a glow the colour of earth.
GESTURES.raiseEarth = { ...GESTURES.vineTrap, glowKind: 'earth' };
GESTURES.shieldTouch = GESTURES.aidTouch = GESTURES.healTouch;
GESTURES.shieldSelf = GESTURES.aidSelf = GESTURES.healSelf;
const GESTURE_EASE = { in: 0.25, out: 0.3 }; // seconds to blend into and out of a gesture
const FLINCH_TIME = 0.35;  // how long a flinch from being hit lasts
const FALL_TIME = 0.8;     // how long it takes to fall down dead

export class CharacterAnimator {
  constructor() {
    this.phase = 0;
    this.weights = { walk: 0, run: 0, runBack: 0 };
    this.air = 0;      // how far into the jump pose (0 on the ground, 1 in the air)
    this.landing = 0;  // the crouch on landing, fading from 1 to 0
    this.wasOnGround = true;
  }

  // state: { speed (units per second, 0 when still), running, backward, onGround,
  //          verticalSpeed (+1 at the start of a jump, negative when falling) }
  // pose: the arms' rotations [x, y, z] when standing still ('rest', e.g. hands
  // folded) and when moving ('moving', hanging at the sides), by joint name.
  // The cycles are played on top of a blend between them.
  update(joints, { speed, running, backward, onGround, verticalSpeed = 0 }, dt, height = 1, pose = null) {
    const moving = speed > 0.1 && onGround;
    const target = {
      walk: moving && !running ? 1 : 0,
      run: moving && running && !backward ? 1 : 0,
      runBack: moving && running && backward ? 1 : 0,
    };
    const k = 1 - Math.exp(-BLEND_RATE * dt);
    for (const name of Object.keys(target)) this.weights[name] += (target[name] - this.weights[name]) * k;

    // Advance the cycle by the distance travelled.
    const { walk: w, run: r, runBack: b } = this.weights;
    const stride = ((w * STRIDE.walk + (r + b) * STRIDE.run) / Math.max(w + r + b, 1e-3)) * height;
    if (moving) this.phase += ((speed * dt) / stride) * Math.PI * 2 * (backward ? -1 : 1);

    // Mix the cycles by their weights.
    const mix = (fn) => w * fn(POSES.walk, false) + r * fn(POSES.run, true) + b * fn(POSES.runBack, true);

    // The arms leave their resting pose while moving or in the air.
    this.moving = Math.min(w + r + b + this.air, 1);
    if (pose) {
      for (const [name, rest] of Object.entries(pose.rest)) {
        const moving = pose.moving[name];
        joints[name].rotation.set(...rest.map((v, k) => v + (moving[k] - v) * this.moving));
      }
    }

    // (The ankles aren't rotated: the feet move rigidly with the shins, so they
    // stay joined to the legs.)
    for (const [side, offset] of [['left', 0], ['right', Math.PI]]) {
      const p = this.phase + offset;
      const forwardSwing = Math.max(Math.cos(p), 0); // the leg is swinging forwards
      joints[`${side}Hip`].rotation.x = mix((P) => P.hipSwing * Math.sin(p) + (P.hipForward ?? 0));
      joints[`${side}Knee`].rotation.x = -mix((P) => P.kneeBase + P.kneeBend * forwardSwing ** 1.5);
      // Arms swing opposite to the leg on the same side.
      // (Less, or not at all, with weapons in hand -- see POSES in characterModel.js.)
      const swing = pose?.swing ?? 1;
      joints[`${side}Shoulder`].rotation.x += -swing * mix((P) => P.shoulderSwing * Math.sin(p) + (P.shoulderBack ?? 0));
      joints[`${side}Elbow`].rotation.x += swing * mix((P) => P.elbowBase + P.elbowSwing * Math.max(-Math.sin(p), 0));
    }

    // The body bobs twice per cycle, leans, and sways slightly side to side.
    const root = joints.root;
    root.position.y = mix((P, isRun) => (isRun ? P.bob * Math.abs(Math.sin(this.phase)) : -P.bob * Math.abs(Math.sin(this.phase))));
    root.rotation.x = -mix((P) => P.lean);
    root.rotation.z = mix((P) => P.sway * Math.sin(this.phase));
    root.rotation.y = mix((P) => P.turn ?? 0);
    joints.head.rotation.x = mix((P) => P.lean * 0.6); // keeps the eyes level
    joints.head.rotation.y = mix((P) => P.look ?? 0); // looking back over the shoulder

    this.jump(joints, { onGround, verticalSpeed }, dt, pose?.swing ?? 1);
    this.block(joints, dt);
    this.playGesture(joints, dt);
    this.reactions(joints, dt);
  }

  // Blocking: the shield arm comes up in front of the chest while `blocking`
  // is set, and down again after.
  block(joints, dt) {
    this.blockAmount = (this.blockAmount ?? 0) + ((this.blocking ? 1 : 0) - (this.blockAmount ?? 0)) * (1 - Math.exp(-18 * dt));
    const b = smoothstep(Math.min(Math.max(this.blockAmount, 0), 1));
    if (b < 0.001) return;
    const [[sx, sy, sz], [ex, ey, ez]] = BLOCK_ARM;
    const blend = (rotation, [x, y, z]) => rotation.set(
      rotation.x + (x - rotation.x) * b, rotation.y + (y - rotation.y) * b, rotation.z + (z - rotation.z) * b,
    );
    blend(joints.leftShoulder.rotation, [sx, -sy, -sz]); // (mirrored for the left arm)
    blend(joints.leftElbow.rotation, [ex, -ey, -ez]);
  }

  // Start a gesture (see GESTURES), replacing any that is playing.
  gesture(name) {
    if (GESTURES[name]) this.current = { gesture: GESTURES[name], time: 0 };
  }

  // Stop a gesture partway (e.g. reloading, interrupted by walking off).
  cancelGesture() {
    this.current = null;
  }

  // Being hit: the body jolts back and the head snaps back, briefly.
  flinch() {
    this.flinchTime = 0;
  }

  // Dying: falling over backwards, and lying there.
  die() {
    this.deathTime = 0;
  }

  // (Played after everything else, on top of it.)
  reactions(joints, dt) {
    if (this.flinchTime !== undefined && this.flinchTime < FLINCH_TIME) {
      this.flinchTime += dt;
      const f = Math.sin(Math.PI * Math.min(this.flinchTime / FLINCH_TIME, 1));
      joints.root.rotation.x += 0.22 * f;
      joints.head.rotation.x -= 0.25 * f;
    }
    if (this.deathTime !== undefined) {
      this.deathTime += dt;
      const f = Math.min(this.deathTime / FALL_TIME, 1);
      const fall = f * f; // (speeding up as it goes)
      joints.root.rotation.x = fall * (Math.PI / 2 - 0.04);
      joints.root.position.y = 0.12 * fall; // (so the back rests on the floor rather than in it)
      joints.head.rotation.x = -0.3 * fall;
      // (The arms go limp, dropping to the sides.)
      for (const side of ['left', 'right']) {
        joints[`${side}Shoulder`].rotation.x *= 1 - fall;
        joints[`${side}Elbow`].rotation.x *= 1 - 0.8 * fall;
      }
    }
  }

  playGesture(joints, dt) {
    this.mouthOpen = 0; // (how open the mouth is, 0-1)
    this.handGlow = 0;  // (how brightly the right hand glows, 0-1)
    this.bothHandsGlow = false; // (and whether the left one does too)
    this.glowKind = null;       // (and in what colour, if not the usual -- see GLOWS in characterModel.js)
    joints.rightWrist?.rotation.set(0, 0, 0);
    this.grip = null; // (how the weapon in the right hand is turned in the grip, if a gesture turns it)
    if (!this.current) return;
    const { gesture } = this.current;
    const t = (this.current.time += dt);
    if (t >= gesture.duration) {
      this.current = null;
      return;
    }
    if (gesture.speech) this.mouthOpen = mouthOpening(gesture.speech, t);
    if (gesture.mouth) this.mouthOpen = track(gesture.mouth, t);
    if (gesture.glow) this.handGlow = track(gesture.glow, t);
    this.bothHandsGlow = Boolean(gesture.bothHands);
    this.glowKind = gesture.glowKind ?? null;
    // Where the keyframes put the arm and head now (easing between keys).
    const { keys } = gesture;
    let k = 1;
    while (k < keys.length - 1 && keys[k][0] < t) k++;
    const [t0, ...a] = keys[k - 1], [t1, ...b] = keys[k];
    const f = smoothstep(Math.min(Math.max((t - t0) / (t1 - t0), 0), 1));
    const [shoulder, elbow, head, leftShoulder, leftElbow] = a.map((v, i) => v.map((x, j) => x + (b[i][j] - x) * f));
    // Blended over the normal movement, easing in and out.
    const [easeIn, easeOut] = gesture.ease ?? [GESTURE_EASE.in, GESTURE_EASE.out];
    const w = smoothstep(Math.min(t / easeIn, 1)) * smoothstep(Math.min((gesture.duration - t) / easeOut, 1));
    const blend = (rotation, [x, y, z]) => rotation.set(
      rotation.x + (x - rotation.x) * w, rotation.y + (y - rotation.y) * w, rotation.z + (z - rotation.z) * w,
    );
    blend(joints.rightShoulder.rotation, shoulder);
    blend(joints.rightElbow.rotation, elbow);
    const mirror = ([x, y, z]) => [x, -y, -z];
    if (leftShoulder) blend(joints.leftShoulder.rotation, mirror(leftShoulder));
    if (leftElbow) blend(joints.leftElbow.rotation, mirror(leftElbow));
    joints.head.rotation.x += head[0] * w;
    joints.head.rotation.y += head[1] * w;
    if (gesture.lean) joints.root.rotation.x -= track(gesture.lean, t) * w;
    if (gesture.twist) joints.root.rotation.y += track(gesture.twist, t) * w;
    if (gesture.grip) {
      // (Which two keys it's between, how far, and how much of the gesture shows.)
      const keysG = gesture.grip;
      let g = 1;
      while (g < keysG.length - 1 && keysG[g][0] < t) g++;
      const f = smoothstep(Math.min(Math.max((t - keysG[g - 1][0]) / (keysG[g][0] - keysG[g - 1][0]), 0), 1));
      this.grip = { from: keysG[g - 1][1], to: keysG[g][1], f, weight: w };
    }
    if (gesture.wrist && joints.rightWrist) {
      const keysOf = (axis) => gesture.wrist.map(([time, v]) => [time, v[axis]]);
      joints.rightWrist.rotation.set(track(keysOf(0), t) * w, track(keysOf(1), t) * w, track(keysOf(2), t) * w);
    }
  }

  // Jumping: blended in while airborne, on top of the cycles above (which fade
  // out in the air). Rising: the lead knee tucks up, the other leg trails and
  // the arms swing up. Falling: the legs reach down for the ground and the
  // arms drop out. Landing: a quick crouch.
  jump(joints, { onGround, verticalSpeed }, dt, armSwing = 1) {
    if (onGround && !this.wasOnGround) this.landing = 1;
    this.wasOnGround = onGround;
    this.air += ((onGround ? 0 : 1) - this.air) * (1 - Math.exp(-JUMP_BLEND_RATE * dt));
    this.landing = Math.max(0, this.landing - dt / LANDING_TIME);

    const a = this.air;
    const tuck = Math.min(Math.max((verticalSpeed + 1) / 2, 0), 1); // 1 rising fast, 0 falling fast
    const l = Math.sin(Math.PI * this.landing) ; // the crouch dips and comes back up
    const add = (joint, axis, value) => { joints[joint].rotation[axis] += value; };

    add('leftHip', 'x', a * (0.35 + 0.55 * tuck) + l * 0.35);
    add('leftKnee', 'x', -a * (0.35 + 1.0 * tuck) - l * 0.7);
    add('rightHip', 'x', a * (-0.12 + 0.12 * tuck) + l * 0.35);
    add('rightKnee', 'x', -a * (0.25 + 0.45 * tuck) - l * 0.7);
    for (const [side, sign] of [['left', -1], ['right', 1]]) {
      // Arms lift out to the sides for balance (higher while rising), slightly forward.
      // (Less, or not at all, with weapons in hand.)
      add(`${side}Shoulder`, 'x', armSwing * a * (0.1 + 0.3 * tuck));
      add(`${side}Shoulder`, 'z', armSwing * sign * a * (0.35 + 0.45 * tuck));
      add(`${side}Elbow`, 'x', armSwing * a * 0.5);
    }
    joints.root.position.y += -l * 0.07;
    joints.root.rotation.x += -a * 0.05 - l * 0.12;
    joints.head.rotation.x += a * 0.03 + l * 0.08;
  }
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// The value of a track of [time, value] keys at time t (eased between keys).
function track(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let k = 1; k < keys.length; k++) {
    if (t <= keys[k][0]) {
      const [t0, v0] = keys[k - 1], [t1, v1] = keys[k];
      return v0 + (v1 - v0) * smoothstep((t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}
