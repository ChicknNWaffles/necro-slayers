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

// Each shoulder's sideways angle in the standing pose (the jump lifts the arms out from it).
const standingSpread = new WeakMap();

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
  update(joints, { speed, running, backward, onGround, verticalSpeed = 0 }, dt, height = 1) {
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

    // (The ankles aren't rotated: the feet move rigidly with the shins, so they
    // stay joined to the legs.)
    for (const [side, offset] of [['left', 0], ['right', Math.PI]]) {
      const p = this.phase + offset;
      const forwardSwing = Math.max(Math.cos(p), 0); // the leg is swinging forwards
      joints[`${side}Hip`].rotation.x = mix((P) => P.hipSwing * Math.sin(p) + (P.hipForward ?? 0));
      joints[`${side}Knee`].rotation.x = -mix((P) => P.kneeBase + P.kneeBend * forwardSwing ** 1.5);
      // Arms swing opposite to the leg on the same side.
      joints[`${side}Shoulder`].rotation.x = -mix((P) => P.shoulderSwing * Math.sin(p) + (P.shoulderBack ?? 0));
      joints[`${side}Elbow`].rotation.x = mix((P) => P.elbowBase + P.elbowSwing * Math.max(-Math.sin(p), 0));
    }

    // The body bobs twice per cycle, leans, and sways slightly side to side.
    const root = joints.root;
    root.position.y = mix((P, isRun) => (isRun ? P.bob * Math.abs(Math.sin(this.phase)) : -P.bob * Math.abs(Math.sin(this.phase))));
    root.rotation.x = -mix((P) => P.lean);
    root.rotation.z = mix((P) => P.sway * Math.sin(this.phase));
    root.rotation.y = mix((P) => P.turn ?? 0);
    joints.head.rotation.x = mix((P) => P.lean * 0.6); // keeps the eyes level
    joints.head.rotation.y = mix((P) => P.look ?? 0); // looking back over the shoulder

    this.jump(joints, { onGround, verticalSpeed }, dt);
  }

  // Jumping: blended in while airborne, on top of the cycles above (which fade
  // out in the air). Rising: the lead knee tucks up, the other leg trails and
  // the arms swing up. Falling: the legs reach down for the ground and the
  // arms drop out. Landing: a quick crouch.
  jump(joints, { onGround, verticalSpeed }, dt) {
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
      add(`${side}Shoulder`, 'x', a * (0.1 + 0.3 * tuck));
      const shoulder = joints[`${side}Shoulder`];
      if (!standingSpread.has(shoulder)) standingSpread.set(shoulder, shoulder.rotation.z);
      shoulder.rotation.z = standingSpread.get(shoulder) + sign * a * (0.35 + 0.45 * tuck);
      add(`${side}Elbow`, 'x', a * 0.5);
    }
    joints.root.position.y += -l * 0.07;
    joints.root.rotation.x += -a * 0.05 - l * 0.12;
    joints.head.rotation.x += a * 0.03 + l * 0.08;
  }
}
