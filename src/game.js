// Main game script: game state, rules, input handling and the game loop.
// Uses the 3D renderer (renderer.js) to draw each frame.
import { GameRenderer } from './renderer.js';
import { createAppearance } from './characterAppearance.js';
import {
  playVoice, startAudio, playSwing, playSmite, playSummon, playSwordImpact, playSnarl, playClaw, playWound, playHealing, playShield, playEmpower, playBeam, playWeaponHit,
} from './sound.js';
import {
  SMITE_IMPACT, INVOKE_IMPACT, SCRATCH_IMPACT, BITE_IMPACT, HEAL_IMPACT, BEAM_IMPACT,
  STAB_IMPACT, SLASH_IMPACT, BASH_IMPACT, AXE_IMPACT, HAMMER_IMPACT,
  SHORTBOW_RELEASE, LONGBOW_RELEASE, CROSSBOW_RELEASE, CROSSBOW_RELOAD,
} from './characterAnimation.js';
import { COMMAND_CALL } from './voice.js';
import { createZombie } from './enemies.js';
import { Hud } from './hud.js';

// --- World ---------------------------------------------------------------

const FLOOR = { width: 40, depth: 40, y: 0 };
const GRAVITY = 20;       // units per second squared
const FALL_LIMIT = -30;   // respawn if the player falls this far below the floor

// --- Player --------------------------------------------------------------

const PLAYER = {
  speed: 8,      // walking
  runSpeed: 14,  // while Caps Lock is on
  backwardSpeedFactor: 0.6, // moving backwards is this fraction of walk/run speed
  jumpSpeed: 8,  // jump height = jumpSpeed² / (2 × GRAVITY) = 1.6
};
const SPAWN = { x: 0, y: 0, z: 0 }; // (standing on the floor, so the game doesn't open with a fall and landing)

// Pressing jump while falling this close to the floor still jumps, as soon as
// the player lands.
const JUMP_BUFFER_HEIGHT = 0.75;

// Holding a sideways key turns the character's body this far towards that
// side (the camera and facing direction are unaffected).
const STRAFE_TURN_ANGLE = 40 * Math.PI / 180;
const STRAFE_TURN_RATE = 15; // how quickly the body turns into and out of it

const player = {
  position: { ...SPAWN }, // position of the player's feet
  yaw: 0,                 // facing direction in radians; 0 faces -Z
  velocityY: 0,
  onGround: false,
  jumpBuffered: false,    // jump was pressed just before landing
  strafeTurn: 0,          // extra body rotation while moving sideways (visual only)
  appearance: createAppearance(), // how the character looks (see characterAppearance.js)
  name: 'You',
  maxHealth: 100,
  health: 100,
  shieldTime: 0,  // seconds of Shield of Faith left
  empowerTime: 0, // seconds of Sovereign Aid left
  stunTime: 0,    // seconds of being stunned left (see Cleansing Light)
  // The player's class decides what they can do (see CLASSES): a cleric picks
  // spells (see chooseSpells), a fighter weapons (see chooseWeapons). There's
  // no character creator to choose these yet -- see PLAYER_CHOICES.
  characterClass: 'cleric',
  spells: [],
  weapons: [],
  selectedSpell: 0, // which of their spells (or weapons) is in use (chosen with the number keys)
  blocking: false,  // holding up a shield
  loaded: true,     // a crossbow with a bolt in it
  reloadTime: 0,    // seconds spent reloading it so far
  cooldowns: {},
  casting: null,
};

// Character classes: what the player can do if they choose one.
//   spells: the spells the class can learn; slots: how many of them the player picks
const CLASSES = {
  // All four of Evalyn's spells, and two she doesn't know.
  cleric: {
    spells: ['smite', 'divineBlade', 'divineRestoration', 'shieldOfFaith', 'sovereignAid', 'cleansingLight'],
    slots: 4,
  },
  // A sword, a shield, and a halberd -- two hands' worth of them: the sword
  // and shield can be carried together, but the halberd takes both hands.
  fighter: {
    weapons: ['sword', 'shield', 'halberd'],
    slots: 2,
  },
  // One of three bows (chosen at character creation), and a dagger for when
  // enemies get too close. (The player only -- no NPC archers.)
  archer: {
    bows: ['shortbow', 'longbow', 'crossbow'],
  },
};

// An archer's weapons: their bow, and a dagger.
function chooseBow(characterClass, bow) {
  return [CLASSES[characterClass].bows.includes(bow) ? bow : CLASSES[characterClass].bows[0], 'dagger'];
}
const PLAYER_SPELL_KEYS = ['1', '2', '3', '4']; // select the first spell with 1, the next with 2...

// The player's spells: the ones they picked, if they're all ones their class
// can learn (and there are no more than it has room for).
function chooseSpells(characterClass, picks) {
  const { spells = [], slots } = CLASSES[characterClass];
  return [...new Set(picks)].filter((s) => spells.includes(s)).slice(0, slots);
}
// The player's weapons: the ones they picked, as long as they fit in their
// hands (each takes a slot, the halberd two).
function chooseWeapons(characterClass, picks) {
  const { weapons, slots } = CLASSES[characterClass];
  const chosen = [];
  let used = 0;
  for (const name of new Set(picks)) {
    if (!weapons.includes(name)) continue;
    const cost = WEAPONS[name].hands;
    if (used + cost <= slots) { chosen.push(name); used += cost; }
  }
  return chosen;
}

// What the player chose, until there's a character creator: their class, and
// their spells (a cleric), weapons (a fighter) or bow (an archer). Change
// these to try another.
const PLAYER_CHOICES = {
  characterClass: 'archer',   // 'cleric', 'fighter' or 'archer'
  spells: ['smite', 'divineRestoration', 'sovereignAid', 'cleansingLight'],
  weapons: ['halberd'],       // (or ['sword', 'shield'])
  bow: 'shortbow',            // 'shortbow', 'longbow' or 'crossbow'
};

// Change how the player looks, e.g. from a character creator. Accepts a full
// or partial appearance; anything missing or invalid keeps its current value.
export function setPlayerAppearance(values) {
  player.appearance = createAppearance(values, player.appearance);
  renderer.setPlayerAppearance(player.appearance);
}

// --- NPCs ----------------------------------------------------------------

// Characters in the world. They use the same character models as the player
// (see characterAppearance.js), but their looks are fixed.
//   radius: how close the player can get (the player can't walk through them).
//   follows: whether they answer the player's call to follow -- the ones who
//            do are in the player's party.
//   wanderSpeed, chaseSpeed: how fast they wander, and chase in combat (units per second).
//   maxHealth: their health when unhurt.
//
// Out of combat, party members wander near the player (or follow them: Z
// toggles it), and enemies wander freely. In combat mode (see updateCombat),
// party members who were following keep in formation round the player, the
// others go after the enemies, and enemies go after the party.
const NPCS = [
  {
    // Evalyn, a cleric: a pale, freckled, red-haired woman in a flowing white
    // dress and sandals, her hair in a long braid.
    name: 'Evalyn',
    role: 'cleric',
    appearance: createAppearance({
      bodyType: 'female',
      height: 0.94,            // a little shorter than the player
      skinColor: '#fbe7dc',
      eyeColor: '#05c23e',     // vivid green
      blush: 0.8,
      freckles: 0.7,
      hairStyle: 'braid',
      hairColor: '#b8431f',
      outfit: 'dress',
      shirtColor: '#f7f5f0',   // the dress
      pantsColor: '#f7f5f0',
      footwear: 'sandals',
      shoeColor: '#7a4a2a',    // brown sandals
    }),
    position: { x: -6, y: FLOOR.y, z: -7 },
    yaw: Math.atan2(-6, -7), // facing the middle of the floor (where the player starts)
    radius: 0.5,
    follows: true,
    maxHealth: 80,
    spells: ['divineRestoration', 'shieldOfFaith', 'divineBlade', 'smite'], // (in order of preference)
    caster: true,
  },
  {
    // A zombie: the first enemy (a random character, see enemies.js). It
    // shambles around slowly with its arms out; it doesn't fight yet.
    name: 'Zombie',
    role: 'enemy',
    ...createZombie(),
    pose: 'zombie',
    undead: true,
    position: { x: 7, y: FLOOR.y, z: -9 },
    yaw: Math.atan2(7, -9),
    radius: 0.45,
    follows: false,
    wanderSpeed: 1.2,
    chaseSpeed: 1.8,
    maxHealth: 60,
    attacks: ['scratch', 'scratch', 'bite'], // (picked at random: scratching more often than biting)
    attackPause: [1.2, 2.2], // seconds between attacks
  },
].map((npc) => ({
  ...npc,
  health: npc.maxHealth,
  dead: false,
  shieldTime: 0,    // seconds of Shield of Faith left
  empowerTime: 0,   // seconds of Sovereign Aid left
  stunTime: 0,      // seconds of being stunned left (see Cleansing Light)
  casting: null,    // the spell they're in the middle of casting: { spell, target, time, landed }
  cooldowns: {},    // spell -> seconds until it can be cast again
  position: { ...npc.position },
  velocityY: 0,
  onGround: true,
  following: false,
  target: null,     // where they're wandering to
  waitTime: 1,      // seconds to stand still before wandering on
  jumpDelay: -1,    // seconds until they jump after the player (-1: not jumping)
  moveSpeed: 0,
  running: false,
}));

const NPC_MOVE = {
  wanderSpeed: 4,       // a stroll
  wanderRange: 8,       // how far away the next spot to wander to can be
  wait: [1.5, 4],       // how long they stand still between wanders (seconds)
  edgeMargin: 1.5,      // they stay this far in from the edges of the floor
  followDistance: 1.4,  // how close behind the player they stay when following
  followSlack: 0.5,     // how much further the player can get before they set off again
  jumpDelay: 0.15,      // they jump this long after the player
  turnRate: 10,         // how quickly they turn to face where they're going
  partyRange: 7,        // party members wander within this distance of the player
};

