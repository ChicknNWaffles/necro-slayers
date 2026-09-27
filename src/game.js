// Main game script: game state, rules, input handling and the game loop.
// Uses the 3D renderer (renderer.js) to draw each frame.
import { GameRenderer } from './renderer.js';
import { createAppearance } from './characterAppearance.js';
import { playVoice, startAudio } from './sound.js';
import { COMMAND_CALL } from './voice.js';
import { createZombie } from './enemies.js';

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
};

// Change how the player looks, e.g. from a character creator. Accepts a full
// or partial appearance; anything missing or invalid keeps its current value.
export function setPlayerAppearance(values) {
  player.appearance = createAppearance(values, player.appearance);
  renderer.setPlayerAppearance(player.appearance);
}

// --- NPCs ----------------------------------------------------------------

// Characters in the world. They use the same character models as the player
// (see characterAppearance.js), but their looks are fixed. They wander around
// the floor; Z makes the friendly ones follow the player (and Z again stops them).
// radius: how close the player can get (the player can't walk through them).
// follows: whether they answer the player's call to follow.
// wanderSpeed: how fast they wander (units per second).
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
  },
  {
    // A zombie: the first enemy (a random character, see enemies.js). It
    // shambles around slowly with its arms out; it doesn't fight yet.
    name: 'Zombie',
    role: 'enemy',
    ...createZombie(),
    pose: 'zombie',
    position: { x: 7, y: FLOOR.y, z: -9 },
    yaw: Math.atan2(7, -9),
    radius: 0.45,
    follows: false,
    wanderSpeed: 1.2,
  },
].map((npc) => ({
  ...npc,
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
};

// Z: every NPC starts (or stops) following the player, who signals it with
// a gesture: a sweep of the arm while calling out an order ("follow me"), or
// a wave ("you can stay").
function toggleFollowing() {
  for (const npc of NPCS) {
    if (!npc.follows) continue;
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

// A random spot on the floor within reach, away from the edges.
function pickWanderTarget(pos) {
  const angle = Math.random() * Math.PI * 2;
  const distance = NPC_MOVE.wanderRange * (0.3 + 0.7 * Math.random());
  const target = { x: pos.x + Math.sin(angle) * distance, z: pos.z + Math.cos(angle) * distance };
  keepOnFloor(target);
  return target;
}

function updateNpc(npc, dt) {
  const pos = npc.position;
  const start = { x: pos.x, z: pos.z };
  // Where to go, and how fast.
  let goal = null, speed = 0, running = false;
  if (npc.following) {
    const distance = Math.hypot(player.position.x - pos.x, player.position.z - pos.z);
    // Set off when the player gets far enough away; stop once close behind them.
    const wasMoving = npc.moveSpeed > 0;
    if (distance > NPC_MOVE.followDistance + (wasMoving ? 0 : NPC_MOVE.followSlack)) {
      goal = player.position;
      // Running only while the player is.
      running = capsLockOn && player.moveSpeed > 0;
      speed = running ? PLAYER.runSpeed : PLAYER.speed;
    }
  } else if (npc.waitTime > 0) {
    npc.waitTime -= dt;
  } else {
    npc.target ??= pickWanderTarget(pos);
    goal = npc.target;
    speed = npc.wanderSpeed ?? NPC_MOVE.wanderSpeed;
  }

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
    // Arrived: stand for a while, then wander somewhere else.
    if (!npc.following && distance < 0.2) {
      npc.target = null;
      npc.waitTime = NPC_MOVE.wait[0] + Math.random() * (NPC_MOVE.wait[1] - NPC_MOVE.wait[0]);
    }
  } else if (npc.following) {
    // Waiting for the player: turn to face them.
    faceX = player.position.x - pos.x; faceZ = player.position.z - pos.z;
  }
  keepOnFloor(pos);
  pushAwayFromPlayer(npc);
  // How fast they actually moved (less if the edge of the floor or the player
  // was in the way), for the walk and run animations.
  const moved = Math.hypot(pos.x - start.x, pos.z - start.z) / Math.max(dt, 1e-6);
  npc.moveSpeed = moved > 0.5 ? moved : 0;
  npc.running = running;
  // Wandering but blocked (e.g. the player is standing in the way): give up
  // after a moment and go somewhere else.
  npc.stuckTime = !npc.following && goal && npc.moveSpeed === 0 ? (npc.stuckTime ?? 0) + dt : 0;
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

  // Horizontal movement, relative to the direction the camera faces.
  const forward = Number(isActionHeld('forward')) - Number(isActionHeld('back'));
  const strafe = Number(isActionHeld('right')) - Number(isActionHeld('left'));
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
renderer.addPlayer(player.appearance);
for (const npc of NPCS) npc.view = renderer.addNpc(npc);

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

document.addEventListener('mousedown', (e) => {
  if (e.button === RIGHT_MOUSE_BUTTON && document.pointerLockElement === renderer.canvas) {
    jumpRequested = true;
  }
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
  renderer.updateCamera({ yaw: getCameraYaw(), pitch: camera.pitch });
  renderer.render();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