// Z: every NPC starts (or stops) following the player, who signals it with
// a gesture: a sweep of the arm while calling out an order ("follow me"), or
// a wave ("you can stay").
function toggleFollowing() {
  for (const npc of NPCS) {
    if (!npc.follows || npc.dead) continue;
    npc.following = !npc.following;
    npc.target = null;
    npc.waitTime = 0;
  }
  if (NPCS.some((npc) => npc.following)) {
    renderer.playerGesture('follow');
    playVoice(COMMAND_CALL, { pitch: VOICE_PITCH[player.appearance.bodyType] });
  } else {
    renderer.playerGesture('dismiss');
  }
}

// --- The player's spells ---------------------------------------------------

// The number keys choose one of the player's spells, and left click casts it
// at whatever the player is facing:
//   healing, shields and Sovereign Aid: the party member in front, within
//     touch -- or, with no one there, the player themselves
//   Smite: the enemy in front, within reach (a swing at the air, otherwise)
//   Divine Blade: the enemy in front, within range -- or the ground ahead
//   Cleansing Light: straight ahead
// Aiming (a bow in hand): the camera moves over the shoulder and a crosshair shows.
function isAiming() {
  return Boolean(MOVES[playerSlots()[player.selectedSpell]]?.shot);
}

function selectSpell(slot) {
  if (slot >= playerSlots().length) return;
  if (slot !== player.selectedSpell && player.reloadTime > 0) stopReloading(); // (switching to the dagger mid-reload)
  player.selectedSpell = slot;
  showSelectedWeapon();
}

// An archer's dagger is only drawn while it's in use (the crossbow, held in
// the same hand, is put away meanwhile).
function showSelectedWeapon() {
  if (!player.weapons.includes('dagger')) return;
  const dagger = playerSlots()[player.selectedSpell] === 'daggerStab';
  renderer.showPlayerWeapon('dagger', dagger);
  renderer.showPlayerWeapon('crossbow', !dagger);
}

// What the number keys choose between: a cleric's spells, or the moves of a
// fighter's weapons (e.g. Stab, Slash, Block, Shield Bash).
function playerSlots() {
  return player.weapons.length ? player.weapons.flatMap((w) => WEAPONS[w].moves) : player.spells;
}

// --- The player's weapons (a fighter) ---------------------------------------

// Each weapon has two moves. Like spells, the number keys choose one and
// left click uses it (for Block, left click is held).
const WEAPONS = {
  sword: { label: 'Sword', hands: 1, moves: ['stab', 'slash'] },
  shield: { label: 'Shield', hands: 1, moves: ['block', 'bash'] },
  halberd: { label: 'Halberd', hands: 2, moves: ['axeSlash', 'hammer'] },
  shortbow: { label: 'Short Bow', hands: 2, moves: ['shortbowShot'] },
  longbow: { label: 'Long Bow', hands: 2, moves: ['longbowShot'] },
  crossbow: { label: 'Crossbow', hands: 2, moves: ['crossbowShot'] },
  dagger: { label: 'Dagger', hands: 1, moves: ['daggerStab'] },
};

// The moves, used like spells (see landSpell):
//   strike: a melee blow -- range: how far it reaches; arc: how wide (radians
//     either side of straight ahead); sweep: whether it hits everyone in the
//     arc (rather than just the nearest); damage; knockback: how far it
//     throws them back; stun: seconds they're stunned; sound: see playWeaponHit
//   cooldown: seconds before the move can be used again (after it finishes)
//   shot: an arrow (or bolt) shot at the crosshair -- range: how far it can
//     reach; damage; jitter: how far off it can stray (radians); speed;
//     reload: for a crossbow, which instead of a cooldown must be reloaded
//     (standing still) after each shot
const MOVES = {
  // The short bow: the quickest to shoot, the shortest reach.
  shortbowShot: {
    label: 'Short Bow', gesture: 'shortbowShot', shot: { range: 16, damage: 10, jitter: 0.012, speed: 38, arrow: 'arrow' },
    duration: 0.65, impact: SHORTBOW_RELEASE, cooldown: 0.1,
  },
  // The long bow: hits hardest, further, but slower to draw and harder to aim.
  longbowShot: {
    label: 'Long Bow', gesture: 'longbowShot', shot: { range: 24, damage: 16, jitter: 0.022, speed: 44, arrow: 'arrow' },
    duration: 0.95, impact: LONGBOW_RELEASE, cooldown: 0.25,
  },
  // The crossbow: reaches furthest, and shoots exactly where it's aimed --
  // but must be reloaded after every shot, standing still.
  crossbowShot: {
    label: 'Crossbow', detail: 'stand still to reload', gesture: 'crossbowShot',
    shot: { range: 34, damage: 10, jitter: 0, speed: 55, arrow: 'bolt' },
    duration: 0.55, impact: CROSSBOW_RELEASE, cooldown: 0, reload: CROSSBOW_RELOAD,
  },
  // The dagger: a quick stab, for when enemies get close.
  daggerStab: { label: 'Dagger', gesture: 'stab', strike: true, range: 1.6, arc: 0.4, damage: 9, duration: 0.55, impact: STAB_IMPACT, cooldown: 0.05, sound: 'blade' },
  stab: { label: 'Stab', gesture: 'stab', strike: true, range: 2.1, arc: 0.3, damage: 15, duration: 0.65, impact: STAB_IMPACT, cooldown: 0.1, sound: 'blade' },
  slash: { label: 'Slash', gesture: 'slash', strike: true, range: 1.9, arc: 1.1, sweep: true, damage: 11, duration: 0.75, impact: SLASH_IMPACT, cooldown: 0.1, sound: 'blade' },
  block: { label: 'Block', detail: 'hold' },
  bash: { label: 'Shield Bash', gesture: 'bash', strike: true, range: 1.6, arc: 0.7, damage: 5, stun: 1.2, knockback: 1.2, duration: 0.7, impact: BASH_IMPACT, cooldown: 1.5, sound: 'bash' },
  axeSlash: { label: 'Axe Slash', gesture: 'axeSlash', strike: true, range: 2.7, arc: 1.2, sweep: true, damage: 20, duration: 1.0, impact: AXE_IMPACT, cooldown: 0.3, sound: 'blade' },
  hammer: { label: 'Hammer Blow', gesture: 'hammer', strike: true, range: 2.5, arc: 0.5, damage: 16, knockback: 3.5, duration: 1.15, impact: HAMMER_IMPACT, cooldown: 0.8, sound: 'hammer' },
};

// Use the selected weapon move.
function useWeapon() {
  const name = playerSlots()[player.selectedSpell];
  const move = MOVES[name];
  if (!(move?.strike || move?.shot) || player.casting || player.blocking || player.stunTime > 0 || (player.cooldowns[name] ?? 0) > 0) return;
  if (move.reload && !player.loaded) return; // (a crossbow must be reloaded first)
  player.casting = { spell: move, target: null, time: 0, landed: false };
  player.cooldowns[name] = move.duration + move.cooldown;
  renderer.playerGesture(move.gesture);
  if (move.strike) playSwing();
}

// --- Archery ------------------------------------------------------------------

// Arrows in flight: { from, position, velocity, travelled, shot, shooter, view }.
const arrows = [];
const ARROW_GRAVITY = 6;  // (a little drop -- aimed for, so they still pass through the crosshair)

// Loosing an arrow (or bolt) at whatever's under the crosshair (up to the
// bow's range), from the archer's bow. Bows stray a little; a crossbow doesn't.
function shoot(shooter, move) {
  const shot = move.shot;
  const ray = renderer.aimRay();
  const target = aimPoint(ray, shooter, shot.range);
  const from = {
    x: shooter.position.x - Math.sin(shooter.yaw) * 0.45,
    y: shooter.position.y + 1.45,
    z: shooter.position.z - Math.cos(shooter.yaw) * 0.45,
  };
  let dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z;
  const distance = Math.hypot(dx, dy, dz);
  [dx, dy, dz] = jitter([dx / distance, dy / distance, dz / distance], shot.jitter);
  // (Aimed a touch high, so that it drops back onto the line by the target.)
  const time = distance / shot.speed;
  const velocity = { x: dx * shot.speed, y: dy * shot.speed + 0.5 * ARROW_GRAVITY * time, z: dz * shot.speed };
  arrows.push({ from, position: { ...from }, velocity, travelled: 0, shot, shooter, view: renderer.addArrow(shot.arrow) });
  playSwing({ volume: 0.12 });
  if (move.reload) {
    player.loaded = false;
    renderer.setPlayerLoaded(false);
  }
}

// Turns a direction by a small random angle, up to `amount` radians (more
// often a little than a lot).
function jitter([x, y, z], amount) {
  if (!amount) return [x, y, z];
  const angle = amount * Math.sqrt(Math.random()), turn = Math.random() * Math.PI * 2;
  // Two directions at right angles to it.
  let [ux, uy, uz] = Math.abs(y) < 0.9 ? [-z, 0, x] : [1, 0, 0];
  const ul = Math.hypot(ux, uy, uz);
  [ux, uy, uz] = [ux / ul, uy / ul, uz / ul];
  const [vx, vy, vz] = [y * uz - z * uy, z * ux - x * uz, x * uy - y * ux];
  const c = Math.cos(angle), s = Math.sin(angle), a = Math.cos(turn), b = Math.sin(turn);
  return [
    x * c + (ux * a + vx * b) * s,
    y * c + (uy * a + vy * b) * s,
    z * c + (uz * a + vz * b) * s,
  ];
}

// Where the crosshair's line first meets something past the archer -- an
// enemy, or the floor -- or its furthest point in range.
function aimPoint({ origin, direction }, shooter, range) {
  const past = Math.hypot(shooter.position.x - origin.x, shooter.position.z - origin.z) + 0.6; // (skip the archer themselves)
  let best = past + range;
  for (const enemy of livingEnemies()) {
    // (Where the line passes closest to their middle, and whether that's within their body.)
    const cx = enemy.position.x - origin.x, cz = enemy.position.z - origin.z;
    const flat = Math.hypot(direction.x, direction.z) || 1e-6;
    const t = (cx * direction.x + cz * direction.z) / (flat * flat);
    const px = origin.x + direction.x * t - enemy.position.x, pz = origin.z + direction.z * t - enemy.position.z;
    const py = origin.y + direction.y * t - enemy.position.y;
    if (t > past && Math.hypot(px, pz) < enemy.radius + 0.1 && py > 0 && py < 1.9 && t < best) best = t;
  }
  if (direction.y < 0) best = Math.min(best, (FLOOR.y + 0.02 - origin.y) / direction.y);
  best = Math.min(best, past + range);
  return { x: origin.x + direction.x * best, y: origin.y + direction.y * best, z: origin.z + direction.z * best };
}

function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const arrow = arrows[i];
    const { position: p, velocity: v, shot } = arrow;
    const start = { ...p };
    // (Beyond its range, it quickly drops away.)
    v.y -= ARROW_GRAVITY * (arrow.travelled > shot.range ? 6 : 1) * dt;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    arrow.travelled += Math.hypot(p.x - start.x, p.y - start.y, p.z - start.z);
    renderer.moveArrow(arrow.view, p, v);
    // Hitting an enemy (anywhere along this frame's flight)...
    const hit = livingEnemies().find((enemy) => {
      for (let k = 0; k <= 4; k++) {
        const x = start.x + (p.x - start.x) * (k / 4), y = start.y + (p.y - start.y) * (k / 4), z = start.z + (p.z - start.z) * (k / 4);
        const h = y - enemy.position.y;
        if (Math.hypot(x - enemy.position.x, z - enemy.position.z) < enemy.radius + 0.05 && h > 0 && h < 1.9) return true;
      }
      return false;
    });
    if (hit) {
      hurt(hit, shot.damage, arrow.shooter);
      renderer.bloodSpatter({ x: p.x, y: p.y, z: p.z });
      playWeaponHit('blade', { volume: 0.25 });
      renderer.endArrow(arrow.view, { stick: false });
      arrows.splice(i, 1);
    } else if (p.y <= FLOOR.y || !isAboveFloor(p.x, p.z) && p.y < FLOOR.y - 5) {
      // ...or sticking in the ground.
      p.y = Math.max(p.y, FLOOR.y);
      renderer.moveArrow(arrow.view, p, v);
      renderer.endArrow(arrow.view);
      arrows.splice(i, 1);
    }
  }
}

// A crossbow reloads by itself after a shot -- but only while the archer is
// standing still (with it in hand): moving off stops the reload, which starts
// over when they stop again.
function updateReloading(dt) {
  const name = playerSlots()[player.selectedSpell];
  const move = MOVES[name];
  if (!player.weapons.includes('crossbow') || player.loaded) return;
  const standing = player.moveSpeed === 0 && player.onGround && !player.casting && player.stunTime <= 0 && move?.reload;
  if (!standing) {
    if (player.reloadTime > 0) stopReloading();
    return;
  }
  if (player.reloadTime === 0) renderer.playerGesture('crossbowReload');
  player.reloadTime += dt;
  if (player.reloadTime >= move.reload) {
    player.loaded = true;
    player.reloadTime = 0;
    renderer.setPlayerLoaded(true);
  }
}

function stopReloading() {
  player.reloadTime = 0;
  renderer.cancelPlayerGesture();
}

// Holding up a shield (while left click is held, with Block selected).
function setPlayerBlocking(blocking) {
  const canBlock = playerSlots()[player.selectedSpell] === 'block' && !player.casting && player.stunTime <= 0;
  player.blocking = blocking && canBlock;
  renderer.setBlocking(undefined, player.blocking);
}

// A melee blow landing: it hits whoever is in front of the attacker, within
// its reach and arc -- the enemies, if the attacker is in the party, or the
// party if they're an enemy.
function strike(attacker, move) {
  const facingX = -Math.sin(attacker.yaw), facingZ = -Math.cos(attacker.yaw);
  const foes = partyMembers().includes(attacker) ? livingEnemies() : livingParty();
  const hits = [];
  for (const foe of foes) {
    const dx = foe.position.x - attacker.position.x, dz = foe.position.z - attacker.position.z;
    const d = Math.hypot(dx, dz);
    const reach = move.range + (foe.radius ?? PLAYER_RADIUS);
    const angle = Math.acos(Math.min(Math.max((dx * facingX + dz * facingZ) / (d || 1), -1), 1));
    if (d <= reach && (angle <= move.arc || d < 0.6)) hits.push({ foe, d, dx, dz });
  }
  hits.sort((a, b) => a.d - b.d);
  if (!move.sweep) hits.splice(1);
  for (const { foe, d, dx, dz } of hits) {
    const blocked = hurt(foe, move.damage, attacker);
    const at = { x: foe.position.x - (dx / (d || 1)) * 0.3, y: foe.position.y + 1.2, z: foe.position.z - (dz / (d || 1)) * 0.3 };
    if (blocked) continue;
    playWeaponHit(move.sound);
    if (foe.undead || foe.role === 'enemy') renderer.bloodSpatter(at); else renderer.weaponSparks(at);
    if (move.knockback) knockBack(foe, dx / (d || 1), dz / (d || 1), move.knockback);
    if (move.stun) stun(foe, move.stun);
  }
}

// Knocked back: thrown a distance away (in direction dx, dz), sliding to a
// stop over a moment, unable to act meanwhile.
const KNOCKBACK_TIME = 0.35;

function knockBack(character, dx, dz, distance) {
  // (Starting fast and slowing: covers `distance` over KNOCKBACK_TIME.)
  const speed = (2 * distance) / KNOCKBACK_TIME;
  character.knock = { x: dx * speed, z: dz * speed, time: KNOCKBACK_TIME };
  character.casting = null;
}

// Moves a knocked-back character; returns whether they're still being thrown.
function updateKnockback(character, dt) {
  const knock = character.knock;
  if (!knock) return false;
  const t = Math.min(dt, knock.time);
  const slow = knock.time / KNOCKBACK_TIME; // (1 at the start, 0 at the end)
  character.position.x += knock.x * slow * t;
  character.position.z += knock.z * slow * t;
  knock.time -= dt;
  if (knock.time <= 0) character.knock = null;
  return true;
}

function castPlayerSpell(name) {
  const spell = SPELLS[name];
  if (!spell || player.casting || player.stunTime > 0 || (player.cooldowns[name] ?? 0) > 0) return;
  let target;
  if (spell.heal || spell.shield || spell.empower) target = facedCharacter(livingParty(), spell.range) ?? player;
  else if (spell.radius) target = facedCharacter(livingEnemies(), spell.range, 0.75) ?? { position: pointAhead(player, 6) };
  else if (spell.beam) target = null;
  else target = facedCharacter(livingEnemies(), spell.range * 1.2);
  player.casting = { spell, target, time: 0, landed: false };
  player.cooldowns[name] = spell.cooldown;
  renderer.playerGesture(target === player ? spell.selfGesture : spell.gesture);
  playCastSound(spell);
}

// The nearest of some characters in front of the player (other than the
// player), within reach. facing: how squarely in front (1 = dead ahead).
function facedCharacter(characters, reach, facing = 0.3) {
  const facingX = -Math.sin(player.yaw), facingZ = -Math.cos(player.yaw);
  let best = null, bestDistance = reach + 0.5;
  for (const character of characters) {
    if (character === player) continue;
    const dx = character.position.x - player.position.x, dz = character.position.z - player.position.z;
    const d = Math.hypot(dx, dz);
    if (d < bestDistance && (dx * facingX + dz * facingZ) / (d || 1) > facing) { best = character; bestDistance = d; }
  }
  return best;
}

// A point on the floor some way in front of a character.
function pointAhead(character, distance) {
  return { x: character.position.x - Math.sin(character.yaw) * distance, y: FLOOR.y, z: character.position.z - Math.cos(character.yaw) * distance };
}

// A spell the player is casting takes effect partway through (as NPCs' do).
function updatePlayerCasting(dt) {
  for (const name of Object.keys(player.cooldowns)) player.cooldowns[name] = Math.max(player.cooldowns[name] - dt, 0);
  const cast = player.casting;
  if (!cast) return;
  cast.time += dt;
  if (!cast.landed && cast.time >= cast.spell.impact) {
    cast.landed = true;
    landSpell(player, cast);
  }
  if (cast.time >= cast.spell.duration) player.casting = null;
}

// The sound of starting to cast a spell.
function playCastSound(spell) {
  if (spell.heal) playHealing();
  else if (spell.shield) playShield();
  else if (spell.empower) playEmpower();
  else if (spell.beam) playBeam();
  else if (spell.radius) playSummon();
  else playSwing();
}

// The player's speaking pitch (Hz), by body type: low and firm, for giving orders.
const VOICE_PITCH = { female: 175, male: 105 };

// The player just jumped: anyone following jumps too, a moment later.
function onPlayerJump() {
  for (const npc of NPCS) if (npc.following && npc.onGround) npc.jumpDelay = NPC_MOVE.jumpDelay;
}

// The furthest an NPC goes from the middle of the floor, so they never walk off.
function keepOnFloor(pos) {
  const maxX = FLOOR.width / 2 - NPC_MOVE.edgeMargin, maxZ = FLOOR.depth / 2 - NPC_MOVE.edgeMargin;
  pos.x = Math.min(Math.max(pos.x, -maxX), maxX);
  pos.z = Math.min(Math.max(pos.z, -maxZ), maxZ);
}

// A random spot on the floor to wander to, away from the edges. Party members
// stay near the player (so they don't wander off into a fight on their own);
// anyone else wanders anywhere within reach of where they are.
function pickWanderTarget(npc) {
  const centre = npc.follows ? player.position : npc.position;
  const range = npc.follows ? NPC_MOVE.partyRange : NPC_MOVE.wanderRange;
  const angle = Math.random() * Math.PI * 2;
  const distance = range * (npc.follows ? Math.sqrt(Math.random()) : 0.3 + 0.7 * Math.random());
  const target = { x: centre.x + Math.sin(angle) * distance, z: centre.z + Math.cos(angle) * distance };
  keepOnFloor(target);
  return target;
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// What an NPC does this frame: { goal (where to walk to, or none), speed,
// running, face (what to turn towards when standing still) }.
function chooseMove(npc, dt) {
  const casting = castSpells(npc, dt);
  if (casting) return casting;
  if (npc.role === 'enemy') {
    // Enemies go after the nearest party member in combat, and wander otherwise.
    if (combat.active) return approach(npc, nearest(npc, livingParty()), npc.chaseSpeed ?? npc.wanderSpeed);
    return wander(npc, dt);
  }
  // A healer goes to whoever needs healing (see Divine Restoration)...
  if (combat.active) {
    // (...though out of the way of any falling swords first -- see Divine Blade.)
    const escape = escapeStorms(npc);
    if (escape) return escape;
  }
  const healing = goToHeal(npc);
  if (healing) return healing;
  if (combat.active) {
    // ...then followers keep in formation, and the rest go after the enemies
    // (spellcasters skirmishing round them rather than standing toe to toe).
    const target = nearest(npc, livingEnemies());
    if (npc.following) return keepFormation(npc);
    return npc.spells ? skirmish(npc, target, dt) : approach(npc, target);
  }
  return npc.following ? follow(npc) : wander(npc, dt);
}

// Following the player: set off when they get far enough away; stop once close behind them.
function follow(npc) {
  const distance = distanceBetween(npc.position, player.position);
  const wasMoving = npc.moveSpeed > 0;
  if (distance <= NPC_MOVE.followDistance + (wasMoving ? 0 : NPC_MOVE.followSlack)) return { face: player.position };
  // Running only while the player is.
  const running = capsLockOn && player.moveSpeed > 0;
  return { goal: player.position, speed: running ? PLAYER.runSpeed : PLAYER.speed, running };
}

// Wandering: walk to a spot, stand a while, then pick another.
function wander(npc, dt) {
  if (npc.waitTime > 0) {
    npc.waitTime -= dt;
    return {};
  }
  // (A party member's spot is dropped if the player has moved far from it.)
  if (npc.target && npc.follows && distanceBetween(npc.target, player.position) > NPC_MOVE.partyRange * 1.4) npc.target = null;
  npc.target ??= pickWanderTarget(npc);
  if (distanceBetween(npc.position, npc.target) < 0.2) {
    npc.target = null;
    npc.waitTime = NPC_MOVE.wait[0] + Math.random() * (NPC_MOVE.wait[1] - NPC_MOVE.wait[0]);
    return {};
  }
  return { goal: npc.target, speed: npc.wanderSpeed ?? NPC_MOVE.wanderSpeed };
}

// Going after someone: up to within reach of them, running when they're far off.
// reach: how close they get (arm's length for fighting, by default).
function approach(npc, target, speed = null, reach = COMBAT.reach) {
  if (!target) return {};
  const distance = distanceBetween(npc.position, target.position);
  const wasMoving = npc.moveSpeed > 0;
  if (distance <= reach + (wasMoving ? 0 : 0.3)) return { face: target.position };
  const running = speed === null && distance > COMBAT.runDistance;
  const s = speed ?? (running ? PLAYER.runSpeed : PLAYER.speed);
  // (Heading for the point at arm's length from them, rather than their middle.)
  const k = (distance - reach) / distance;
  const goal = {
    x: npc.position.x + (target.position.x - npc.position.x) * k,
    z: npc.position.z + (target.position.z - npc.position.z) * k,
  };
  return { goal, speed: s, running, face: target.position };
}

// In formation: each follower has a place beside and behind the player,
// turning with them, and keeps to it (running to catch up), facing the enemy.
function keepFormation(npc) {
  const slot = COMBAT.formation[partyMembers().indexOf(npc) - 1] ?? COMBAT.formation[0];
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  // (The player's right is (cos, -sin) and forward is (-sin, -cos).)
  const goal = {
    x: player.position.x + cos * slot.right + sin * slot.back,
    z: player.position.z - sin * slot.right + cos * slot.back,
  };
  const face = nearest(npc, livingEnemies())?.position;
  const distance = distanceBetween(npc.position, goal);
  if (distance < 0.25) return { face };
  const running = distance > COMBAT.runDistance || (capsLockOn && player.moveSpeed > 0);
  return { goal, speed: running ? PLAYER.runSpeed : PLAYER.speed, running, face };
}

// A spellcaster's way of fighting: keeping a little way off from the enemy,
// holding their ground there (now and then stepping sideways to a new spot
// round it), and only closing in when a close-range spell (like Smite) is
// ready -- then backing off again once it's cast.
const SKIRMISH = {
  distance: 4,           // how far off they keep
  strafeEvery: [3, 6],   // how long (seconds) they hold a spot before maybe moving
  strafeChance: 0.5,     // how likely they are to move then
  strafe: [0.35, 0.8],   // how far round the enemy (radians) they move
  strafeSpeed: 2.5,      // how fast they side-step (units per second)
};

function skirmish(npc, target, dt) {
  if (!target) return {};
  // (Not while the enemy is in the middle of falling swords, though.)
  const meleeReady = npc.spells.some((s) => SPELLS[s].melee && npc.cooldowns[s] === 0);
  if (meleeReady && !outsideStorms({ ...target.position })) return approach(npc, target);
  // Their spot: the direction from the enemy to them (so it moves with the
  // enemy), kept until it's time to maybe side-step to a new one.
  const bearing = Math.atan2(npc.position.x - target.position.x, npc.position.z - target.position.z);
  npc.skirmish ??= { bearing, timer: 0 };
  const spot = npc.skirmish;
  spot.timer -= dt;
  if (spot.timer <= 0) {
    spot.timer = SKIRMISH.strafeEvery[0] + Math.random() * (SKIRMISH.strafeEvery[1] - SKIRMISH.strafeEvery[0]);
    spot.bearing = bearing; // (wherever they've ended up)
    if (Math.random() < SKIRMISH.strafeChance) {
      const [least, most] = SKIRMISH.strafe;
      spot.bearing += (Math.random() < 0.5 ? -1 : 1) * (least + Math.random() * (most - least));
    }
  }
  const goal = {
    x: target.position.x + Math.sin(spot.bearing) * SKIRMISH.distance,
    z: target.position.z + Math.cos(spot.bearing) * SKIRMISH.distance,
  };
  outsideStorms(goal);
  keepOnFloor(goal);
  const far = distanceBetween(npc.position, goal);
  if (far < 0.4) return { face: target.position }; // (holding their ground)
  const running = far > COMBAT.runDistance + 1;
  return { goal, speed: running ? PLAYER.runSpeed : far > 1.5 ? PLAYER.speed : SKIRMISH.strafeSpeed, running, face: target.position };
}

function nearest(npc, others) {
  let best = null, bestDistance = Infinity;
  for (const other of others) {
    const d = distanceBetween(npc.position, other.position);
    if (d < bestDistance) { best = other; bestDistance = d; }
  }
  return best;
}

function updateNpc(npc, dt) {
  const pos = npc.position;
  const start = { x: pos.x, z: pos.z };
  const knocked = updateKnockback(npc, dt);
  const { goal = null, speed = 0, running = false, face = null } = npc.dead || npc.stunTime > 0 || knocked ? {} : chooseMove(npc, dt);

  let faceX = 0, faceZ = 0;
  if (goal) {
    const dx = goal.x - pos.x, dz = goal.z - pos.z;
    const distance = Math.hypot(dx, dz);
    const step = Math.min(speed * dt, distance);
    if (distance > 1e-6) {
      pos.x += (dx / distance) * step;
      pos.z += (dz / distance) * step;
      faceX = dx; faceZ = dz;
    }
  } else if (face) {
    faceX = face.x - pos.x; faceZ = face.z - pos.z;
  }
  keepOnFloor(pos);
  if (!npc.dead) pushAwayFromPlayer(npc);
  // How fast they actually moved (less if the edge of the floor or the player
  // was in the way), for the walk and run animations.
  const moved = Math.hypot(pos.x - start.x, pos.z - start.z) / Math.max(dt, 1e-6);
  npc.moveSpeed = moved > 0.5 ? moved : 0;
  npc.running = running;
  // Wandering but blocked (e.g. the player is standing in the way): give up
  // after a moment and go somewhere else.
  npc.stuckTime = npc.target && goal === npc.target && npc.moveSpeed === 0 ? (npc.stuckTime ?? 0) + dt : 0;
  if (npc.stuckTime > 1) npc.target = null;

  // Turn smoothly towards where they're going (yaw 0 faces -Z).
  if (Math.hypot(faceX, faceZ) > 1e-3) {
    const targetYaw = Math.atan2(-faceX, -faceZ);
    const turn = Math.atan2(Math.sin(targetYaw - npc.yaw), Math.cos(targetYaw - npc.yaw));
    npc.yaw += turn * (1 - Math.exp(-NPC_MOVE.turnRate * dt));
    npc.yaw = Math.atan2(Math.sin(npc.yaw), Math.cos(npc.yaw));
  }

  // Jumping (after the player) and gravity, as for the player.
  if (npc.jumpDelay >= 0) {
    npc.jumpDelay -= dt;
    if (npc.jumpDelay < 0 && npc.onGround) npc.velocityY = PLAYER.jumpSpeed;
  }
  npc.velocityY -= GRAVITY * dt;
  pos.y += npc.velocityY * dt;
  npc.onGround = pos.y <= FLOOR.y;
  if (npc.onGround) {
    pos.y = FLOOR.y;
    npc.velocityY = 0;
  }
}

// NPCs don't walk through each other: any two that overlap are pushed apart.
function separateNpcs() {
  for (let i = 0; i < NPCS.length; i++) {
    for (let j = i + 1; j < NPCS.length; j++) {
      if (NPCS[i].dead || NPCS[j].dead) continue; // (the dead lie where they fell)
      const a = NPCS[i].position, b = NPCS[j].position;
      const dx = b.x - a.x, dz = b.z - a.z;
      const distance = Math.hypot(dx, dz);
      const overlap = NPCS[i].radius + NPCS[j].radius - distance;
      if (overlap > 0 && distance > 1e-6) {
        a.x -= (dx / distance) * overlap / 2; a.z -= (dz / distance) * overlap / 2;
        b.x += (dx / distance) * overlap / 2; b.z += (dz / distance) * overlap / 2;
      }
    }
  }
}

// --- Spells ----------------------------------------------------------------

// Spells cast in combat (by the party -- Evalyn, or the player).
//   label: its name, as shown on screen
//   range: how close the target must be; cooldown: seconds before it can be cast again
//   duration: how long casting takes (they stand still, facing the target)
//   impact: when (seconds in) it takes effect -- matched to its gesture
//   damage: health taken from the target
//   melee: cast from right up close (so casters close in to cast it)
//   minRange: for spells cast from a distance, how far off the target must be
//   radius: for spells that strike an area (centred on the target), its size --
//           they're only cast when no one in the party is in it
//   heal: for healing spells, the share of the target's full health it restores
//         (healing spells are cast on the party, not enemies -- see healingTarget)
const SPELLS = {
  // Divine Restoration: healing by touch. The healer goes to whoever in the
  // party is hurt worst and lays a glowing hand on them -- or, to heal
  // themselves, on their own chest (see the 'healTouch' and 'healSelf' gestures).
  divineRestoration: {
    label: 'Divine Restoration', gesture: 'healTouch', selfGesture: 'healSelf', range: 1.05, cooldown: 7, duration: 1.5, impact: HEAL_IMPACT,
    heal: 0.35,
    below: 0.6, // (only cast on someone below this share of their health)
  },
  // Shield of Faith: magical armour, laid on by touch like healing. The
  // healer shields whoever in the party is closest to an enemy (and not
  // already shielded) -- or themselves. It lasts a while, then wears off.
  shieldOfFaith: {
    label: 'Shield of Faith', gesture: 'shieldTouch', selfGesture: 'shieldSelf', range: 1.05, cooldown: 14, duration: 1.5, impact: HEAL_IMPACT,
    shield: 12,        // how long it lasts (seconds)
    threatRange: 6,    // (only cast on someone this close to an enemy)
  },
  // Sovereign Aid (a cleric's spell -- the player's, not Evalyn's): laid on by
  // touch, or a hand on one's own chest, it makes the target's attacks and
  // spells do more damage for a while.
  sovereignAid: {
    label: 'Sovereign Aid', gesture: 'aidTouch', selfGesture: 'aidSelf', range: 1.6, cooldown: 18, duration: 1.5, impact: HEAL_IMPACT,
    empower: 14,       // how long it lasts (seconds)
  },
  // Cleansing Light (a cleric's spell -- the player's, not Evalyn's): a beam
  // of holy light straight out from the caster's hand for a moment. It burns
  // the undead caught in it, and stuns everyone else (friend or foe).
  cleansingLight: {
    label: 'Cleansing Light', gesture: 'beam', range: 12, cooldown: 10, duration: 1.5, impact: BEAM_IMPACT,
    beam: 0.75,        // how long the beam shines (seconds)
    width: 0.45,       // how far either side of its centre line it catches people
    damage: 22,        // to the undead
    stun: 3,           // seconds everyone else is stunned for
  },
  // Smite: whacking an enemy with a glowing hand (see the 'smite' gesture).
  smite: { label: 'Smite', gesture: 'smite', melee: true, range: 1.8, cooldown: 2.2, duration: 0.95, impact: SMITE_IMPACT, damage: 18 },
  // Divine Blade: a hailstorm of glowing swords falling on an area round the
  // target (see the 'invoke' gesture, and storms below). Each sword hurts
  // anyone -- friend or foe -- where it lands.
  divineBlade: {
    label: 'Divine Blade', gesture: 'invoke', minRange: 3, range: 9, radius: 2.2, cooldown: 9, duration: 1.2, impact: INVOKE_IMPACT,
    swords: 26,       // how many fall
    stormTime: 1.6,   // over how long (seconds)
    swordDamage: 3,   // damage to anyone within...
    swordReach: 0.8,  // ...this distance of where a sword lands
  },
};

// In combat, a caster casts whatever spell is ready at the nearest enemy in
// range (and an enemy attacks -- see attack). Returns what to do while casting
// (stand still, facing the target), or nothing if not casting.
function castSpells(npc, dt) {
  for (const name of npc.spells ?? []) npc.cooldowns[name] = Math.max((npc.cooldowns[name] ?? 0) - dt, 0);
  if (npc.attacks) attack(npc, dt);
  // (No new spells while standing in falling swords: getting out comes first.)
  // (Only healing is cast outside combat.)
  if (!npc.casting && npc.spells && !outsideStorms({ ...npc.position })) {
    const enemy = nearest(npc, livingEnemies());
    const name = npc.spells.find((s) => {
      const target = spellTarget(npc, SPELLS[s], enemy);
      return npc.cooldowns[s] === 0 && target && canCast(npc, SPELLS[s], target) && (combat.active || SPELLS[s].heal);
    });
    if (name) {
      const spell = SPELLS[name], target = spellTarget(npc, spell, enemy);
      npc.casting = { spell, target, time: 0, landed: false };
      npc.cooldowns[name] = spell.cooldown;
      renderer.npcGesture(npc.view, target === npc ? spell.selfGesture : spell.gesture);
      playCastSound(spell);
    }
  }
  if (!npc.casting) return null;

  const cast = npc.casting;
  cast.time += dt;
  if (!cast.landed && cast.time >= cast.spell.impact) {
    cast.landed = true;
    landSpell(npc, cast);
  }
  if (cast.time >= cast.spell.duration) npc.casting = null;
  return !cast.target || cast.target === npc ? {} : { face: cast.target.position };
}

// A spell (or attack) taking effect, partway through being cast.
function landSpell(caster, { spell, target }) {
  const within = (reach) => target && !target.dead && (target === caster || distanceBetween(caster.position, target.position) <= reach);
  if (spell.heal || spell.shield || spell.empower) {
    // A touch spell lands if they're still within touch (or it's the caster).
    if (!within(spell.range * 1.5)) return;
    if (spell.heal) {
      target.health = Math.min(target.health + target.maxHealth * spell.heal, target.maxHealth);
      renderer.healingLight(target.position);
    } else if (spell.shield) {
      target.shieldTime = spell.shield;
    } else {
      target.empowerTime = spell.empower;
      renderer.empowerBurst(target.position);
    }
  } else if (spell.bite !== undefined) {
    // An enemy's attack: it only lands if the victim is still within reach.
    if (!within(spell.range * 1.3)) return;
    if (hurt(target, spell.damage, caster)) return; // (blocked by a shield)
    const at = target.position;
    renderer.bloodSpatter({ x: (at.x * 2 + caster.position.x) / 3, y: at.y + (spell.bite ? 1.45 : 1.2), z: (at.z * 2 + caster.position.z) / 3 });
    playWound(spell.bite ? 'bite' : 'scratch');
  } else if (spell.radius) {
    // An area spell falls where the target is now.
    startStorm(spell, target.position, caster);
  } else if (spell.beam) {
    startBeam(spell, caster);
  } else if (spell.strike) {
    strike(caster, spell);
  } else if (spell.shot) {
    shoot(caster, spell);
  } else if (within(spell.range * 1.3)) {
    // (A close-range spell only lands if the target is still there and within reach.)
    hurt(target, spell.damage, caster);
    const at = target.position;
    renderer.smiteBurst({ x: (at.x + caster.position.x) / 2, y: at.y + 1.3, z: (at.z + caster.position.z) / 2 });
    playSmite();
  }
}

// Enemies' attacks, used like spells (see castSpells):
//   range: how close the victim must be; damage: health taken from them
//   bite: whether it's a bite (rather than a scratch)
const ATTACKS = {
  // A rake of the claws: quick, and more common.
  scratch: { gesture: 'scratch', range: 1.7, duration: 0.8, impact: SCRATCH_IMPACT, damage: 8, bite: false },
  // A lunging bite: slower, but it hurts more.
  bite: { gesture: 'bite', range: 1.6, duration: 1.0, impact: BITE_IMPACT, damage: 14, bite: true },
};

// In combat, an enemy attacks the nearest member of the party (the player or
// anyone with them) who's within reach, every so often.
function attack(npc, dt) {
  npc.attackTimer = (npc.attackTimer ?? 0.6) - dt;
  if (npc.casting || !combat.active || npc.attackTimer > 0) return;
  const target = nearest(npc, livingParty());
  if (!target) return;
  const name = npc.attacks[Math.floor(Math.random() * npc.attacks.length)];
  const move = ATTACKS[name];
  if (distanceBetween(npc.position, target.position) > move.range) return;
  npc.casting = { spell: move, target, time: 0, landed: false };
  npc.attackTimer = move.duration + npc.attackPause[0] + Math.random() * (npc.attackPause[1] - npc.attackPause[0]);
  renderer.npcGesture(npc.view, move.gesture);
  if (move.bite) playSnarl(); else playClaw();
}

// Who a healer would heal: whoever in the party is worst hurt, as a share of
// their full health, if that's low enough to need it.
function healingTarget(npc, spell) {
  let worst = null, worstShare = spell.below;
  for (const member of livingParty()) {
    const share = member.health / member.maxHealth;
    if (share < worstShare) { worst = member; worstShare = share; }
  }
  return worst;
}

// Who a spell would be cast on: healing and shielding go to the party (see
// healingTarget and shieldTarget), everything else to the nearest enemy.
function spellTarget(npc, spell, enemy) {
  if (spell.heal) return healingTarget(npc, spell);
  if (spell.shield) return combat.active ? shieldTarget(npc, spell) : null;
  return enemy;
}

// Who a shield would go on: the unshielded party member nearest an enemy, if
// one is close enough to be in danger.
function shieldTarget(npc, spell) {
  let best = null, bestDistance = spell.threatRange;
  for (const member of livingParty()) {
    if (member.shieldTime > 0) continue;
    for (const enemy of livingEnemies()) {
      const d = distanceBetween(member.position, enemy.position);
      if (d < bestDistance) { best = member; bestDistance = d; }
    }
  }
  return best;
}

// A healer with a touch spell (healing or a shield) ready goes to whoever
// it's for, to touch them.
function goToHeal(npc) {
  const name = npc.spells?.find((s) => (SPELLS[s].heal || SPELLS[s].shield) && npc.cooldowns[s] === 0 && spellTarget(npc, SPELLS[s]));
  if (!name) return null;
  const target = spellTarget(npc, SPELLS[name]);
  if (!target || target === npc) return null;
  const move = approach(npc, target, null, SPELLS[name].range - 0.2);
  if (move.goal) outsideStorms(move.goal);
  return move;
}

// Whether a spell can be cast at a target from where the caster is: in range,
// and (for an area spell) with nobody in the party in the way.
function canCast(npc, spell, target) {
  if (target === npc) return true; // (on oneself)
  const d = distanceBetween(npc.position, target.position);
  if (d > spell.range || d < (spell.minRange ?? 0)) return false;
  if (!spell.radius) return true;
  return partyMembers().every((m) => m.dead || distanceBetween(m.position, target.position) > spell.radius + STORM_MARGIN);
}

// --- Cleansing Light beams -------------------------------------------------

// Beams shining: { spell, caster, from: { x, z }, dir: { x, z }, time, caught: Set }.
const beams = [];

function startBeam(spell, caster) {
  const dir = { x: -Math.sin(caster.yaw), z: -Math.cos(caster.yaw) };
  const from = { x: caster.position.x, z: caster.position.z };
  beams.push({ spell, caster, from, dir, time: 0, caught: new Set() });
  renderer.lightBeam(caster.view, spell.range, spell.beam);
}

function updateBeams(dt) {
  for (const beam of beams) {
    beam.time += dt;
    // Anyone in its path is caught (once): the undead are burned, anyone
    // else stunned.
    for (const character of [player, ...NPCS]) {
      if (character === beam.caster || character.dead || beam.caught.has(character)) continue;
      const dx = character.position.x - beam.from.x, dz = character.position.z - beam.from.z;
      const along = dx * beam.dir.x + dz * beam.dir.z;
      const across = Math.abs(dx * beam.dir.z - dz * beam.dir.x);
      if (along < 0 || along > beam.spell.range || across > beam.spell.width + (character.radius ?? PLAYER_RADIUS)) continue;
      beam.caught.add(character);
      if (character.undead) {
        hurt(character, beam.spell.damage, beam.caster);
        renderer.smiteBurst({ x: character.position.x, y: character.position.y + 1.3, z: character.position.z });
      } else {
        stun(character, beam.spell.stun);
      }
    }
  }
  for (let i = beams.length - 1; i >= 0; i--) if (beams[i].time >= beams[i].spell.beam) beams.splice(i, 1);
}

// Stunned: dazed, unable to move, attack or cast for a while.
function stun(character, seconds) {
  character.stunTime = Math.max(character.stunTime ?? 0, seconds);
  character.casting = null;
}

function updateStuns(dt) {
  for (const character of [player, ...NPCS]) {
    character.stunTime = character.dead ? 0 : Math.max((character.stunTime ?? 0) - dt, 0);
    renderer.setDazed(character.view, character.stunTime > 0);
  }
}

// --- Divine Blade storms --------------------------------------------------

// Swords falling on an area: { spell, centre, time, dropped, swords: [{ x, z, landsAt, landed }] }.
const storms = [];
const SWORD_FALL_TIME = 0.35; // how long a sword takes to fall
const STORM_MARGIN = 0.9;     // how far outside a storm party members keep

function startStorm(spell, at, caster) {
  // (If anyone in the party has come too close to the target since the spell
  // was begun, the storm falls a little further off, so it misses them.)
  const centre = { x: at.x, z: at.z };
  for (const member of partyMembers()) {
    const d = distanceBetween(member.position, centre);
    const safe = spell.radius + STORM_MARGIN;
    if (!member.dead && d < safe) {
      const ax = d > 1e-3 ? (centre.x - member.position.x) / d : 1, az = d > 1e-3 ? (centre.z - member.position.z) / d : 0;
      centre.x = member.position.x + ax * safe;
      centre.z = member.position.z + az * safe;
    }
  }
  const storm = { spell, caster, centre, time: 0, dropped: 0, swords: [] };
  storms.push(storm);
  renderer.bladeArea(storm.centre, spell.radius, spell.stormTime + SWORD_FALL_TIME + 0.4);
}

function updateStorms(dt) {
  for (const storm of storms) {
    const { spell } = storm;
    storm.time += dt;
    // Drop the swords steadily through the storm.
    while (storm.dropped < spell.swords && storm.time >= (storm.dropped * spell.stormTime) / spell.swords) {
      const at = swordTarget(storm);
      storm.swords.push({ ...at, landsAt: storm.time + SWORD_FALL_TIME, landed: false });
      renderer.fallingSword(at, SWORD_FALL_TIME);
      storm.dropped++;
    }
    // Each landing sword hurts anyone close to where it hits.
    for (const sword of storm.swords) {
      if (sword.landed || storm.time < sword.landsAt) continue;
      sword.landed = true;
      playSwordImpact();
      for (const character of [player, ...NPCS]) {
        if (!character.dead && distanceBetween(character.position, sword) <= spell.swordReach) hurt(character, spell.swordDamage, storm.caster);
      }
    }
  }
  // (Finished storms are cleared away.)
  for (let i = storms.length - 1; i >= 0; i--) {
    if (storms[i].dropped === storms[i].spell.swords && storms[i].swords.every((s) => s.landed)) storms.splice(i, 1);
  }
}

// Where the next sword falls: now and then right on someone caught in the
// storm, otherwise anywhere in it.
function swordTarget(storm) {
  const { centre, spell } = storm;
  const caught = [player, ...NPCS].filter((c) => !c.dead && distanceBetween(c.position, centre) < spell.radius);
  if (caught.length && Math.random() < 0.3) {
    const victim = caught[Math.floor(Math.random() * caught.length)];
    return { x: victim.position.x + (Math.random() - 0.5) * 0.6, z: victim.position.z + (Math.random() - 0.5) * 0.6 };
  }
  const angle = Math.random() * Math.PI * 2, r = spell.radius * Math.sqrt(Math.random());
  return { x: centre.x + Math.sin(angle) * r, z: centre.z + Math.cos(angle) * r };
}

// Party members caught in (or at the edge of) a storm get out of it, running.
function escapeStorms(npc) {
  const goal = { x: npc.position.x, z: npc.position.z };
  if (!outsideStorms(goal)) return null;
  keepOnFloor(goal);
  return { goal, speed: PLAYER.runSpeed, running: true };
}

// Moves a point out of any storm (to just beyond its edge). Returns whether it moved.
function outsideStorms(point) {
  let moved = false;
  for (const { centre, spell } of storms) {
    const d = distanceBetween(point, centre);
    const safe = spell.radius + STORM_MARGIN;
    if (d < safe) {
      const ax = d > 1e-3 ? (point.x - centre.x) / d : 1, az = d > 1e-3 ? (point.z - centre.z) / d : 0;
      point.x = centre.x + ax * (safe + 0.3);
      point.z = centre.z + az * (safe + 0.3);
      moved = true;
    }
  }
  return moved;
}

// Taking damage (from `attacker`, if anyone): a flinch, or falling down dead
// when their health runs out. (The player doesn't die yet: their health just
// stops at zero.) A Shield of Faith takes the edge off it; Sovereign Aid on
// the attacker adds to it.
const SHIELD_PROTECTION = 0.5; // the share of damage a shield stops
const EMPOWER_BONUS = 0.5;     // the extra share of damage an empowered attacker does

// A raised shield (see blocking) turns aside most of a blow from in front.
// Returns whether the blow was blocked.
const BLOCK_PROTECTION = 0.85; // the share of damage a raised shield stops
const BLOCK_ARC = 1.2;         // how far round from straight ahead (radians) it covers

function hurt(target, damage, attacker = null) {
  if (target.dead) return false;
  if (attacker?.empowerTime > 0) damage *= 1 + EMPOWER_BONUS;
  if (target.shieldTime > 0) damage *= 1 - SHIELD_PROTECTION;
  let blocked = false;
  if (target.blocking && attacker && attacker !== target) {
    const dx = attacker.position.x - target.position.x, dz = attacker.position.z - target.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const facing = (-Math.sin(target.yaw) * dx - Math.cos(target.yaw) * dz) / d;
    if (Math.acos(Math.min(Math.max(facing, -1), 1)) <= BLOCK_ARC) {
      blocked = true;
      damage *= 1 - BLOCK_PROTECTION;
      playWeaponHit('block');
      renderer.weaponSparks({ x: target.position.x + (dx / d) * 0.45, y: target.position.y + 1.2, z: target.position.z + (dz / d) * 0.45 });
    }
  }
  target.health = Math.max(target.health - damage, 0);
  if (target.health > 0 || target === player) {
    if (!blocked) renderer.npcFlinch(target.view);
  } else {
    target.dead = true;
    target.casting = null;
    renderer.npcDie(target.view);
  }
  return blocked;
}

// --- Combat mode -----------------------------------------------------------

// Combat mode starts when anyone in the party comes within range of an enemy,
// and ends once the whole party is well clear of every enemy (or they're all dead).
const COMBAT = {
  startRange: 8,      // how close to an enemy starts combat
  endRange: 14,       // how far from every enemy the party must be for it to end
  reach: 1.3,         // how close fighters get to their target
  runDistance: 4,     // further than this, fighters run to their target (or place in formation)
  // Followers' places round the player (units to the player's right, and behind).
  formation: [{ right: 1.4, back: 1.2 }, { right: -1.4, back: 1.2 }, { right: 0, back: 2.2 }],
};

const combat = { active: false };

function partyMembers() {
  return [player, ...NPCS.filter((npc) => npc.follows)];
}

function livingParty() {
  return partyMembers().filter((member) => !member.dead);
}

function livingEnemies() {
  return NPCS.filter((npc) => npc.role === 'enemy' && !npc.dead);
}

function updateCombat() {
  let closest = Infinity;
  for (const member of livingParty()) {
    for (const enemy of livingEnemies()) closest = Math.min(closest, distanceBetween(member.position, enemy.position));
  }
  const active = combat.active ? closest <= COMBAT.endRange : closest < COMBAT.startRange;
  if (active !== combat.active) {
    combat.active = active;
    // Everyone drops what they were doing.
    for (const npc of NPCS) {
      npc.target = null;
      npc.waitTime = 0;
    }
  }
}

// An NPC walking into the player stops at the player's edge (rather than shoving them).
function pushAwayFromPlayer(npc) {
  const pos = npc.position;
  const dx = pos.x - player.position.x, dz = pos.z - player.position.z;
  const distance = Math.hypot(dx, dz);
  const minimum = npc.radius + PLAYER_RADIUS;
  if (distance < minimum && distance > 1e-6 && Math.abs(pos.y - player.position.y) < 2) {
    pos.x = player.position.x + (dx / distance) * minimum;
    pos.z = player.position.z + (dz / distance) * minimum;
  }
}

const PLAYER_RADIUS = 0.35;

// Keep the player from walking into NPCs: push them back out to the NPC's edge.
function collideWithNpcs(pos) {
  for (const npc of NPCS) {
    if (npc.dead) continue;
    const dx = pos.x - npc.position.x, dz = pos.z - npc.position.z;
    const distance = Math.hypot(dx, dz);
    const minimum = npc.radius + PLAYER_RADIUS;
    if (distance < minimum && pos.y < npc.position.y + 2) {
      const push = distance > 1e-6 ? minimum / distance : 0;
      pos.x = npc.position.x + (distance > 1e-6 ? dx * push : minimum);
      pos.z = npc.position.z + dz * push;
    }
  }
}

// --- Camera --------------------------------------------------------------

const MOUSE_SENSITIVITY = 0.0025; // radians per pixel of mouse movement

// One camera that circles the player. Moving the mouse up/down tilts it.
// Moving it sideways normally turns the player (the camera stays behind them);
// while Shift is held it swings the camera around the player instead.
const CAMERA_PITCH = { initial: 0.28, min: -0.2, max: 1.2 };
const CAMERA_RETURN_RATE = 12; // how fast the camera swings back behind the player after Shift

const camera = {
  aiming: 0,       // 0-1: how far the camera has moved in over the shoulder, to aim (see isAiming)
  pitch: CAMERA_PITCH.initial,
  orbiting: false, // true while Shift is held
  yawOffset: 0,    // how far the camera has been swung away from behind the player
};

function startOrbit() {
  camera.orbiting = true;
}

function stopOrbit() {
  camera.orbiting = false;
  // Swing back the short way round.
  camera.yawOffset = Math.atan2(Math.sin(camera.yawOffset), Math.cos(camera.yawOffset));
}

function clamp(value, { min, max }) {
  return Math.min(Math.max(value, min), max);
}

function onMouseMove(dx, dy) {
  const turn = -dx * MOUSE_SENSITIVITY; // moving the mouse right turns right
  const tilt = dy * MOUSE_SENSITIVITY;  // moving the mouse up looks up

  if (camera.orbiting) {
    camera.yawOffset += turn;
  } else {
    player.yaw += turn;
  }
  camera.pitch = clamp(camera.pitch + tilt, CAMERA_PITCH);
}

function updateCamera(dt) {
  // After Shift is released, ease the camera back behind the player.
  if (!camera.orbiting && camera.yawOffset !== 0) {
    camera.yawOffset *= Math.exp(-CAMERA_RETURN_RATE * dt);
    if (Math.abs(camera.yawOffset) < 0.001) camera.yawOffset = 0;
  }
}

// Horizontal direction the camera faces (same convention as player.yaw).
function getCameraYaw() {
  return player.yaw + camera.yawOffset;
}

// --- Input ---------------------------------------------------------------

// Get the sound ready on the first key press or click, so the first sound
// isn't delayed (see sound.js).
for (const type of ['keydown', 'mousedown']) window.addEventListener(type, startAudio, { once: true });

// Keys are matched lower-cased, so controls work regardless of Shift/Caps Lock.
const KEY_BINDINGS = {
  w: 'forward', arrowup: 'forward',
  s: 'back',    arrowdown: 'back',
  a: 'left',    arrowleft: 'left',
  d: 'right',   arrowright: 'right',
};

const heldKeys = new Set();

window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') startOrbit();
  if (e.key.toLowerCase() === 'z' && !e.repeat) toggleFollowing();
  const spellSlot = PLAYER_SPELL_KEYS.indexOf(e.key);
  if (spellSlot >= 0) {
    selectSpell(spellSlot);
    setPlayerBlocking(false);
  }

  const key = e.key.toLowerCase();
  if (key in KEY_BINDINGS) {
    heldKeys.add(key);
    e.preventDefault(); // stop arrow keys from scrolling the page
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') stopOrbit();
  heldKeys.delete(e.key.toLowerCase());
});

// Keyup events are lost if the window loses focus while a key is held.
window.addEventListener('blur', () => {
  heldKeys.clear();
  stopOrbit();
});

// Set by a right click (see the mouse handlers below) and used up on the next frame.
let jumpRequested = false;

// Caps Lock on = running. Its state can be read from any keyboard or mouse
// event, so check it on all of them (mouse movement keeps it up to date).
let capsLockOn = false;

for (const type of ['keydown', 'keyup', 'mousemove', 'mousedown']) {
  window.addEventListener(type, (e) => {
    capsLockOn = e.getModifierState('CapsLock');
  });
}

// True if any key bound to the action is held (e.g. both W and ArrowUp).
function isActionHeld(action) {
  for (const key of heldKeys) {
    if (KEY_BINDINGS[key] === action) return true;
  }
  return false;
}

// --- Physics -------------------------------------------------------------

function isAboveFloor(x, z) {
  return Math.abs(x) <= FLOOR.width / 2 && Math.abs(z) <= FLOOR.depth / 2;
}

function isFallingNearFloor() {
  const pos = player.position;
  return player.velocityY < 0
    && isAboveFloor(pos.x, pos.z)
    && pos.y - FLOOR.y <= JUMP_BUFFER_HEIGHT;
}

function updatePlayer(dt) {
  const pos = player.position;
  const stunned = player.stunTime > 0 || updateKnockback(player, dt); // (a stunned or thrown player can't move or jump)

  // Horizontal movement, relative to the direction the camera faces.
  const forward = stunned ? 0 : Number(isActionHeld('forward')) - Number(isActionHeld('back'));
  const strafe = stunned ? 0 : Number(isActionHeld('right')) - Number(isActionHeld('left'));
  const length = Math.hypot(forward, strafe);
  let sideways = 0; // +1 moving to the character's right, -1 to their left
  if (length > 0) {
    // Direction of movement in the world, normalised so diagonals aren't faster.
    // For a yaw, forward is (-sin, -cos) and right is (cos, -sin) in the XZ plane.
    const yaw = getCameraYaw();
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const dirX = (-sin * forward + cos * strafe) / length;
    const dirZ = (-cos * forward - sin * strafe) / length;

    // Moving away from the way the character faces (not the camera) is slower.
    const facingX = -Math.sin(player.yaw);
    const facingZ = -Math.cos(player.yaw);
    const forwardAmount = dirX * facingX + dirZ * facingZ;
    const movingBackward = forwardAmount < 0;

    // Sideways relative to the character (not the camera), for the body turn.
    // Moving backwards (including backward diagonals) doesn't turn the body.
    // The small dead zones stop tiny angles, e.g. walking almost straight
    // ahead while orbiting, from counting.
    const rightAmount = dirX * -facingZ + dirZ * facingX; // character's right is (-facingZ, facingX)
    if (Math.abs(rightAmount) > 0.1 && forwardAmount > -0.1) sideways = Math.sign(rightAmount);

    let speed = capsLockOn ? PLAYER.runSpeed : PLAYER.speed;
    if (player.blocking) speed = PLAYER.speed * 0.45; // (edging along behind a shield)
    if (movingBackward) speed *= PLAYER.backwardSpeedFactor;

    pos.x += dirX * speed * dt;
    pos.z += dirZ * speed * dt;
    collideWithNpcs(pos);
    player.moveSpeed = speed;
    player.movingBackward = movingBackward;
  } else {
    player.moveSpeed = 0;
  }

  // Turn the body towards the side being moved to (right is a negative yaw),
  // easing back to the normal orientation when sideways movement stops.
  const targetTurn = -sideways * STRAFE_TURN_ANGLE;
  player.strafeTurn += (targetTurn - player.strafeTurn) * (1 - Math.exp(-STRAFE_TURN_RATE * dt));

  // Jumping: only possible while standing on the floor. A jump pressed just
  // before landing is remembered and happens as soon as the player lands.
  if (jumpRequested && !player.onGround && isFallingNearFloor()) {
    player.jumpBuffered = true;
  }
  if (stunned) jumpRequested = player.jumpBuffered = false;
  if ((jumpRequested || player.jumpBuffered) && player.onGround) {
    player.velocityY = PLAYER.jumpSpeed;
    player.jumpBuffered = false;
    onPlayerJump();
  }
  jumpRequested = false;

  // Gravity.
  const previousY = pos.y;
  player.velocityY -= GRAVITY * dt;
  pos.y += player.velocityY * dt;

  // Floor collision: land on the floor if we crossed its surface from above
  // while over it. Walking off the edge lets the player fall.
  player.onGround = false;
  if (isAboveFloor(pos.x, pos.z) && pos.y <= FLOOR.y && previousY >= FLOOR.y) {
    pos.y = FLOOR.y;
    player.velocityY = 0;
    player.onGround = true;
  }

  if (pos.y < FALL_LIMIT) {
    Object.assign(pos, SPAWN);
    player.velocityY = 0;
    player.jumpBuffered = false;
  }
}

// --- Setup and game loop -------------------------------------------------

const renderer = new GameRenderer(document.body);
renderer.addFloor(FLOOR);
player.characterClass = PLAYER_CHOICES.characterClass;
if (CLASSES[player.characterClass].spells) player.spells = chooseSpells(player.characterClass, PLAYER_CHOICES.spells);
if (CLASSES[player.characterClass].weapons) player.weapons = chooseWeapons(player.characterClass, PLAYER_CHOICES.weapons);
if (CLASSES[player.characterClass].bows) player.weapons = chooseBow(player.characterClass, PLAYER_CHOICES.bow);
renderer.addPlayer(player.appearance, { caster: player.spells.length > 0, weapons: player.weapons });
player.view = renderer.playerModel;
showSelectedWeapon();
for (const npc of NPCS) npc.view = renderer.addNpc(npc);

// The HUD (see hud.js): the party's health bars, with their portraits, and
// the enemies' health bars.
const hud = new Hud(document.body);
hud.setParty(partyMembers().map((member) => ({
  id: member, name: member.name, portrait: renderer.portrait(member.view),
})));
hud.setEnemies(NPCS.filter((npc) => npc.role === 'enemy').map((npc) => ({ id: npc })));
hud.setSpells(playerSlots().map((name, i) => {
  const { label, detail } = MOVES[name] ?? SPELLS[name];
  return { label, detail, key: PLAYER_SPELL_KEYS[i] };
}));

// Shields wear off over time; the membrane fades in when one is cast, and
// flickers as it's about to wear off.
function updateShields(dt) {
  for (const character of [player, ...NPCS]) {
    character.empowerTime = character.dead ? 0 : Math.max((character.empowerTime ?? 0) - dt, 0);
    const before = character.shieldTime;
    character.shieldTime = character.dead ? 0 : Math.max(character.shieldTime - dt, 0);
    character.shieldShown ??= 0;
    const target = character.shieldTime > 0 ? 1 : 0;
    character.shieldShown += (target - character.shieldShown) * (1 - Math.exp(-6 * dt));
    let amount = character.shieldShown;
    if (character.shieldTime > 0 && character.shieldTime < 2) amount *= 0.55 + 0.45 * Math.abs(Math.sin(character.shieldTime * 9));
    if (before > 0 || amount > 0.01) renderer.setShield(character.view, amount);
  }
}

function updateHud() {
  hud.update({
    combat: combat.active,
    spells: {
      selected: player.selectedSpell,
      recharging: playerSlots().map((name) => {
        if (MOVES[name]?.reload) return player.loaded ? 0 : 1 - player.reloadTime / MOVES[name].reload;
        return MOVES[name]
          ? (player.cooldowns[name] ?? 0) / (MOVES[name].duration + MOVES[name].cooldown) || 0
          : (player.cooldowns[name] ?? 0) / SPELLS[name].cooldown;
      }),
    },
    aiming: isAiming(),
    party: partyMembers().map((member) => ({
      id: member, health: member.health, maxHealth: member.maxHealth,
      effects: { shield: member.shieldTime, aid: member.empowerTime },
    })),
    enemies: NPCS.filter((npc) => npc.role === 'enemy').map((npc) => ({
      id: npc, health: npc.health, maxHealth: npc.maxHealth, screen: renderer.overHead(npc.view),
    })),
  });
}

// Mouse look: the mouse is captured automatically when the game opens.
// Esc or switching windows releases it; clicking the game captures it again.
const MOUSE_CAPTURE_RETRY_MS = 250;

// Browsers only let a page capture the mouse after a click, so the startup
// capture goes through the main process (see main.js). The window may not have
// focus straight away, so keep trying until the first capture succeeds.
function captureMouseOnStartup() {
  if (document.pointerLockElement === renderer.canvas) {
    clearInterval(startupCapture);
  } else if (document.hasFocus()) {
    window.electronWindow.captureMouse();
  }
}

const startupCapture = setInterval(captureMouseOnStartup, MOUSE_CAPTURE_RETRY_MS);
captureMouseOnStartup();

renderer.canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.canvas) {
    // Refused if clicked within about a second of pressing Esc; click again.
    renderer.canvas.requestPointerLock()?.catch(() => {});
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.canvas) onMouseMove(e.movementX, e.movementY);
});

// Right click jumps (only while the game has the mouse).
const RIGHT_MOUSE_BUTTON = 2;

// Left click casts the selected spell (only while the game has the mouse --
// otherwise a click is what captures it).
const LEFT_MOUSE_BUTTON = 0;

document.addEventListener('mousedown', (e) => {
  if (e.button === RIGHT_MOUSE_BUTTON && document.pointerLockElement === renderer.canvas) {
    jumpRequested = true;
  }
  if (e.button === LEFT_MOUSE_BUTTON && document.pointerLockElement === renderer.canvas) {
    if (player.weapons.length) {
      if (playerSlots()[player.selectedSpell] === 'block') setPlayerBlocking(true);
      else useWeapon();
    } else {
      castPlayerSpell(player.spells[player.selectedSpell]);
    }
  }
});

document.addEventListener('mouseup', (e) => {
  if (e.button === LEFT_MOUSE_BUTTON) setPlayerBlocking(false);
});

// Don't open a context menu on right click.
document.addEventListener('contextmenu', (e) => e.preventDefault());

let lastTime = performance.now();

function frame(now) {
  // Clamp dt so a long pause (e.g. window hidden) doesn't cause a huge jump.
  // (Never negative: the first frame's timestamp can be slightly earlier than
  // the time the game finished loading.)
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.1);
  lastTime = now;

  updateCamera(dt);
  updatePlayer(dt);
  renderer.updatePlayer(player.position, player.yaw + player.strafeTurn);
  renderer.animatePlayer({
    speed: player.moveSpeed,
    running: capsLockOn,
    backward: player.movingBackward,
    onGround: player.onGround,
    verticalSpeed: player.velocityY / PLAYER.jumpSpeed, // +1 at take-off, falling below 0
  }, dt);
  updateCombat();
  updateStorms(dt);
  updateShields(dt);
  updatePlayerCasting(dt);
  updateArrows(dt);
  updateReloading(dt);
  updateBeams(dt);
  updateStuns(dt);
  for (const npc of NPCS) {
    updateNpc(npc, dt);
    renderer.updateNpc(npc.view, npc.position, npc.yaw);
    renderer.animateNpc(npc.view, {
      speed: npc.moveSpeed,
      running: npc.running,
      backward: false,
      onGround: npc.onGround,
      verticalSpeed: npc.velocityY / PLAYER.jumpSpeed,
    }, dt);
  }
  separateNpcs();
  camera.aiming += ((isAiming() ? 1 : 0) - camera.aiming) * (1 - Math.exp(-10 * dt));
  renderer.updateCamera({ yaw: getCameraYaw(), pitch: camera.pitch, aiming: camera.aiming });
  updateHud();
  renderer.render();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
